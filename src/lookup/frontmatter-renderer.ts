import { TFile } from "obsidian";
import type SchemaPlugin from "../main";
import type { TypeSchema } from "../schema/types";
import { readTypeKey } from "../util/frontmatter";

/**
 * Frontmatter-mode lookup renderer.
 *
 * For every file whose `type:` matches a schema with `render: frontmatter`
 * lookups, runs each query and writes the resulting list of wikilinks back
 * into the file's frontmatter.
 *
 * Triggered:
 * - Manually via `Schema: Refresh frontmatter lookups` command
 * - Automatically (debounced) when any markdown file changes, scoped to entity
 *   files (those whose schema actually has frontmatter-mode lookups)
 *
 * Avoids self-loops by skipping files we just wrote to.
 */
export class FrontmatterLookupRenderer {
	private readonly plugin: SchemaPlugin;
	private inFlight = new Set<string>();
	private debounce: number | null = null;
	private dirty = new Set<string>();

	constructor(plugin: SchemaPlugin) {
		this.plugin = plugin;
	}

	start(): void {
		this.plugin.registerEvent(
			this.plugin.app.metadataCache.on("changed", (file) => this.onAnyChanged(file))
		);
	}

	private onAnyChanged(file: TFile): void {
		if (this.inFlight.has(file.path)) return;
		// A change to one file potentially affects the lookups of MANY entity files.
		// Schedule a vault-wide refresh instead of trying to be precise.
		this.scheduleRefresh();
	}

	private scheduleRefresh(): void {
		if (this.debounce != null) window.clearTimeout(this.debounce);
		this.debounce = window.setTimeout(() => {
			this.debounce = null;
			void this.refreshAll();
		}, 1500);
	}

	async refreshAll(): Promise<{ updated: number; errors: number }> {
		const schemas = this.plugin.loader.getAllResolved();
		const schemasByName = new Map<string, TypeSchema>(schemas.map((s) => [s.name, s]));

		const candidates = this.plugin.app.vault.getMarkdownFiles();
		let updated = 0;
		let errors = 0;

		const typeKey = this.plugin.settings.typeKey;
		for (const file of candidates) {
			const cache = this.plugin.app.metadataCache.getFileCache(file);
			const type = readTypeKey(
				cache?.frontmatter as Record<string, unknown> | undefined,
				typeKey
			);
			if (!type) continue;
			const schema = schemasByName.get(type);
			if (!schema) continue;
			const fmLookups = schema.lookups.filter((l) => l.render === "frontmatter");
			if (fmLookups.length === 0) continue;

			try {
				const wrote = await this.refreshOne(file, schema);
				if (wrote) updated++;
			} catch (err) {
				errors++;
				console.error("[schema] lookup refresh failed for", file.path, err);
			}
		}

		return { updated, errors };
	}

	private async refreshOne(file: TFile, schema: TypeSchema): Promise<boolean> {
		const fmLookups = schema.lookups.filter((l) => l.render === "frontmatter");
		if (fmLookups.length === 0) return false;

		const next = new Map<string, string[]>();
		for (const lookup of fmLookups) {
			const result = await this.plugin.lookups.run(lookup.query, file);
			next.set(
				lookup.name,
				result.files.map((f) => `[[${f.path.replace(/\.md$/, "")}|${f.basename}]]`)
			);
		}

		// Equality check BEFORE processFrontMatter. Without this, even no-op
		// passes can fire metadataCache.changed (some Obsidian versions do)
		// which restarts the 1500ms debounce in scheduleRefresh - perpetual loop.
		const cache = this.plugin.app.metadataCache.getFileCache(file);
		const currentFm = (cache?.frontmatter ?? {}) as Record<string, unknown>;
		let needsWrite = false;
		for (const [name, links] of next) {
			const before = JSON.stringify(currentFm[name] ?? []);
			const after = JSON.stringify(links);
			if (before !== after) {
				needsWrite = true;
				break;
			}
		}
		if (!needsWrite) return false;

		this.inFlight.add(file.path);
		try {
			let changed = false;
			await this.plugin.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
				for (const [name, links] of next) {
					const before = JSON.stringify(fm[name] ?? []);
					const after = JSON.stringify(links);
					if (before !== after) {
						fm[name] = links;
						changed = true;
					}
				}
			});
			return changed;
		} finally {
			this.inFlight.delete(file.path);
		}
	}
}
