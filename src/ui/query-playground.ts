import { Modal, Setting, TFile } from "obsidian";
import type SchemaPlugin from "../main";

const STARTER_QUERY = `dv.pages('"Moments"').filter(m => m.type === "event")`;

/**
 * Live editor for testing Dataview-shape queries. Renders results below the
 * editor so users can iterate on lookup queries without saving them to a
 * type's schema first.
 *
 * The query runs against the plugin's LookupEngine, which prefers Dataview
 * when installed and falls back to the built-in subset.
 */
export class QueryPlaygroundModal extends Modal {
	private readonly plugin: SchemaPlugin;
	private query = STARTER_QUERY;
	private currentFile: TFile | null;

	constructor(plugin: SchemaPlugin) {
		super(plugin.app);
		this.plugin = plugin;
		this.currentFile = plugin.app.workspace.getActiveFile();
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h3", { text: "Query playground" });
		contentEl.createEl("div", {
			cls: "setting-item-description",
			text: `Test a Dataview-shaped query. The current variable resolves to ${this.currentFile ? `"${this.currentFile.path}"` : "(no active file)"}. Runtime: ${this.plugin.lookups.usingDataview() ? "Dataview" : "built-in"}.`,
		});

		const queryEl = contentEl.createEl("textarea", {
			cls: "schema-query-playground-input",
		});
		queryEl.value = this.query;
		queryEl.rows = 6;
		queryEl.spellcheck = false;
		queryEl.style.width = "100%";
		queryEl.style.fontFamily = "var(--font-monospace)";
		queryEl.style.fontSize = "12px";
		queryEl.addEventListener("input", () => (this.query = queryEl.value));

		const status = contentEl.createEl("div", { cls: "schema-query-status" });
		const results = contentEl.createEl("div", { cls: "schema-query-results" });

		const run = async () => {
			const file = this.currentFile;
			if (!file) {
				status.setText("No active file — open a note before running.");
				results.empty();
				return;
			}
			status.setText("Running…");
			results.empty();
			try {
				const start = performance.now();
				const result = await this.plugin.lookups.run(this.query, file);
				const ms = (performance.now() - start).toFixed(1);
				status.setText(`${result.files.length} result(s) · ${ms} ms`);
				const ul = results.createEl("ul");
				for (const f of result.files) {
					const li = ul.createEl("li");
					const a = li.createEl("a", {
						text: f.path,
						cls: "internal-link",
					});
					a.dataset.href = f.path;
					a.addEventListener("click", () => {
						this.plugin.app.workspace.openLinkText(f.path, file.path, false);
						this.close();
					});
				}
			} catch (err) {
				status.setText(`Error: ${err instanceof Error ? err.message : String(err)}`);
				results.empty();
			}
		};

		new Setting(contentEl)
			.addButton((btn) =>
				btn
					.setButtonText("Run")
					.setCta()
					.onClick(() => void run())
			)
			.addButton((btn) => btn.setButtonText("Close").onClick(() => this.close()));
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
