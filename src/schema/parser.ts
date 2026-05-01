import * as yaml from "js-yaml";
import type { FieldSchema, LookupSchema, TypeSchema } from "./types";

/**
 * Extract the YAML frontmatter block from a markdown source string.
 * Returns the raw YAML text or null if no frontmatter is present.
 */
function extractFrontmatter(source: string): string | null {
	if (!source.startsWith("---")) return null;
	const match = source.slice(3).match(/\n---[ \t]*(?:\n|$)/);
	if (!match || match.index === undefined) return null;
	return source.slice(3, 3 + match.index);
}

/**
 * Coerce a value into a string array. YAML may render single values as strings,
 * arrays as arrays, or `null`/empty as null.
 */
function toStringArray(value: unknown): string[] {
	if (value == null || value === "") return [];
	if (Array.isArray(value)) return value.filter((v) => v != null && v !== "").map(String);
	return [String(value)];
}

/**
 * Parse one Field entry from MM frontmatter.
 */
function parseField(raw: Record<string, unknown>): FieldSchema | null {
	const name = raw.name;
	const type = raw.type;
	const id = raw.id;
	if (typeof name !== "string" || typeof type !== "string" || typeof id !== "string") {
		return null;
	}
	const field: FieldSchema = {
		name,
		type: type as FieldSchema["type"],
		id,
		options: (raw.options as Record<string, unknown>) ?? {},
	};
	if (raw.style && typeof raw.style === "object") {
		field.style = raw.style as { bold?: boolean; italic?: boolean };
	}
	if (typeof raw.path === "string") field.path = raw.path;
	if (typeof raw.promptOnCreate === "string") field.promptOnCreate = raw.promptOnCreate;
	if (typeof raw.target === "string") field.target = raw.target;
	return field;
}

/**
 * Detect Lookup-type fields and return a LookupSchema view of them, plus a
 * standalone `lookups:` block at the top level if present.
 */
function extractLookups(
	fields: FieldSchema[],
	rawTopLevel: Record<string, unknown>
): LookupSchema[] {
	const lookups: LookupSchema[] = [];

	// Lookup fields embedded in `fields:` (MM convention)
	for (const f of fields) {
		if (f.type !== "Lookup") continue;
		const opts = (f.options as Record<string, unknown> | undefined) ?? {};
		const query = typeof opts.dvQueryString === "string" ? opts.dvQueryString : undefined;
		if (!query) continue;
		lookups.push({
			name: f.name,
			id: f.id,
			query,
			render: opts.render === "block" ? "block" : "frontmatter",
			output: (opts.output as LookupSchema["output"]) ?? "list",
			autoUpdate: opts.autoUpdate !== false,
		});
	}

	// Top-level `lookups:` block (Schema plugin extension)
	const topLevel = rawTopLevel.lookups;
	if (topLevel && typeof topLevel === "object" && !Array.isArray(topLevel)) {
		for (const [name, value] of Object.entries(topLevel as Record<string, unknown>)) {
			if (!value || typeof value !== "object") continue;
			const v = value as Record<string, unknown>;
			const query = typeof v.query === "string" ? v.query : undefined;
			if (!query) continue;
			// Skip if a Lookup field with the same name was already extracted.
			if (lookups.some((l) => l.name === name)) continue;
			lookups.push({
				name,
				query,
				render: v.render === "block" ? "block" : "frontmatter",
				output: (v.output as LookupSchema["output"]) ?? "list",
				autoUpdate: v.autoUpdate !== false,
			});
		}
	}

	return lookups;
}

/**
 * Derive the type name from the source file's path.
 *
 * `Templates/Objects/facts/person.md` → "person"
 */
export function typeNameFromPath(sourcePath: string): string {
	const file = sourcePath.split("/").pop() ?? sourcePath;
	return file.replace(/\.md$/, "");
}

/**
 * Parse one fileClass definition file.
 *
 * @param sourcePath vault-relative path of the file
 * @param source     full file content (frontmatter + body)
 * @returns          parsed schema, or null if frontmatter is missing/invalid
 */
export function parseFileClass(sourcePath: string, source: string): TypeSchema | null {
	const fm = extractFrontmatter(source);
	if (fm == null) return null;

	let raw: Record<string, unknown>;
	try {
		const parsed = yaml.load(fm);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
		raw = parsed as Record<string, unknown>;
	} catch {
		return null;
	}

	const rawFields = Array.isArray(raw.fields) ? (raw.fields as Record<string, unknown>[]) : [];
	const fields = rawFields.map(parseField).filter((f): f is FieldSchema => f != null);

	// Resolve `folder` (new key wins over MM `filesPaths`)
	const folder =
		typeof raw.folder === "string" && raw.folder.length > 0
			? raw.folder
			: toStringArray(raw.filesPaths)[0];

	// Resolve `tags` (new key wins over MM `tagNames`)
	const tags =
		Array.isArray(raw.tags) && raw.tags.length > 0
			? raw.tags.filter((t): t is string => typeof t === "string")
			: toStringArray(raw.tagNames);

	const schema: TypeSchema = {
		name: typeNameFromPath(sourcePath),
		sourcePath,
		extends: typeof raw.extends === "string" ? raw.extends : undefined,
		folder,
		filename: typeof raw.filename === "string" ? raw.filename : undefined,
		tags,
		icon: typeof raw.icon === "string" ? raw.icon : undefined,
		color: typeof raw.color === "string" ? raw.color : undefined,
		fields,
		lookups: extractLookups(fields, raw),
		fieldsOrder: toStringArray(raw.fieldsOrder),
		version: raw.version != null ? String(raw.version) : undefined,
		filesPaths: toStringArray(raw.filesPaths),
		tagNames: toStringArray(raw.tagNames),
		mapWithTag: raw.mapWithTag === true,
		limit: typeof raw.limit === "number" ? raw.limit : undefined,
		raw,
	};

	return schema;
}
