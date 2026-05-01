import * as yaml from "js-yaml";

/**
 * Build an initial frontmatter dict for a new note based on a TypeSchema.
 *
 * Includes:
 * - `type:` set to the schema name
 * - All schema fields with empty defaults (string for Input, [] for arrays, "" else)
 * - Any prompted values overlaid on top
 *
 * This is used by Phase 2's CreateCommand to seed a new file. Per-field defaults
 * are intentionally permissive: a Lookup field starts as an empty list, a
 * MultiFile starts as `[]`, an Input starts as `""`. Strings remain quoted via
 * yaml.dump rather than rendered as bare scalars to avoid YAML auto-coercion
 * (e.g. dates).
 */
import type { FieldSchema, FieldType, TypeSchema } from "../schema/types";

const ARRAY_FIELDS: FieldType[] = ["MultiFile", "Multi", "MultiMedia"];
const LIST_FIELDS: FieldType[] = ["YAML"];

function defaultForField(field: FieldSchema): unknown {
	if (ARRAY_FIELDS.includes(field.type)) return [];
	if (field.type === "Lookup") return [];
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

	// Order: known order in `fieldsOrder`, then any not listed.
	const ordered: FieldSchema[] = [];
	const seen = new Set<string>();
	for (const id of schema.fieldsOrder ?? []) {
		const f = schema.fields.find((x) => x.id === id);
		if (f && !seen.has(f.id)) {
			ordered.push(f);
			seen.add(f.id);
		}
	}
	for (const f of schema.fields) {
		if (!seen.has(f.id)) ordered.push(f);
	}

	for (const f of ordered) {
		// Skip Lookup fields here when their render mode is `block`; they live in body, not frontmatter.
		if (f.type === "Lookup") {
			const lookup = schema.lookups.find((l) => l.name === f.name);
			if (lookup?.render === "block") continue;
		}
		fm[f.name] = prompted[f.name] !== undefined ? prompted[f.name] : defaultForField(f);
	}

	// Inject icon and color from schema defaults if the schema didn't list them as fields.
	if (schema.icon && !("icon" in fm)) fm.icon = schema.icon;
	if (schema.color && !("color" in fm)) fm.color = schema.color;
	if (!("aliases" in fm)) fm.aliases = [];

	return fm;
}

/**
 * Render a frontmatter dict as a YAML block bordered by `---` markers.
 * Always ends with a trailing newline.
 */
export function renderFrontmatter(fm: Record<string, unknown>): string {
	const yamlText = yaml.dump(fm, {
		sortKeys: false,
		lineWidth: 10000,
		noRefs: true,
	});
	return `---\n${yamlText}---\n`;
}
