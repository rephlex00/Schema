import { App, TFile } from "obsidian";
import { BuiltinRuntime } from "./runtime/builtin";
import { DataviewRuntime } from "./runtime/dataview";
import type { QueryResult, QueryRuntime } from "./runtime/types";

/**
 * LookupEngine orchestrates query execution. Prefers Dataview when available,
 * falls back to the built-in restricted-subset runtime otherwise.
 *
 * Errors during a query throw, so callers can decide how to surface - the
 * frontmatter renderer logs and skips, the block renderer paints an inline
 * error message.
 */
export class LookupEngine {
	private readonly dataview: DataviewRuntime;
	private readonly builtin: BuiltinRuntime;

	constructor(app: App) {
		this.dataview = new DataviewRuntime(app);
		this.builtin = new BuiltinRuntime(app);
	}

	pick(): QueryRuntime {
		return this.dataview.available() ? this.dataview : this.builtin;
	}

	async run(query: string, current: TFile): Promise<QueryResult> {
		const runtime = this.pick();
		try {
			return await runtime.run(query, current);
		} catch (err) {
			if (runtime.id === "dataview") {
				console.warn("[schema] dataview query threw, retrying with builtin runtime:", err);
				try {
					return await this.builtin.run(query, current);
				} catch (builtinErr) {
					// Surface the ORIGINAL Dataview failure (what the user needs to
					// debug) alongside the builtin's - the builtin is far more
					// restrictive, so its parse error is usually the less useful one.
					const dvMsg = err instanceof Error ? err.message : String(err);
					const biMsg = builtinErr instanceof Error ? builtinErr.message : String(builtinErr);
					throw new Error(`${dvMsg} (builtin fallback also failed: ${biMsg})`);
				}
			}
			throw err;
		}
	}

	usingDataview(): boolean {
		return this.dataview.available();
	}
}
