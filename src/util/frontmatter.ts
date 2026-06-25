import type { FieldSchema, FieldType, TypeSchema } from "../schema/types";
import { effectiveFields } from "./universal";
import { formatMoment, renderTemplate } from "./liquid";
import { dumpFrontmatterYaml } from "./yaml";

/**
 * Build an initial frontmatter dict for a new note based on a TypeSchema.
 *
 * Order: type-key, then per-field values (the type's fields plus any universal
 * properties, in array order), then frontmatter-mode lookups, then aliases.
 *
 * Each field's value is: the prompted value if given, else the per-object-type
 * default (`schema.defaults[name]`) if set, else the type-generic default.
 */

const ARRAY_FIELDS: FieldType[] = ["MultiFile", "Multi", "MultiMedia", "YAML", "Lookup"];

const DATE_NOW_FORMATS: Partial<Record<FieldType, string>> = {
	Date: "YYYY-MM-DD",
	DateTime: "YYYY-MM-DD HH:mm",
	Time: "HH:mm",
};

/**
 * The type-generic placeholder value for a field, used both when building a new
 * note's frontmatter and when cleaning an existing note's. Array-like types get
 * `[]`, Boolean `false`, Number `null`, a Date/DateTime/Time with `defaultNow`
 * the current timestamp, everything else `""`. Shared so create and clean can't
 * drift apart and churn a property on every type change.
 */
export function defaultForField(field: FieldSchema): unknown {
	if (ARRAY_FIELDS.includes(field.type)) return [];
	if (field.type === "Boolean") return false;
	if (field.type === "Number") return null;
	const nowFormat = DATE_NOW_FORMATS[field.type];
	if (nowFormat && field.options?.defaultNow === true) {
		return formatMoment(nowFormat);
	}
	return "";
}

/** Read a configured object-type key from a frontmatter dict, returning the
 *  string value (or undefined if missing or non-string). */
export function readTypeKey(
	fm: Record<string, unknown> | undefined,
	typeKey: string
): string | undefined {
	if (!fm) return undefined;
	const v = fm[typeKey];
	return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** A "dynamic default" is a string default containing Liquid tags (e.g.
 *  `[[{{date:YYYYMMDD}}]]`). It is rendered at apply time instead of being
 *  written verbatim; `clean.ts` additionally treats it as fill-only so a
 *  reshelve never clobbers a note's historic value with "now". */
export function isDynamicDefault(value: unknown): value is string {
	return typeof value === "string" && value.includes("{{");
}

export function buildFrontmatter(
	schema: TypeSchema,
	prompted: Record<string, unknown>,
	typeKey = "type",
	universal: FieldSchema[] = [],
	renderCtx: Record<string, unknown> = {}
): Record<string, unknown> {
	const fm: Record<string, unknown> = { [typeKey]: schema.name };
	const defaults = schema.defaults ?? {};
	const applyDefault = (value: unknown): unknown =>
		isDynamicDefault(value) ? renderTemplate(value, renderCtx) : value;

	for (const f of effectiveFields(schema, universal)) {
		if (prompted[f.name] !== undefined) {
			fm[f.name] = prompted[f.name];
		} else {
			const dflt = defaults[f.name];
			fm[f.name] = dflt !== undefined && dflt !== "" ? applyDefault(dflt) : defaultForField(f);
		}
	}

	for (const lookup of schema.lookups) {
		if (lookup.render === "frontmatter") {
			fm[lookup.name] = [];
		}
	}

	// Safety net for any default keyed at a name not covered above (e.g. legacy
	// keys not backed by a field). Never overwrites an already-set value.
	for (const [key, value] of Object.entries(defaults)) {
		if (!(key in fm)) fm[key] = applyDefault(value);
	}

	if (!("aliases" in fm)) fm.aliases = [];

	return fm;
}

/**
 * Render a frontmatter dict as a YAML block bordered by `---` markers.
 */
export function renderFrontmatter(fm: Record<string, unknown>): string {
	const yamlText = dumpFrontmatterYaml(fm);
	return `---\n${yamlText}---\n`;
}
