/**
 * Minimal mustache/liquid template renderer.
 *
 * Supports:
 * - `{{varname}}` substitution from a values dict
 * - `{{varname|filter}}` with built-in filters: lower, upper, slug, slice:start:end
 * - Whitespace trimming inside `{{ varname }}`
 *
 * Missing variables render as empty strings (silently). Unknown filters pass
 * the value through unchanged.
 *
 * This is deliberately tiny; we don't need conditionals, loops, or includes
 * for filename / folder templates.
 */

const TAG_RE = /\{\{\s*([^}]+?)\s*\}\}/g;

type Filter = (input: string, ...args: string[]) => string;

const FILTERS: Record<string, Filter> = {
	lower: (s) => s.toLowerCase(),
	upper: (s) => s.toUpperCase(),
	slug: (s) =>
		s
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, ""),
	slice: (s, startStr, endStr) => {
		const start = startStr ? Number.parseInt(startStr, 10) : 0;
		const end = endStr ? Number.parseInt(endStr, 10) : undefined;
		return s.slice(start, end);
	},
	year: (s) => s.slice(0, 4),
};

export function renderTemplate(template: string, values: Record<string, unknown>): string {
	return template.replace(TAG_RE, (_match, expr: string) => {
		const [varPart, ...filterParts] = expr.split("|").map((p) => p.trim());
		const value = lookupVar(varPart, values);
		let str = stringify(value);
		for (const fp of filterParts) {
			const [name, ...args] = fp.split(":").map((p) => p.trim());
			const filter = FILTERS[name];
			if (filter) str = filter(str, ...args);
		}
		return str;
	});
}

function lookupVar(name: string, values: Record<string, unknown>): unknown {
	// Support a single dot for shallow nesting (e.g., `current.path`).
	if (name.includes(".")) {
		const parts = name.split(".");
		let cur: unknown = values;
		for (const p of parts) {
			if (cur && typeof cur === "object" && p in (cur as Record<string, unknown>)) {
				cur = (cur as Record<string, unknown>)[p];
			} else {
				return undefined;
			}
		}
		return cur;
	}
	return values[name];
}

function stringify(value: unknown): string {
	if (value == null) return "";
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	if (Array.isArray(value)) return value.map(stringify).join(", ");
	return String(value);
}
