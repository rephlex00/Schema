/**
 * Type definitions for the schema subsystem.
 *
 * v2: schemas are stored in plugin `data.json`. There is no longer a "source
 * path" — the in-memory shape *is* the canonical shape. The settings tab
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
	"Formula",
];

export interface FieldSchema {
	/** Frontmatter key. Unique within a TypeSchema. */
	name: string;
	/** Field type — drives editor widget and serialization. */
	type: FieldType;
	/** If set, prompt the user for this value during `Schema: New <type>`. */
	promptOnCreate?: string;
	/** For File/MultiFile: constrain picker to instances of this type. */
	target?: string;
	/** Type-specific options (e.g. valuesListNotePath / valuesList for Select). */
	options?: Record<string, unknown>;
}

export interface LookupSchema {
	/** Lookup name — used as frontmatter key in render=frontmatter mode and as
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
	 *  body of new notes (and on type-change). Optional — empty means no body. */
	bodyTemplate?: string;
	/** Tags that auto-classify a note as this type. */
	tags: string[];
	/** Data fields the type defines. Excludes lookups. */
	fields: FieldSchema[];
	/** Reverse-reference / derived fields backed by Dataview queries. */
	lookups: LookupSchema[];
	/** Auto-refreshed default values keyed by the global autoRefreshedFields list. Typically `icon`, `color`. */
	defaults: Record<string, unknown>;
	/** Optional schema version string. */
	version?: string;
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
