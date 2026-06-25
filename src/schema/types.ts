/**
 * Type definitions for the schema subsystem.
 *
 * v2: schemas are stored in plugin `data.json`. There is no longer a "source
 * path" - the in-memory shape *is* the canonical shape. The settings tab
 * mutates these objects directly.
 */

export type FieldType =
	| "Input"
	| "Number"
	| "Boolean"
	| "Select"
	| "Cycle"
	| "Multi"
	| "File"
	| "MultiFile"
	| "Date"
	| "DateTime"
	| "Time"
	| "Media"
	| "MultiMedia"
	| "JSON"
	| "YAML"
	| "Icon"
	| "Color"
	| "Lookup"
	| "Formula";

/** Options shape for a Formula field. The expression is evaluated at read
 *  time with the active note's frontmatter bound as `fm`. */
export interface FormulaOptions {
	/** JS expression. Free vars: `fm` (frontmatter dict), `file` ({path, name}). */
	expression: string;
}

export const ALL_FIELD_TYPES: FieldType[] = [
	"Input",
	"Number",
	"Boolean",
	"Select",
	"Cycle",
	"Multi",
	"File",
	"MultiFile",
	"Date",
	"DateTime",
	"Time",
	"Media",
	"MultiMedia",
	"JSON",
	"YAML",
	"Icon",
	"Color",
	"Formula",
];

export interface FieldSchema {
	/** Frontmatter key. Unique within a TypeSchema and a key into the global
	 *  field library (`SchemaSettings.globalFields`). */
	name: string;
	/** Field type - drives editor widget and serialization. The canonical value
	 *  lives in `globalFields[name].type`; any value on a per-type field is
	 *  overwritten at load time by hydration. */
	type: FieldType;
	/** Per-usage prompt label. Persisted on the per-type field (NOT on the
	 *  global) so the same global field can carry a different prompt on each
	 *  type that uses it. Overrides the global's `promptOnCreate` if set. */
	promptOnCreate?: string;
	/** For File/MultiFile: constrain picker to instances of this type. Canonical
	 *  in `globalFields[name].target`; hydration overwrites the per-type copy. */
	target?: string;
	/** For File/MultiFile with `target` set: name of the auto-generated reverse
	 *  lookup synthesized on the target type. Canonical in `globalFields`;
	 *  hydration overwrites the per-type copy. Leave blank for one-way links. */
	inverse?: string;
	/** Type-specific options (e.g. valuesListNotePath / valuesList for Select).
	 *  Canonical in `globalFields`; hydration overwrites the per-type copy. */
	options?: Record<string, unknown>;
	/** Hide this property from the rendered properties widget in Live Preview
	 *  and Reading view. The value stays in the note's YAML and remains visible
	 *  in Source mode. Properties are global by name, so this hides the key
	 *  everywhere it appears. Canonical in `globalFields`. */
	hidden?: boolean;
	/** When true, this global property is included in EVERY object type (it
	 *  doesn't need to be listed in each type's `fields`). Used for visual-
	 *  identity properties like icon/color. Applied at consumption points only -
	 *  never written into a type's stored `fields`. Canonical in `globalFields`. */
	universal?: boolean;
}

export interface LookupSchema {
	/** Lookup name - used as frontmatter key in render=frontmatter mode and as
	 *  the body identifier in `\`\`\`schema-lookup <name>\`\`\`` blocks. */
	name: string;
	/** Dataview JS expression. `dv` and `current` are injected at runtime. */
	query: string;
	/** Where to render results. */
	render: "frontmatter" | "block";
	/** Output formatting. */
	output: "list" | "bullet-list" | "count";
	/** Whether to auto-update results into frontmatter. Used only when render=frontmatter. */
	autoUpdate?: boolean;
}

export interface TypeSchema {
	/** Unique type identifier (also the value of the note's `type:` frontmatter key). */
	name: string;
	/** Parent type. The chain is referenced for validation; field merging is not done in v2. */
	extends?: string;
	/** Folder where instances live. Omit for abstract parent types. */
	folder?: string;
	/** Liquid filename template. If omitted, instances get a timestamp filename. */
	filename?: string;
	/** Path (vault-relative) to a Templater template file used to populate the
	 *  body of new notes (and on type-change). Optional - empty means no body. */
	bodyTemplate?: string;
	/** Tags that auto-classify a note as this type. */
	tags: string[];
	/** Data fields the type defines. Excludes lookups. */
	fields: FieldSchema[];
	/** Reverse-reference / derived fields backed by Dataview queries. */
	lookups: LookupSchema[];
	/** Per-object-type default values, keyed by property name. Applied to a new
	 *  note on create, and re-applied on type change for any property whose
	 *  default is set here. Typically holds `icon`/`color` for universal
	 *  properties, but any property the type uses may carry a default. */
	defaults: Record<string, unknown>;
	/** Whether to register a `Schema: New <name>` command for this type. Defaults
	 *  to true (preserves backwards compat). User unticks to keep abstract /
	 *  rarely-created types out of the command palette. */
	exposeCreateCommand?: boolean;
	/** Display-only order for inherited properties shown in the type editor.
	 *  Names not in this list render after listed names in cascade order. Does
	 *  not change ownership or the parent's schema. */
	inheritedOrder?: string[];
	/** Names of inherited fields this type opts OUT of. Applied at resolve time
	 *  after merging the parent chain: matching names are removed from the
	 *  resolved `fields` and their keys deleted from the resolved `defaults`.
	 *  A descendant that re-declares an excluded name re-includes it. Exclusions
	 *  propagate to descendants (daily excluding `dailynote` via its abstract
	 *  parent `periodic` is the motivating case). */
	excludeFields?: string[];
	/** Per-backlink render overrides. Synthesized backlinks default to
	 *  `frontmatter`; setting `{ render: "block" }` for a name flips that one
	 *  to block mode without converting it to a manual lookup. Keys are
	 *  backlink names (the `inverse:` value of the source property). */
	backlinkOverrides?: Record<string, { render?: "frontmatter" | "block" }>;
	/** Optional schema version string. */
	version?: string;
}

/** Structural equality for two field definitions, ignoring `promptOnCreate`
 *  (per-usage attribute). Used by the load-time auto-promote pass to decide
 *  whether a per-type field shape matches an existing global definition, and
 *  by the UI to surface mismatches before they break validation. */
export function fieldShapeMatches(a: FieldSchema, b: FieldSchema): boolean {
	if (a.name !== b.name) return false;
	if (a.type !== b.type) return false;
	if ((a.target ?? "") !== (b.target ?? "")) return false;
	if ((a.inverse ?? "") !== (b.inverse ?? "")) return false;
	return JSON.stringify(a.options ?? {}) === JSON.stringify(b.options ?? {});
}

/** Validation result for a single TypeSchema or the entire schema set. */
export interface ValidationResult {
	ok: boolean;
	errors: ValidationError[];
}

export interface ValidationError {
	type: string;
	level: "error" | "warning";
	message: string;
}
