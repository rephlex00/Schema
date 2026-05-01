import { App, TFile } from "obsidian";
import type { AutoRefreshedField } from "../main";
import type { FieldSchema, TypeSchema } from "../schema/types";

const UNIVERSAL_KEYS = new Set(["type", "title", "summary", "aliases"]);

/**
 * Compute the set of frontmatter keys allowed by a TypeSchema.
 *
 * Includes: `type`, universal keys, all field names, lookup names with
 * render: frontmatter, and the auto-refreshed fields (icon/color and any
 * user-added).
 */
export function allowedKeys(schema: TypeSchema, autoRefreshedFields: AutoRefreshedField[]): Set<string> {
	const keys = new Set<string>(UNIVERSAL_KEYS);
	for (const f of schema.fields) {
		keys.add(f.name);
	}
	for (const lookup of schema.lookups) {
		if (lookup.render === "frontmatter") {
			keys.add(lookup.name);
		}
	}
	for (const ar of autoRefreshedFields) keys.add(ar.name);
	return keys;
}

function defaultForField(field: FieldSchema): unknown {
	const arrayLike = ["MultiFile", "Multi", "MultiMedia", "YAML", "Lookup"];
	if (arrayLike.includes(field.type)) return [];
	if (field.type === "Boolean") return false;
	if (field.type === "Number") return null;
	return "";
}

/**
 * Strip frontmatter keys not allowed by `schema`, add empty placeholders for
 * missing fields, and refresh auto-refreshed fields (icon/color/etc.) from
 * `schema.defaults`.
 */
export async function cleanFrontmatter(
	app: App,
	file: TFile,
	schema: TypeSchema,
	autoRefreshedFields: AutoRefreshedField[]
): Promise<{ removed: string[]; added: string[] }> {
	const removed: string[] = [];
	const added: string[] = [];
	const allowed = allowedKeys(schema, autoRefreshedFields);

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
			if (!(field.name in fm)) {
				fm[field.name] = defaultForField(field);
				added.push(field.name);
			}
		}
		// Refresh auto-refreshed fields from the schema's defaults map.
		// These belong to the type, not the individual note — stale values
		// from an old type would be misleading.
		fm.type = schema.name;
		const defaults = schema.defaults ?? {};
		for (const ar of autoRefreshedFields) {
			const v = defaults[ar.name];
			if (v !== undefined && v !== "") fm[ar.name] = v;
		}
	});

	return { removed, added };
}
