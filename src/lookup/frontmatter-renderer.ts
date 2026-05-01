import { Notice, TFile } from "obsidian";
import type SchemaPlugin from "../main";
import type { TypeSchema } from "../schema/types";

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
		const schemas = this.plugin.loader.getAll();
		const schemasByName = new Map<string, TypeSchema>(schemas.map((s) => [s.name, s]));

		const candidates = this.plugin.app.vault.getMarkdownFiles();
		let updated = 0;
		let errors = 0;

		for (const file of candidates) {
			const cache = this.plugin.app.metadataCache.getFileCache(file);
			const type = cache?.frontmatter?.type;
			if (typeof type !== "string") continue;
			const schema = schemasByName.get(type);
			if (!schema) continue;
			const fmLookups = schema.lookups.filter(
				(l) => l.render === "frontmatter" || l.render === undefined
			);
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
		const fmLookups = schema.lookups.filter((l) => l.render === "frontmatter" || l.render === undefined);
		if (fmLookups.length === 0) return false;

		const next = new Map<string, string[]>();
		for (const lookup of fmLookups) {
			const result = await this.plugin.lookups.run(lookup.query, file);
			next.set(
				lookup.name,
				result.files.map((f) => `[[${f.path.replace(/\.md$/, "")}|${f.basename}]]`)
			);
		}

		this.inFlight.add(file.path);
		try {
			let changed = false;
			await this.plugin.app.fileManager.processFrontMatter(file, (fm) => {
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

	/** Insert a `\`\`\`schema-lookup <name>\`\`\`` block into a file's body if it isn't already there. */
	static blockSnippet(name: string): string {
		return "```schema-lookup\n" + name + "\n```";
	}
}

/**
 * Migration helper: convert all frontmatter-mode lookups in the schemas to
 * block-mode, strip their YAML keys from instance notes, and append code
 * blocks to the body of each instance.
 */
export async function migrateLookupsToBlock(plugin: SchemaPlugin): Promise<void> {
	const schemas = plugin.loader.getAll();
	let touchedSchemas = 0;
	let touchedNotes = 0;

	for (const schema of schemas) {
		const fmLookups = schema.lookups.filter((l) => l.render !== "block");
		if (fmLookups.length === 0) continue;

		// Update the schema YAML in place — set render: block on each affected lookup field.
		const sourceFile = plugin.app.vault.getAbstractFileByPath(schema.sourcePath);
		if (!(sourceFile instanceof TFile)) continue;
		await plugin.app.fileManager.processFrontMatter(sourceFile, (fm) => {
			const fields = (fm.fields as Record<string, unknown>[]) ?? [];
			for (const f of fields) {
				if (f.type !== "Lookup") continue;
				const opts = (f.options as Record<string, unknown>) ?? {};
				opts.render = "block";
				f.options = opts;
			}
		});
		touchedSchemas++;
	}

	// Now rewrite instance bodies: append schema-lookup blocks, strip stale frontmatter keys.
	const candidates = plugin.app.vault.getMarkdownFiles();
	for (const file of candidates) {
		const cache = plugin.app.metadataCache.getFileCache(file);
		const type = cache?.frontmatter?.type;
		if (typeof type !== "string") continue;
		const schema = plugin.loader.get(type);
		if (!schema) continue;
		const lookups = schema.lookups;
		if (lookups.length === 0) continue;

		// Strip frontmatter keys
		await plugin.app.fileManager.processFrontMatter(file, (fm) => {
			for (const lookup of lookups) {
				if (lookup.name in fm) delete fm[lookup.name];
			}
		});

		// Append blocks if not present
		let body = await plugin.app.vault.read(file);
		const lines: string[] = [];
		for (const lookup of lookups) {
			const marker = "```schema-lookup\n" + lookup.name + "\n```";
			if (body.includes(marker)) continue;
			lines.push("\n## " + lookup.name + "\n" + marker);
		}
		if (lines.length > 0) {
			body = body + "\n" + lines.join("\n") + "\n";
			await plugin.app.vault.modify(file, body);
			touchedNotes++;
		}
	}

	new Notice(`Schema: migrated ${touchedSchemas} schemas, ${touchedNotes} notes to block lookups.`);
}
