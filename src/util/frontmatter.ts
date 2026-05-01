import * as yaml from "js-yaml";
import type { FieldSchema, FieldType, TypeSchema } from "../schema/types";

/**
 * Build an initial frontmatter dict for a new note based on a TypeSchema.
 *
 * Order: type, then per-field defaults (in array order), then frontmatter-mode
 * lookups, then auto-refreshed defaults (icon/color/etc. from schema.defaults),
 * then aliases.
 *
 * Prompted values override per-field defaults.
 */

const ARRAY_FIELDS: FieldType[] = ["MultiFile", "Multi", "MultiMedia"];
const LIST_FIELDS: FieldType[] = ["YAML"];

function defaultForField(field: FieldSchema): unknown {
	if (ARRAY_FIELDS.includes(field.type)) return [];
	if (LIST_FIELDS.includes(field.type)) return [];
	if (field.type === "Boolean") return false;
	if (field.type === "Number") return null;
	return "";
}

export function buildFrontmatter(
	schema: TypeSchema,
	prompted: Record<string, unknown>
): Record<string, unknown> {
	const fm: Record<string, unknown> = { type: schema.name };

	for (const f of schema.fields) {
		fm[f.name] = prompted[f.name] !== undefined ? prompted[f.name] : defaultForField(f);
	}

	for (const lookup of schema.lookups) {
		if (lookup.render === "frontmatter") {
			fm[lookup.name] = [];
		}
	}

	// Inject auto-refreshed defaults (icon, color, etc.) — only if the schema
	// didn't already declare them as fields (don't overwrite prompted values).
	for (const [key, value] of Object.entries(schema.defaults ?? {})) {
		if (!(key in fm)) fm[key] = value;
	}

	if (!("aliases" in fm)) fm.aliases = [];

	return fm;
}

/**
 * Render a frontmatter dict as a YAML block bordered by `---` markers.
 */
export function renderFrontmatter(fm: Record<string, unknown>): string {
	const yamlText = yaml.dump(fm, {
		sortKeys: false,
		lineWidth: 10000,
		noRefs: true,
	});
	return `---\n${yamlText}---\n`;
}
