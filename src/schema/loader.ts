import { Events } from "obsidian";
import { resolveAll, resolveSchema } from "./resolve";
import type { FieldSchema, TypeSchema, ValidationError } from "./types";
import { validateAll } from "./validator";

/**
 * In-memory registry of TypeSchema entries. v2: schemas come from plugin
 * settings (data.json), not from vault files. The Settings tab mutates this
 * registry directly via setAll/add/update/remove; lifecycle subsystems read
 * via get / getAll.
 *
 * Emits `schema-loaded` once after start() and `schema-changed` on any commit.
 */
export class SchemaLoader extends Events {
	private schemas = new Map<string, TypeSchema>();
	private lastErrors: ValidationError[] = [];
	private globalFields: Record<string, FieldSchema> = {};
	private typeKey: string = "type";

	getAll(): TypeSchema[] {
		return Array.from(this.schemas.values());
	}

	get(name: string): TypeSchema | undefined {
		return this.schemas.get(name);
	}

	/** Resolve the extends chain for a type - fields, lookups, defaults
	 *  inherited from ancestors are merged in. Tags and name stay child-only.
	 *  Inverse-lookup queries are generated against the configured typeKey. */
	getResolved(name: string): TypeSchema | undefined {
		return resolveSchema(this.schemas, name, this.typeKey);
	}

	/** Resolved view of every type. */
	getAllResolved(): TypeSchema[] {
		return resolveAll(this.schemas, this.typeKey);
	}

	/** Compact view of every schema for persistence: each field whose name has a
	 *  matching global is stripped to `{name, type, promptOnCreate?}`. The global
	 *  holds the canonical shape and `hydrate()` re-overlays it on load. Writing
	 *  THIS form to data.json (rather than the hydrated, full-shape `getAll()`)
	 *  keeps the stored shape aligned with the global-field invariant, so the
	 *  load-time auto-promote pass stays a no-op and stops writing a fresh backup
	 *  on every load. Mirrors the compaction in convertAllToGlobal. */
	getAllForPersist(): TypeSchema[] {
		return this.getAll().map((s) => dehydrateSchema(s, this.globalFields));
	}

	/** Update the configured object-type frontmatter key. Inverse-lookup
	 *  queries embed this verbatim, so a change must trigger re-resolution
	 *  the next time getResolved/getAllResolved is called. No event fires
	 *  here; the caller usually triggers schema-changed itself to refresh
	 *  UI decorations (banner / chip / file-explorer icons). */
	setTypeKey(typeKey: string): void {
		this.typeKey = typeKey;
	}

	/** Read-only handle to the raw map - used by inheritedFieldNames helpers. */
	rawMap(): Map<string, TypeSchema> {
		return this.schemas;
	}

	/** Read-only handle to the global-fields registry the loader is hydrating
	 *  against. The UI mutates the underlying object directly (same reference
	 *  as `plugin.settings.globalFields`) and then calls `setGlobalFields()` to
	 *  refresh the hydration. */
	getGlobalFields(): Record<string, FieldSchema> {
		return this.globalFields;
	}

	getValidationErrors(): ValidationError[] {
		return [...this.lastErrors];
	}

	/**
	 * Initial load. Pass the array of schemas from plugin settings, plus the
	 * global-fields registry - hydration overlays every field's
	 * type/target/inverse/options from the global of matching name.
	 */
	start(
		schemas: TypeSchema[],
		globalFields: Record<string, FieldSchema> = {},
		typeKey: string = "type"
	): void {
		this.schemas.clear();
		this.globalFields = globalFields;
		this.typeKey = typeKey;
		for (const s of schemas) {
			this.schemas.set(s.name, this.hydrate(ensureShape(s)));
		}
		this.runValidation();
		this.trigger("schema-loaded", this.getAll());
	}

	stop(): void {
		this.schemas.clear();
		this.lastErrors = [];
	}

	/** Swap in a (possibly new-reference) global-fields registry and re-hydrate
	 *  every schema so linked fields pick up the new definitions. Fires
	 *  `schema-changed` once at the end. */
	setGlobalFields(globalFields: Record<string, FieldSchema>): void {
		this.globalFields = globalFields;
		for (const [name, schema] of this.schemas) {
			this.schemas.set(name, this.hydrate(schema));
		}
		this.runValidation();
		this.trigger("schema-changed", this.getAll());
	}

	/** Replace schemas + globalFields atomically in a single firing of
	 *  `schema-changed`. Use this when both must change together - e.g. renaming
	 *  a global field also rewrites every linked stub's name - to avoid the
	 *  intermediate, inconsistent state two separate calls would persist. */
	updateAll(opts: {
		schemas?: TypeSchema[];
		globalFields?: Record<string, FieldSchema>;
	}): void {
		if (opts.globalFields !== undefined) {
			this.globalFields = opts.globalFields;
		}
		if (opts.schemas !== undefined) {
			this.schemas.clear();
			for (const s of opts.schemas) {
				this.schemas.set(s.name, this.hydrate(ensureShape(s)));
			}
		} else {
			for (const [name, schema] of this.schemas) {
				this.schemas.set(name, this.hydrate(schema));
			}
		}
		this.runValidation();
		this.trigger("schema-changed", this.getAll());
	}

	/** Replace the entire schema set. Used by the Settings UI on bulk edits. */
	setAll(schemas: TypeSchema[]): void {
		this.schemas.clear();
		for (const s of schemas) {
			this.schemas.set(s.name, this.hydrate(ensureShape(s)));
		}
		this.runValidation();
		this.trigger("schema-changed", this.getAll());
	}

	/** Insert or replace a single type. */
	add(schema: TypeSchema): void {
		this.schemas.set(schema.name, this.hydrate(ensureShape(schema)));
		this.runValidation();
		this.trigger("schema-changed", this.getAll());
	}

	/** Remove a type by name. No-op if not present. */
	remove(name: string): boolean {
		const removed = this.schemas.delete(name);
		if (removed) {
			this.runValidation();
			this.trigger("schema-changed", this.getAll());
		}
		return removed;
	}

	/**
	 * Apply a partial update to one type. The update object is shallow-merged
	 * onto the existing schema; arrays/objects in `partial` REPLACE the
	 * existing values rather than merging.
	 */
	update(name: string, partial: Partial<TypeSchema>): TypeSchema | null {
		const cur = this.schemas.get(name);
		if (!cur) return null;
		const next = this.hydrate(ensureShape({ ...cur, ...partial, name: cur.name }));
		this.schemas.set(name, next);
		this.runValidation();
		this.trigger("schema-changed", this.getAll());
		return next;
	}

	/** Hydrate every field against the current globalFields registry:
	 *  type / target / inverse / options are sourced from the global; the
	 *  per-type `promptOnCreate` (if set) overrides the global's so a global
	 *  field can carry a per-type prompt label.
	 *
	 *  Every field name MUST resolve to an entry in globalFields - that's the
	 *  invariant after the linkedToGlobal-distinction was retired. A field whose
	 *  name doesn't match a global is left as-is (so consumers can still iterate
	 *  it without crashing); the validator surfaces the missing-global error so
	 *  the user can fix it via the Global Fields tab. */
	private hydrate(s: TypeSchema): TypeSchema {
		let touched = false;
		const fields = s.fields.map((f) => {
			const global = this.globalFields[f.name];
			if (!global) return f;
			touched = true;
			return {
				...global,
				name: f.name,
				promptOnCreate: f.promptOnCreate ?? global.promptOnCreate,
			};
		});
		return touched ? { ...s, fields } : s;
	}

	private runValidation(): void {
		this.lastErrors = validateAll(this.schemas, this.globalFields).errors;
	}
}

/**
 * Strip a schema's fields down to thin global-reference stubs for persistence.
 * A field whose name resolves to a global keeps only `{name, type, promptOnCreate?}`;
 * the canonical type/target/inverse/options/hidden/universal stay in the global.
 * A field with no matching global is left untouched (the validator surfaces it).
 * The compact shape matches what convertAllToGlobal produces, so the load-time
 * pass treats already-persisted schemas as a no-op (no needless backup/rewrite).
 */
function dehydrateSchema(
	s: TypeSchema,
	globalFields: Record<string, FieldSchema>
): TypeSchema {
	let touched = false;
	const fields = s.fields.map((f) => {
		if (!(f.name in globalFields)) return f;
		// All of these canonical properties live on the global; a per-type stub
		// that still carries any of them is a hydrated (non-compact) field that
		// must be stripped, or data.json accumulates stale copies of them.
		if (
			f.target === undefined &&
			f.inverse === undefined &&
			f.options === undefined &&
			f.hidden === undefined &&
			f.universal === undefined
		) {
			return f; // already compact
		}
		touched = true;
		const compact: FieldSchema = { name: f.name, type: f.type };
		if (f.promptOnCreate) compact.promptOnCreate = f.promptOnCreate;
		return compact;
	});
	return touched ? { ...s, fields } : s;
}

/**
 * Normalize a TypeSchema-shaped object: fill in defaults for missing optional
 * collections so callers can rely on `.fields`, `.lookups`, `.tags`, `.defaults`
 * being defined arrays/objects.
 */
function ensureShape(s: TypeSchema): TypeSchema {
	return {
		name: s.name,
		extends: s.extends,
		folder: s.folder,
		filename: s.filename,
		bodyTemplate: s.bodyTemplate,
		tags: Array.isArray(s.tags) ? [...s.tags] : [],
		fields: Array.isArray(s.fields) ? [...s.fields] : [],
		lookups: Array.isArray(s.lookups) ? [...s.lookups] : [],
		defaults: s.defaults && typeof s.defaults === "object" ? { ...s.defaults } : {},
		excludeFields: Array.isArray(s.excludeFields) ? [...s.excludeFields] : undefined,
		exposeCreateCommand: s.exposeCreateCommand,
		inheritedOrder: Array.isArray(s.inheritedOrder) ? [...s.inheritedOrder] : undefined,
		backlinkOverrides:
			s.backlinkOverrides && typeof s.backlinkOverrides === "object"
				? { ...s.backlinkOverrides }
				: undefined,
		version: s.version,
	};
}
