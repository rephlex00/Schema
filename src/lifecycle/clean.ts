import { App, TFile } from "obsidian";
import type { FieldSchema, TypeSchema } from "../schema/types";
import { defaultForField, isDynamicDefault } from "../util/frontmatter";
import { renderTemplate } from "../util/liquid";
import { effectiveFields } from "../util/universal";

// `tags` is an Obsidian-standard key (same class as aliases): templates and
// users set it freely, so cleaning must never strip it even when the type
// declares no tags field.
const UNIVERSAL_KEYS = new Set(["title", "summary", "aliases", "tags"]);

/**
 * Compute the set of frontmatter keys allowed by a TypeSchema.
 *
 * Includes: the configured object-type key, universal keys, the type's field
 * names plus any universal global properties, and lookup names with
 * render: frontmatter.
 */
export function allowedKeys(
	schema: TypeSchema,
	universalFields: FieldSchema[],
	typeKey = "type"
): Set<string> {
	const keys = new Set<string>(UNIVERSAL_KEYS);
	keys.add(typeKey);
	for (const f of effectiveFields(schema, universalFields)) {
		keys.add(f.name);
	}
	for (const lookup of schema.lookups) {
		if (lookup.render === "frontmatter") {
			keys.add(lookup.name);
		}
	}
	return keys;
}

/**
 * Strip frontmatter keys not allowed by `schema`, add empty placeholders for
 * missing fields, and apply the type's per-property defaults. A STATIC property
 * default in `schema.defaults` is (re-)applied - overwriting any existing
 * value - so a note picks up the new type's defaults (icon/color/etc.) when its
 * object type changes. A DYNAMIC default (string containing Liquid tags, e.g.
 * dailynote's `[[{{date:YYYYMMDD}}]]`) only fills missing/empty values - never
 * overwrites - and renders against the NOTE's own moment (`datetime`
 * frontmatter if valid, else file creation time), so cleaning an old note
 * cannot clobber its historic value with "now". Properties without a default
 * are left untouched.
 */
export async function cleanFrontmatter(
	app: App,
	file: TFile,
	schema: TypeSchema,
	universalFields: FieldSchema[],
	typeKey = "type"
): Promise<{ removed: string[]; added: string[] }> {
	const removed: string[] = [];
	const added: string[] = [];
	const allowed = allowedKeys(schema, universalFields, typeKey);
	const defaults = schema.defaults ?? {};

	await app.fileManager.processFrontMatter(file, (fm) => {
		// Drop disallowed keys.
		for (const key of Object.keys(fm)) {
			if (!allowed.has(key)) {
				delete fm[key];
				removed.push(key);
			}
		}
		fm[typeKey] = schema.name;
		// Dynamic defaults render against the note's own moment: its datetime
		// frontmatter when valid, else the file's creation time.
		const ctx: Record<string, unknown> = { ...fm, __now: noteDate(fm, file) };
		// Apply per-property defaults / placeholders for the type's effective
		// properties. A set static default is re-applied (overwrites); a dynamic
		// default only fills a missing/empty value; otherwise a missing property
		// gets the type-generic placeholder.
		for (const field of effectiveFields(schema, universalFields)) {
			const dflt = defaults[field.name];
			if (isDynamicDefault(dflt)) {
				if (isEmptyValue(fm[field.name])) {
					if (!(field.name in fm)) added.push(field.name);
					fm[field.name] = renderTemplate(dflt, ctx);
				}
			} else if (dflt !== undefined && dflt !== "") {
				fm[field.name] = dflt;
			} else if (!(field.name in fm)) {
				fm[field.name] = defaultForField(field);
				added.push(field.name);
			}
		}
	});

	return { removed, added };
}

/** The note's own moment: a valid `datetime` frontmatter value wins, else the
 *  file's creation time. Guards invalid date strings so a dynamic default can
 *  never render "Invalid date". */
function noteDate(fm: Record<string, unknown>, file: TFile): Date {
	const v = fm.datetime;
	if (typeof v === "string" && v.trim().length > 0) {
		const d = new Date(v);
		if (!Number.isNaN(d.valueOf())) return d;
	}
	return new Date(file.stat.ctime);
}

/** Missing / "" / null / empty array - the states a dynamic default may fill. */
function isEmptyValue(v: unknown): boolean {
	if (v === undefined || v === null || v === "") return true;
	return Array.isArray(v) && v.length === 0;
}
