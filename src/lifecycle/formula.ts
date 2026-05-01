import { App, TFile } from "obsidian";

/**
 * Evaluate a Formula field's JS expression against an active note. The
 * expression has access to:
 * - `fm`: the note's frontmatter dict
 * - `file`: a small file proxy with `path` and `name` (basename)
 *
 * Returns the stringified result, or an error message prefixed with `!err:`.
 *
 * Note: this uses `new Function` for evaluation, same trust model as the
 * Lookup query runtime. Don't run formulas from untrusted sources.
 */
export function evaluateFormula(app: App, file: TFile, expression: string): string {
	const cache = app.metadataCache.getFileCache(file);
	const fm = (cache?.frontmatter ?? {}) as Record<string, unknown>;
	try {
		const fn = new Function("fm", "file", `return (${expression});`);
		const result = fn(fm, { path: file.path, name: file.basename });
		if (result == null) return "";
		if (typeof result === "object") return JSON.stringify(result);
		return String(result);
	} catch (err) {
		return `!err: ${err instanceof Error ? err.message : String(err)}`;
	}
}
