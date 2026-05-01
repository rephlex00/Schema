import { MarkdownRenderChild, MarkdownPostProcessorContext, TFile } from "obsidian";
import type SchemaPlugin from "../main";

/**
 * Renders `\`\`\`schema-lookup <name>\`\`\`` blocks. The body of the code
 * block is interpreted as the lookup name to invoke (it must match a Lookup
 * defined in the active file's TypeSchema).
 *
 * Live-updates: re-runs the query and re-renders whenever any markdown file
 * changes — Dataview/MM users will recognize this pattern.
 */
export function registerBlockRenderer(plugin: SchemaPlugin): void {
	plugin.registerMarkdownCodeBlockProcessor("schema-lookup", async (source, el, ctx) => {
		const name = source.trim();
		if (!name) {
			el.createEl("em", { text: "schema-lookup: missing lookup name" });
			return;
		}

		const child = new SchemaLookupRenderChild(plugin, ctx, el, name);
		ctx.addChild(child);
		await child.render();
	});
}

class SchemaLookupRenderChild extends MarkdownRenderChild {
	private readonly plugin: SchemaPlugin;
	private readonly ctx: MarkdownPostProcessorContext;
	private readonly lookupName: string;
	private rerenderTimer: number | null = null;

	constructor(
		plugin: SchemaPlugin,
		ctx: MarkdownPostProcessorContext,
		container: HTMLElement,
		lookupName: string
	) {
		super(container);
		this.plugin = plugin;
		this.ctx = ctx;
		this.lookupName = lookupName;
	}

	onload(): void {
		this.registerEvent(this.plugin.app.metadataCache.on("changed", () => this.scheduleRerender()));
	}

	onunload(): void {
		if (this.rerenderTimer != null) {
			window.clearTimeout(this.rerenderTimer);
			this.rerenderTimer = null;
		}
	}

	private scheduleRerender(): void {
		if (this.rerenderTimer != null) window.clearTimeout(this.rerenderTimer);
		this.rerenderTimer = window.setTimeout(() => {
			this.rerenderTimer = null;
			void this.render();
		}, 250);
	}

	async render(): Promise<void> {
		this.containerEl.empty();
		this.containerEl.addClass("schema-lookup-block");

		const file = this.plugin.app.vault.getAbstractFileByPath(this.ctx.sourcePath);
		if (!(file instanceof TFile)) {
			this.error("source file not found");
			return;
		}
		const cache = this.plugin.app.metadataCache.getFileCache(file);
		const type = cache?.frontmatter?.type;
		if (typeof type !== "string") {
			this.error("active file has no `type:` frontmatter");
			return;
		}
		const schema = this.plugin.loader.getResolved(type);
		if (!schema) {
			this.error(`unknown type "${type}"`);
			return;
		}
		const lookup = schema.lookups.find((l) => l.name === this.lookupName);
		if (!lookup) {
			this.error(`type "${type}" has no lookup "${this.lookupName}"`);
			return;
		}

		try {
			const result = await this.plugin.lookups.run(lookup.query, file);
			if (result.files.length === 0) {
				this.containerEl.createEl("em", { text: `(no ${this.lookupName})` });
				return;
			}
			if (lookup.output === "count") {
				this.containerEl.createEl("span", { text: String(result.files.length) });
				return;
			}
			if (lookup.output === "bullet-list" || lookup.output === undefined || lookup.output === "list") {
				const ul = this.containerEl.createEl("ul");
				for (const f of result.files) {
					const li = ul.createEl("li");
					const link = li.createEl("a", {
						text: f.basename,
						cls: "internal-link",
					});
					link.dataset.href = f.path;
					link.setAttr("href", f.path);
					link.addEventListener("click", (ev) => {
						ev.preventDefault();
						this.plugin.app.workspace.openLinkText(f.path, this.ctx.sourcePath, ev.metaKey || ev.ctrlKey);
					});
				}
				return;
			}
		} catch (err) {
			console.error("[schema] lookup query failed:", err);
			this.error(err instanceof Error ? err.message : String(err));
		}
	}

	private error(message: string): void {
		this.containerEl.empty();
		this.containerEl.createEl("em", { text: `schema-lookup error: ${message}` });
	}
}
