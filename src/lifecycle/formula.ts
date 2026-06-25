import { App, TFile } from "obsidian";
import { evalExpression } from "../util/safe-eval";

/**
 * Evaluate a Formula field's JS expression against an active note. The
 * expression has access to:
 * - `fm`: the note's frontmatter dict
 * - `file`: a small file proxy with `path` and `name` (basename)
 *
 * Returns the stringified result, or an error message prefixed with `!err:`.
 *
 * Evaluation runs in the sandboxed interpreter (see `util/safe-eval`), not
 * `new Function`/`eval`, so a formula can't reach app globals or the Function
 * constructor. Same trust model as the Lookup query runtime.
 */
export function evaluateFormula(app: App, file: TFile, expression: string): string {
	const cache = app.metadataCache.getFileCache(file);
	const fm = (cache?.frontmatter ?? {}) as Record<string, unknown>;
	try {
		const result = evalExpression(expression, {
			fm,
			file: { path: file.path, name: file.basename },
		});
		if (result == null) return "";
		if (typeof result === "object") return JSON.stringify(result);
		return String(result);
	} catch (err) {
		return `!err: ${err instanceof Error ? err.message : String(err)}`;
	}
}
