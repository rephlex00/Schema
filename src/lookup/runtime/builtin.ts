import { App, TFile } from "obsidian";
import { isoWeek } from "../../util/liquid";
import { evalExpression } from "../../util/safe-eval";
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
 * Anything outside this subset throws, which is intentional - the engine
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
		const folders = this.parseSources(query);

		const filterMatch = query.match(/\.filter\(([\s\S]+)\)\s*$/);
		if (!filterMatch) {
			throw new Error(`builtin runtime: query has no .filter(callback) suffix`);
		}
		const callbackSrc = filterMatch[1];

		const current = this.makePageProxy(currentFile);
		const callback = this.compileFilter(callbackSrc, current);
		const pages = this.collectPages(folders);

		const matches: TFile[] = [];
		for (const { page, file } of pages) {
			try {
				if (callback(page)) {
					matches.push(file);
				}
			} catch (err) {
				console.warn("[schema] builtin runtime filter threw on", file.path, err);
			}
		}
		return { files: matches };
	}

	private compileFilter(src: string, current: unknown): (page: unknown) => boolean {
		// We accept a raw arrow-function source like `m => m.type === "event" && current.file.path === ...`.
		// The source is evaluated once (here) in the sandboxed interpreter, with
		// `current` and `dv` provided as scope variables - NOT globals - so query
		// execution can't reach app globals or the Function constructor. The
		// resulting arrow becomes a real closure we invoke per page; errors
		// propagate to the per-file try/catch in run() so we keep the file path
		// in diagnostics.
		const arrow = evalExpression(src, { current, dv: { luxon: this.luxonShim() } });
		if (typeof arrow !== "function") {
			throw new Error("builtin runtime: .filter() argument is not a function");
		}
		return (page) => Boolean((arrow as (p: unknown) => unknown)(page));
	}

	/** Parse the folder source(s) from a `dv.pages(...)` head. Supports the forms
	 *  the synthesized inverse-lookup queries emit:
	 *  - `dv.pages('"Folder"')`        → ["Folder"]
	 *  - `dv.pages('"A" or "B"')`      → ["A", "B"]   (multi-folder union)
	 *  - `dv.pages()` / `dv.pages('')` → null         (scan the whole vault)
	 *  Throws on any other shape so the engine declares the query unsupported. */
	private parseSources(query: string): string[] | null {
		const quoted = query.match(/dv\.pages\(\s*(['"])([\s\S]*?)\1\s*\)/);
		if (quoted) {
			const folders = Array.from(quoted[2].matchAll(/"([^"]+)"/g)).map((m) => m[1]);
			return folders.length > 0 ? folders : null; // empty source string → whole vault
		}
		if (/dv\.pages\(\s*\)/.test(query)) return null;
		throw new Error(`builtin runtime: unsupported dv.pages(...) source`);
	}

	private collectPages(folders: string[] | null): { page: unknown; file: TFile }[] {
		const out: { page: unknown; file: TFile }[] = [];
		for (const file of this.app.vault.getMarkdownFiles()) {
			if (folders !== null && !inAnyFolder(file.path, folders)) continue;
			out.push({ page: this.makePageProxy(file), file });
		}
		return out;
	}

	private makePageProxy(file: TFile): Record<string, unknown> {
		const cache = this.app.metadataCache.getFileCache(file);
		const fm = (cache?.frontmatter ?? {}) as Record<string, unknown>;
		const proxy: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(fm)) {
			proxy[k] = this.linkify(v, file.path);
		}
		proxy.file = {
			path: file.path,
			name: file.basename,
			link: { path: file.path },
		};
		return proxy;
	}

	/** File/MultiFile values are persisted as wikilink strings ("[[path]]"), but
	 *  the synthesized inverse-lookup predicates expect Dataview Link objects with
	 *  a `.path`. Convert wikilink strings (and arrays of them) into `{path}`
	 *  objects so the builtin matches the same shape Dataview produces. Values
	 *  that are already objects, or plain strings that aren't wikilinks, pass
	 *  through unchanged. */
	private linkify(value: unknown, sourcePath: string): unknown {
		if (typeof value === "string") {
			const path = this.resolveWikilink(value, sourcePath);
			return path ? { path, link: { path } } : value;
		}
		if (Array.isArray(value)) return value.map((v) => this.linkify(v, sourcePath));
		return value;
	}

	private resolveWikilink(value: string, sourcePath: string): string | null {
		const m = value.match(/^\s*\[\[(.+?)(?:\|[\s\S]*?)?\]\]\s*$/);
		if (!m) return null;
		const linktext = m[1].trim();
		const mc = this.app.metadataCache as unknown as {
			getFirstLinkpathDest?: (linkpath: string, sourcePath: string) => { path: string } | null;
		};
		if (typeof mc.getFirstLinkpathDest === "function") {
			const dest = mc.getFirstLinkpathDest(linktext, sourcePath);
			if (dest) return dest.path;
		}
		// Fallback (no metadataCache resolver): treat the link text as a vault-
		// relative path, adding a .md extension when none is present. Matches how
		// Schema writes File values (the full path with the .md stripped).
		return /\.[A-Za-z0-9]+$/.test(linktext) ? linktext : `${linktext}.md`;
	}

	/** Tiny Luxon-compatible shim covering the `fromFormat(...).toFormat(...)` flow. */
	private luxonShim() {
		return {
			DateTime: {
				fromFormat(input: string, format: string) {
					return {
						toFormat(out: string) {
							// Minimal - only handle the patterns we use in our schemas.
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
	}
}

/** Whether `path` sits inside any of the given folders (or one of their
 *  subfolders). An empty-string folder matches the vault root. */
function inAnyFolder(path: string, folders: string[]): boolean {
	return folders.some((folder) => {
		if (folder === "") return true;
		const prefix = folder.endsWith("/") ? folder : folder + "/";
		return path === folder || path.startsWith(prefix);
	});
}
