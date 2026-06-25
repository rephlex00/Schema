import type { TFile } from "obsidian";

export interface QueryResult {
	/** Resolved files matching the query, in stable order. */
	files: TFile[];
}

export interface QueryRuntime {
	readonly id: "dataview" | "builtin";
	/** Whether this runtime is currently usable (e.g. Dataview installed/loaded). */
	available(): boolean;
	/** Run a query string with `current` bound to the given file. */
	run(query: string, current: TFile): Promise<QueryResult>;
}
