/**
 * Minimal mustache/liquid template renderer.
 *
 * Supports:
 * - `{{varname}}` substitution from a values dict
 * - `{{varname|filter}}` with built-in filters: lower, upper, slug, slice:start:end, year
 * - Whitespace trimming inside `{{ varname }}`
 * - Obsidian-style `{{date}}` / `{{date:FORMAT}}` and `{{time}}` / `{{time:FORMAT}}`
 *   using moment.js format tokens (YYYY, MM, DD, HH, mm, etc.)
 *
 * Missing variables render as empty strings (silently). Unknown filters pass
 * the value through unchanged.
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
		const dateMatch = parseDateExpr(varPart);
		let str: string;
		if (dateMatch) {
			str = formatDate(dateMatch.kind, dateMatch.format, asDate(values));
		} else {
			str = stringify(lookupVar(varPart, values));
		}
		for (const fp of filterParts) {
			const [name, ...args] = fp.split(":").map((p) => p.trim());
			const filter = FILTERS[name];
			if (filter) str = filter(str, ...args);
		}
		return str;
	});
}

/** Recognize Obsidian moment-style `date` / `date:FORMAT` / `time` / `time:FORMAT`. */
function parseDateExpr(varPart: string): { kind: "date" | "time"; format: string } | null {
	if (varPart === "date") return { kind: "date", format: "YYYY-MM-DD" };
	if (varPart === "time") return { kind: "time", format: "HH:mm" };
	if (varPart.startsWith("date:")) return { kind: "date", format: varPart.slice(5).trim() };
	if (varPart.startsWith("time:")) return { kind: "time", format: varPart.slice(5).trim() };
	return null;
}

/** Use the date in `values.__now` if present (for deterministic tests / consistent
 *  context), otherwise the current wall-clock time. */
function asDate(values: Record<string, unknown>): Date {
	const v = values.__now;
	if (v instanceof Date) return v;
	if (typeof v === "string" || typeof v === "number") {
		const d = new Date(v);
		if (!Number.isNaN(d.valueOf())) return d;
	}
	return new Date();
}

/** Format a Date with a moment-style format string. Uses window.moment if
 *  available (Obsidian runtime), otherwise a tiny built-in formatter that
 *  covers the tokens used in templates. */
function formatDate(_kind: "date" | "time", format: string, date: Date): string {
	const moment = (globalThis as { moment?: (d: Date) => { format: (f: string) => string } }).moment;
	if (typeof moment === "function") {
		try {
			return moment(date).format(format);
		} catch {
			// fall through to built-in
		}
	}
	return formatTokens(format, date);
}

/** Built-in subset of moment tokens. Chosen so unit tests work without moment.
 *  Token order matters: longer tokens first. `[…]` is a literal escape. */
const TOKEN_RE = /\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|DDDD|DDD|DD|D|dddd|ddd|HH|H|hh|h|mm|m|ss|s|WW|W|A|a/g;

function formatTokens(format: string, date: Date): string {
	const pad = (n: number, w = 2) => String(n).padStart(w, "0");
	const Y = date.getFullYear();
	const M = date.getMonth() + 1;
	const D = date.getDate();
	const H = date.getHours();
	const mm = date.getMinutes();
	const ss = date.getSeconds();
	const wk = isoWeek(date);
	const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
	const monthShort = monthNames.map((n) => n.slice(0, 3));
	const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
	const dayShort = dayNames.map((n) => n.slice(0, 3));

	return format.replace(TOKEN_RE, (match, escaped) => {
		if (escaped !== undefined) return escaped;
		switch (match) {
			case "YYYY": return String(Y);
			case "YY": return String(Y).slice(-2);
			case "MMMM": return monthNames[M - 1];
			case "MMM": return monthShort[M - 1];
			case "MM": return pad(M);
			case "M": return String(M);
			case "DD": return pad(D);
			case "D": return String(D);
			case "dddd": return dayNames[date.getDay()];
			case "ddd": return dayShort[date.getDay()];
			case "HH": return pad(H);
			case "H": return String(H);
			case "hh": return pad(((H + 11) % 12) + 1);
			case "h": return String(((H + 11) % 12) + 1);
			case "mm": return pad(mm);
			case "m": return String(mm);
			case "ss": return pad(ss);
			case "s": return String(ss);
			case "A": return H < 12 ? "AM" : "PM";
			case "a": return H < 12 ? "am" : "pm";
			case "WW": return pad(wk);
			case "W": return String(wk);
			default: return match;
		}
	});
}

function isoWeek(date: Date): number {
	const target = new Date(date.valueOf());
	const dayNr = (date.getDay() + 6) % 7;
	target.setDate(target.getDate() - dayNr + 3);
	const firstThursday = target.valueOf();
	target.setMonth(0, 1);
	if (target.getDay() !== 4) {
		target.setMonth(0, 1 + ((4 - target.getDay() + 7) % 7));
	}
	return Math.ceil((firstThursday - target.valueOf()) / 604800000) + 1;
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
