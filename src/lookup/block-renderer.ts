import { MarkdownRenderChild, MarkdownPostProcessorContext, TFile } from "obsidian";
import type SchemaPlugin from "../main";
import { readTypeKey } from "../util/frontmatter";

/**
 * Renders `\`\`\`schema-lookup <name>\`\`\`` blocks. The body of the code
 * block is interpreted as the lookup name to invoke (it must match a Lookup
 * defined in the active file's TypeSchema).
 *
 * Live-updates: re-runs the query and re-renders whenever any markdown file
 * changes - Dataview/MM users will recognize this pattern.
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

type LookupState =
	| { kind: "error"; message: string }
	| { kind: "empty" }
	| { kind: "count"; count: number }
	| { kind: "list"; inline: boolean; files: Array<{ path: string; basename: string }> };

class SchemaLookupRenderChild extends MarkdownRenderChild {
	private readonly plugin: SchemaPlugin;
	private readonly ctx: MarkdownPostProcessorContext;
	private readonly lookupName: string;
	private rerenderTimer: number | null = null;
	/** Signature of the last painted state; lets a rerender bail before touching
	 *  the DOM when the result is unchanged (the common case when an unrelated
	 *  file - or our own frontmatter-lookup writes - fire metadataCache.changed). */
	private lastSignature: string | null = null;

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
		const state = await this.computeState();
		const signature = JSON.stringify(state);
		// Bail before touching the DOM when the result hasn't changed (only when
		// something is already painted - the first render must always paint).
		if (signature === this.lastSignature && this.containerEl.childElementCount > 0) {
			return;
		}
		this.lastSignature = signature;
		this.paint(state);
	}

	/** Resolve the lookup and run its query, returning the state to render. Never
	 *  throws - query failures become an error state. */
	private async computeState(): Promise<LookupState> {
		const file = this.plugin.app.vault.getAbstractFileByPath(this.ctx.sourcePath);
		if (!(file instanceof TFile)) return { kind: "error", message: "source file not found" };

		const cache = this.plugin.app.metadataCache.getFileCache(file);
		const typeKey = this.plugin.settings.typeKey;
		const type = readTypeKey(
			cache?.frontmatter as Record<string, unknown> | undefined,
			typeKey
		);
		if (!type) return { kind: "error", message: `active file has no \`${typeKey}:\` frontmatter` };

		const schema = this.plugin.loader.getResolved(type);
		if (!schema) return { kind: "error", message: `unknown object type "${type}"` };

		const lookup = schema.lookups.find((l) => l.name === this.lookupName);
		if (!lookup) return { kind: "error", message: `type "${type}" has no lookup "${this.lookupName}"` };

		try {
			const result = await this.plugin.lookups.run(lookup.query, file);
			if (result.files.length === 0) return { kind: "empty" };
			if (lookup.output === "count") return { kind: "count", count: result.files.length };
			const files = result.files.map((f) => ({ path: f.path, basename: f.basename }));
			// "list" renders inline (comma-separated); "bullet-list" (and the
			// legacy unset default) render as a <ul>.
			return { kind: "list", inline: lookup.output === "list", files };
		} catch (err) {
			console.error("[schema] lookup query failed:", err);
			return { kind: "error", message: err instanceof Error ? err.message : String(err) };
		}
	}

	private paint(state: LookupState): void {
		this.containerEl.empty();
		this.containerEl.addClass("schema-lookup-block");

		if (state.kind === "error") {
			this.containerEl.createEl("em", { text: `schema-lookup error: ${state.message}` });
			return;
		}
		if (state.kind === "empty") {
			this.containerEl.createEl("em", { text: `(no ${this.lookupName})` });
			return;
		}
		if (state.kind === "count") {
			this.containerEl.createEl("span", { text: String(state.count) });
			return;
		}
		if (state.inline) {
			const span = this.containerEl.createSpan({ cls: "schema-lookup-inline" });
			state.files.forEach((f, i) => {
				if (i > 0) span.appendText(", ");
				this.appendLink(span, f);
			});
			return;
		}
		const ul = this.containerEl.createEl("ul");
		for (const f of state.files) {
			this.appendLink(ul.createEl("li"), f);
		}
	}

	private appendLink(parent: HTMLElement, f: { path: string; basename: string }): void {
		const link = parent.createEl("a", { text: f.basename, cls: "internal-link" });
		link.dataset.href = f.path;
		link.setAttr("href", f.path);
		link.addEventListener("click", (ev) => {
			ev.preventDefault();
			void this.plugin.app.workspace.openLinkText(f.path, this.ctx.sourcePath, ev.metaKey || ev.ctrlKey);
		});
	}
}
