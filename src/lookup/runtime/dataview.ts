import { App, TFile } from "obsidian";
import { evalExpression } from "../../util/safe-eval";
import type { QueryResult, QueryRuntime } from "./types";

interface DataviewPlugin {
	api?: DataviewApi;
}

interface DataviewApi {
	page(path: string): unknown;
	pages(source?: string): { values: { file: { path: string } }[] };
}

/**
 * Runtime that delegates query execution to Dataview's JS API. Lookup queries
 * are evaluated as `(dv, current) => any` where the result has a `.values`
 * array (Dataview's standard "DataArray" shape).
 */
export class DataviewRuntime implements QueryRuntime {
	readonly id = "dataview" as const;
	private readonly app: App;

	constructor(app: App) {
		this.app = app;
	}

	available(): boolean {
		return Boolean(this.getApi());
	}

	private getApi(): DataviewApi | null {
		const plugin = (this.app as unknown as { plugins?: { plugins?: Record<string, DataviewPlugin> } })
			.plugins?.plugins?.dataview;
		return plugin?.api ?? null;
	}

	async run(query: string, current: TFile): Promise<QueryResult> {
		const api = this.getApi();
		if (!api) return { files: [] };

		const currentPage = api.page(current.path);
		// Evaluated in the sandboxed interpreter (not `new Function`), with the
		// Dataview API and current page provided as scope. Arrow callbacks passed
		// to `.where`/`.filter` become real closures the Dataview API can invoke.
		const result = evalExpression(query, { dv: api, current: currentPage });

		const files: TFile[] = [];
		const seen = new Set<string>();
		for (const v of toValues(result)) {
			const path = extractPath(v);
			if (typeof path !== "string" || seen.has(path)) continue;
			const f = this.app.vault.getAbstractFileByPath(path);
			if (f instanceof TFile) {
				files.push(f);
				seen.add(path);
			}
		}
		return { files };
	}
}

/** Normalize whatever a query returned into an iterable of result rows. Accepts
 *  a Dataview DataArray ({values}), a plain array, or a single page/file/link. */
function toValues(result: unknown): unknown[] {
	if (result == null) return [];
	if (Array.isArray(result)) return result;
	const values = (result as { values?: unknown }).values;
	if (Array.isArray(values)) return values;
	return [result];
}

/** Pull a vault path from a result row: a page (`.file.path`) or a file/link
 *  (`.path`). */
function extractPath(v: unknown): string | undefined {
	if (!v || typeof v !== "object") return undefined;
	const o = v as { file?: { path?: string }; path?: string };
	if (o.file && typeof o.file.path === "string") return o.file.path;
	if (typeof o.path === "string") return o.path;
	return undefined;
}
