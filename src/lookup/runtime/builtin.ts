import { App, TFile } from "obsidian";
import type { QueryResult, QueryRuntime } from "./types";

/**
 * Standalone fallback when Dataview isn't installed.
 *
 * Supports a restricted but real-world-useful subset of the Dataview JS query
 * shape: a single top-level `dv.pages('"FOLDER"').filter(callback)` expression.
 * Callbacks see two locals: the iterated page (with `file.path`, `file.name`,
 * and frontmatter fields directly accessible) and `current` (same shape).
 *
 * `current.file.path` and `current.file.name` work, plus all frontmatter
 * fields. `dv.luxon.DateTime.fromFormat(...).toFormat(...)` works for the
 * specific format-conversion calls used by our schema templates.
 *
 * Anything outside this subset throws, which is intentional — the engine
 * surfaces the error and falls back to declaring the query unsupported.
 */
export class BuiltinRuntime implements QueryRuntime {
	readonly id = "builtin" as const;
	private readonly app: App;

	constructor(app: App) {
		this.app = app;
	}

	available(): boolean {
		return true;
	}

	async run(query: string, currentFile: TFile): Promise<QueryResult> {
		const folderMatch = query.match(/dv\.pages\(\s*['"]"([^"]+)"['"]\s*\)/);
		if (!folderMatch) {
			throw new Error(`builtin runtime: query does not start with dv.pages('"FOLDER"')`);
		}
		const folder = folderMatch[1];

		const filterMatch = query.match(/\.filter\(([\s\S]+)\)\s*$/);
		if (!filterMatch) {
			throw new Error(`builtin runtime: query has no .filter(callback) suffix`);
		}
		const callbackSrc = filterMatch[1];

		const callback = this.compileFilter(callbackSrc);
		const pages = this.collectPages(folder);
		const current = this.makePageProxy(currentFile);

		const matches: TFile[] = [];
		for (const { page, file } of pages) {
			try {
				if (callback(page, current, this.luxonShim())) {
					matches.push(file);
				}
			} catch (err) {
				console.warn("[schema] builtin runtime filter threw on", file.path, err);
			}
		}
		return { files: matches };
	}

	private compileFilter(src: string): (page: unknown, current: unknown, dvLuxon: unknown) => boolean {
		// We accept a raw arrow-function source like `m => m.type === "event" && current.file.path === ...`.
		// Free variables `current` and `dv` in the source resolve via parameters
		// of an outer wrapper function — NOT globals — so we don't pollute
		// globalThis during query execution. Errors propagate to the per-file
		// try/catch in run() so we keep the file path in diagnostics.
		const wrapper = new Function(
			"page",
			"current",
			"dv",
			`return (${src})(page);`
		);
		return (page, current, dvLuxon) =>
			Boolean(wrapper(page, current, { luxon: dvLuxon }));
	}

	private collectPages(folder: string): { page: unknown; file: TFile }[] {
		const out: { page: unknown; file: TFile }[] = [];
		const prefix = folder.endsWith("/") ? folder : folder + "/";
		for (const file of this.app.vault.getMarkdownFiles()) {
			if (file.path !== folder && !file.path.startsWith(prefix)) continue;
			out.push({ page: this.makePageProxy(file), file });
		}
		return out;
	}

	private makePageProxy(file: TFile): Record<string, unknown> {
		const cache = this.app.metadataCache.getFileCache(file);
		const fm = (cache?.frontmatter ?? {}) as Record<string, unknown>;
		const proxy: Record<string, unknown> = {
			...fm,
			file: {
				path: file.path,
				name: file.basename,
				link: { path: file.path },
			},
		};
		return proxy;
	}

	/** Tiny Luxon-compatible shim covering the `fromFormat(...).toFormat(...)` flow. */
	private luxonShim() {
		return {
			DateTime: {
				fromFormat(input: string, format: string) {
					return {
						toFormat(out: string) {
							// Minimal — only handle the patterns we use in our schemas.
							// yyyyMMdd → groups of digits.
							const yMatch = input.match(/^(\d{4})(\d{2})(\d{2})$/);
							if (!yMatch || format !== "yyyyMMdd") return "";
							const [, year, month, day] = yMatch;
							const date = new Date(Number(year), Number(month) - 1, Number(day));
							if (out === "yyyyMM-'W'WW") {
								const week = isoWeek(date);
								return `${year}${month}-W${String(week).padStart(2, "0")}`;
							}
							return out;
						},
					};
				},
				fromISO(input: string) {
					const parsed = new Date(input);
					return {
						toFormat(out: string) {
							const y = parsed.getFullYear();
							const m = parsed.getMonth() + 1;
							const d = parsed.getDate();
							if (out === "yyyyMM-'W'WW") {
								const week = isoWeek(parsed);
								return `${y}${String(m).padStart(2, "0")}-W${String(week).padStart(2, "0")}`;
							}
							return out;
						},
					};
				},
			},
		};

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
	}
}
