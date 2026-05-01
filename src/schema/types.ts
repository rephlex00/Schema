/**
 * Type definitions for the schema subsystem.
 *
 * A `TypeSchema` is the parsed, normalized representation of one fileClass
 * definition file under the user's vault (e.g. `Templates/Objects/facts/person.md`).
 *
 * The format is a superset of Metadata Menu's existing fileClass shape, with new
 * keys layered on for the Schema plugin's lifecycle features. MM-compatible keys
 * are kept as fallbacks so legacy fileClasses load unmodified.
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
	| "Formula"
	| "Canvas"
	| "CanvasGroup"
	| "CanvasGroupLink";

export interface FieldSchema {
	/** Display name and frontmatter key. Unique within a TypeSchema. */
	name: string;
	/** Field's data type. Drives editor widget and validation. */
	type: FieldType;
	/** Stable 6-char identifier. Unique within a TypeSchema. Persisted across renames. */
	id: string;
	/** Type-specific options (e.g. valuesListNotePath for Select, dvQueryString for Lookup). */
	options?: Record<string, unknown>;
	/** Display style (bold, italic). */
	style?: { bold?: boolean; italic?: boolean };
	/** Nested-field path for Object types (Metadata Menu compatibility). */
	path?: string;

	// Schema plugin extensions
	/** If set, prompt the user for this value during `Schema: New <type>` flow. */
	promptOnCreate?: string;
	/** For File/MultiFile fields: constrain picker to instances of this fileClass. */
	target?: string;
}

export interface LookupSchema {
	/** Field name (frontmatter key, also the lookup identifier). */
	name: string;
	/** Field id (mirrors a corresponding FieldSchema.id when this lookup is also stored as a field). */
	id?: string;
	/** Dataview JS expression. `dv` and `current` are injected. */
	query: string;
	/** Where to render the result. Defaults to "frontmatter" for MM compatibility. */
	render?: "frontmatter" | "block";
	/** Output formatting. Defaults to "list". */
	output?: "list" | "bullet-list" | "count";
	/** Whether to auto-update results into frontmatter. Used only when render === "frontmatter". */
	autoUpdate?: boolean;
}

export interface TypeSchema {
	/** Type identifier — derived from the source filename. Unique across the vault. */
	name: string;
	/** Path to the source markdown file (vault-relative). */
	sourcePath: string;
	/** Parent type name (inheritance). */
	extends?: string;

	/** Folder where instances of this type live. (New key; falls back to first entry of `filesPaths`.) */
	folder?: string;
	/** Filename liquid template. (New key.) */
	filename?: string;
	/** Tags that auto-classify a note as this type. (New key; falls back to `tagNames`.) */
	tags?: string[];

	/** Display icon (Obsidian icon ID, e.g. "user"). */
	icon?: string;
	/** Hex color string. */
	color?: string;

	fields: FieldSchema[];
	lookups: LookupSchema[];

	/** Display order of field IDs in MM UI. */
	fieldsOrder?: string[];
	/** Schema version, bumped on changes. */
	version?: string;

	// MM-compatible keys (read but not authoritative once new keys exist)
	/** @deprecated Use `folder`. Kept for MM compatibility. */
	filesPaths?: string[];
	/** @deprecated Use `tags`. Kept for MM compatibility. */
	tagNames?: string[];
	/** Whether the fileClass name itself is also a tag. MM concept. */
	mapWithTag?: boolean;
	/** Default record limit for table views. MM concept. */
	limit?: number;

	/** Raw parsed frontmatter (preserved for debugging and round-tripping). */
	raw: Record<string, unknown>;
}

/** Validation result for a single TypeSchema or the entire schema set. */
export interface ValidationResult {
	ok: boolean;
	errors: ValidationError[];
}

export interface ValidationError {
	/** Type name the error applies to (or "*" for global errors). */
	type: string;
	/** Severity. */
	level: "error" | "warning";
	/** Human-readable message. */
	message: string;
}
