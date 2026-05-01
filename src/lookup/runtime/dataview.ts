import { App, TFile } from "obsidian";
import type { QueryResult, QueryRuntime } from "./types";

interface DataviewPlugin {
	api?: DataviewApi;
}

interface DataviewApi {
	page(path: string): unknown;
	pages(source?: string): { values: { file: { path: string } }[] };
	luxon: unknown;
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

		const fn = new Function("dv", "current", `return ${query};`);
		const currentPage = api.page(current.path);
		const result = fn(api, currentPage) as { values?: unknown[] };

		const values = Array.isArray(result?.values) ? result.values : [];
		const files: TFile[] = [];
		const seen = new Set<string>();
		for (const v of values) {
			const path = (v as { file?: { path?: string } })?.file?.path;
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
