import { Events } from "obsidian";
import type { TypeSchema, ValidationError } from "./types";
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

	getAll(): TypeSchema[] {
		return Array.from(this.schemas.values());
	}

	get(name: string): TypeSchema | undefined {
		return this.schemas.get(name);
	}

	getValidationErrors(): ValidationError[] {
		return [...this.lastErrors];
	}

	/**
	 * Initial load. Pass the array of schemas from plugin settings.
	 */
	start(schemas: TypeSchema[]): void {
		this.schemas.clear();
		for (const s of schemas) {
			this.schemas.set(s.name, ensureShape(s));
		}
		this.runValidation();
		this.trigger("schema-loaded", this.getAll());
	}

	stop(): void {
		this.schemas.clear();
		this.lastErrors = [];
	}

	/** Replace the entire schema set. Used by the Settings UI on bulk edits. */
	setAll(schemas: TypeSchema[]): void {
		this.schemas.clear();
		for (const s of schemas) {
			this.schemas.set(s.name, ensureShape(s));
		}
		this.runValidation();
		this.trigger("schema-changed", this.getAll());
	}

	/** Insert or replace a single type. */
	add(schema: TypeSchema): void {
		this.schemas.set(schema.name, ensureShape(schema));
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
		const next = ensureShape({ ...cur, ...partial, name: cur.name });
		this.schemas.set(name, next);
		this.runValidation();
		this.trigger("schema-changed", this.getAll());
		return next;
	}

	private runValidation(): void {
		this.lastErrors = validateAll(this.schemas).errors;
	}
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
		tags: Array.isArray(s.tags) ? [...s.tags] : [],
		fields: Array.isArray(s.fields) ? [...s.fields] : [],
		lookups: Array.isArray(s.lookups) ? [...s.lookups] : [],
		defaults: s.defaults && typeof s.defaults === "object" ? { ...s.defaults } : {},
		version: s.version,
	};
}
