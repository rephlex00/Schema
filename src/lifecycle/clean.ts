import { App, TFile } from "obsidian";
import type { FieldSchema, TypeSchema } from "../schema/types";

const UNIVERSAL_KEYS = new Set(["type", "title", "icon", "color", "summary", "aliases"]);

/**
 * Compute the set of frontmatter keys allowed by a TypeSchema.
 *
 * Includes: `type`, universal keys, all field names, and all lookup names with
 * `render: frontmatter`. Does NOT include lookups with `render: block` (those
 * live in body code blocks).
 */
export function allowedKeys(schema: TypeSchema): Set<string> {
	const keys = new Set<string>(UNIVERSAL_KEYS);
	for (const f of schema.fields) {
		if (f.type === "Lookup") {
			const lookup = schema.lookups.find((l) => l.name === f.name);
			if (lookup?.render === "block") continue;
		}
		keys.add(f.name);
	}
	for (const lookup of schema.lookups) {
		if (lookup.render === "frontmatter" || lookup.render === undefined) {
			keys.add(lookup.name);
		}
	}
	return keys;
}

/**
 * Default placeholder for a field that's missing from a note's frontmatter.
 */
function defaultForField(field: FieldSchema): unknown {
	const arrayLike = ["MultiFile", "Multi", "MultiMedia", "YAML", "Lookup"];
	if (arrayLike.includes(field.type)) return [];
	if (field.type === "Boolean") return false;
	if (field.type === "Number") return null;
	return "";
}

/**
 * Strip frontmatter keys not allowed by `schema`, and add empty placeholders
 * for missing fields. Returns a summary of what changed.
 *
 * The function uses Obsidian's `processFrontMatter` so the file is updated in
 * place atomically.
 */
export async function cleanFrontmatter(
	app: App,
	file: TFile,
	schema: TypeSchema
): Promise<{ removed: string[]; added: string[] }> {
	const removed: string[] = [];
	const added: string[] = [];
	const allowed = allowedKeys(schema);

	await app.fileManager.processFrontMatter(file, (fm) => {
		// Drop disallowed keys.
		for (const key of Object.keys(fm)) {
			if (!allowed.has(key)) {
				delete fm[key];
				removed.push(key);
			}
		}
		// Add missing fields with default values.
		for (const field of schema.fields) {
			if (field.type === "Lookup") {
				const lookup = schema.lookups.find((l) => l.name === field.name);
				if (lookup?.render === "block") continue;
			}
			if (!(field.name in fm)) {
				fm[field.name] = defaultForField(field);
				added.push(field.name);
			}
		}
		// Ensure type matches the schema.
		fm.type = schema.name;
	});

	return { removed, added };
}
