import { App, FuzzySuggestModal, Modal, Setting, TFile } from "obsidian";
import { evaluateFormula } from "../lifecycle/formula";
import type SchemaPlugin from "../main";
import type { FieldSchema, TypeSchema } from "../schema/types";

/**
 * Modal that edits a single frontmatter field on the active note.
 *
 * The widget chosen depends on the field's type:
 *  - Input          → text
 *  - Number         → numeric text
 *  - Boolean        → toggle
 *  - Select / Cycle → dropdown sourced from valuesFrom or valuesList
 *  - File           → fuzzy file picker (filtered by `target` fileClass folder)
 *  - MultiFile/Multi→ comma-separated text (Phase 6 minimum; full multi-picker is v2)
 *  - Date / DateTime→ text (ISO format)
 *  - YAML           → multiline text
 *  - Lookup         → read-only result preview + Refresh button
 */
export class FieldEditModal extends Modal {
	private readonly plugin: SchemaPlugin;
	private readonly file: TFile;
	private readonly schema: TypeSchema;
	private readonly field: FieldSchema;

	constructor(plugin: SchemaPlugin, file: TFile, schema: TypeSchema, field: FieldSchema) {
		super(plugin.app);
		this.plugin = plugin;
		this.file = file;
		this.schema = schema;
		this.field = field;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();

		const header = contentEl.createEl("h3");
		header.setText(`Edit ${this.field.name}`);
		const sub = contentEl.createEl("div", { cls: "schema-type-meta" });
		sub.setText(`${this.schema.name} · ${this.field.type}`);

		const cache = this.plugin.app.metadataCache.getFileCache(this.file);
		const fm = (cache?.frontmatter as Record<string, unknown> | undefined) ?? {};
		const current = fm[this.field.name];

		switch (this.field.type) {
			case "Input":
			case "Date":
			case "DateTime":
			case "Time":
				this.renderText(contentEl, current);
				break;
			case "Number":
				this.renderNumber(contentEl, current);
				break;
			case "Boolean":
				this.renderToggle(contentEl, current);
				break;
			case "Select":
			case "Cycle":
				this.renderSelect(contentEl, current);
				break;
			case "File":
				this.renderFile(contentEl, current);
				break;
			case "MultiFile":
			case "Multi":
			case "MultiMedia":
				this.renderMulti(contentEl, current);
				break;
			case "YAML":
			case "JSON":
				this.renderMultiline(contentEl, current);
				break;
			case "Lookup":
				this.renderLookup(contentEl);
				break;
			case "Formula":
				this.renderFormula(contentEl);
				break;
			default:
				this.renderText(contentEl, current);
				break;
		}
	}

	private renderText(parent: HTMLElement, current: unknown): void {
		new Setting(parent).setName("Value").addText((text) => {
			text.setValue(typeof current === "string" ? current : "").onChange((v) =>
				this.write(v)
			);
		});
	}

	private renderMultiline(parent: HTMLElement, current: unknown): void {
		new Setting(parent).setName("Value (YAML)").addTextArea((area) => {
			const initial =
				typeof current === "string" ? current : current ? JSON.stringify(current, null, 2) : "";
			area.setValue(initial).onChange((v) => this.write(v));
			area.inputEl.style.minHeight = "120px";
			area.inputEl.style.fontFamily = "var(--font-monospace)";
		});
	}

	private renderNumber(parent: HTMLElement, current: unknown): void {
		new Setting(parent).setName("Value").addText((text) => {
			text.setValue(typeof current === "number" ? String(current) : "").onChange((v) => {
				const n = Number.parseFloat(v);
				this.write(Number.isFinite(n) ? n : null);
			});
			text.inputEl.type = "number";
		});
	}

	private renderToggle(parent: HTMLElement, current: unknown): void {
		new Setting(parent).setName("Value").addToggle((toggle) => {
			toggle.setValue(Boolean(current)).onChange((v) => this.write(v));
		});
	}

	private renderSelect(parent: HTMLElement, current: unknown): void {
		const options = (this.field.options ?? {}) as Record<string, unknown>;
		const valuesList = (options.valuesList as Record<string, string> | undefined) ?? {};
		const valuesListNotePath = options.valuesListNotePath as string | undefined;

		new Setting(parent).setName("Value").addDropdown(async (drop) => {
			const inline = Object.keys(valuesList);
			let values: string[] = inline.length > 0 ? inline.map((k) => valuesList[k]) : [];
			if (values.length === 0 && valuesListNotePath) {
				const file = this.plugin.app.vault.getAbstractFileByPath(valuesListNotePath);
				if (file instanceof TFile) {
					const text = await this.plugin.app.vault.cachedRead(file);
					values = text
						.split("\n")
						.map((l) => l.trim())
						.filter((l) => l.length > 0 && !l.startsWith("---"));
				}
			}
			drop.addOption("", "(unset)");
			for (const v of values) drop.addOption(v, v);
			drop.setValue(typeof current === "string" ? current : "");
			drop.onChange((v) => this.write(v || null));
		});
	}

	private renderFile(parent: HTMLElement, current: unknown): void {
		const display = typeof current === "string" ? current : "(none)";
		new Setting(parent)
			.setName("Value")
			.setDesc(display)
			.addButton((btn) => {
				btn.setButtonText("Pick file").onClick(() => {
					const picker = new SchemaFilePickerModal(this.app, this.plugin, this.field, (path) => {
						this.write(path ? `[[${path.replace(/\.md$/, "")}]]` : "");
						this.close();
					});
					picker.open();
				});
			});
	}

	private renderMulti(parent: HTMLElement, current: unknown): void {
		const lines = Array.isArray(current) ? current.map(String) : [];
		new Setting(parent)
			.setName("Values (one per line)")
			.addTextArea((area) => {
				area.setValue(lines.join("\n")).onChange((v) =>
					this.write(v.split("\n").map((l) => l.trim()).filter(Boolean))
				);
				area.inputEl.style.minHeight = "100px";
			});
	}

	private renderFormula(parent: HTMLElement): void {
		const opts = (this.field.options ?? {}) as { expression?: string };
		const expression = typeof opts.expression === "string" ? opts.expression : "";
		const valueEl = parent.createEl("div", { cls: "schema-formula-value" });
		const exprEl = parent.createEl("div", {
			cls: "schema-formula-expr",
			text: expression || "(no expression)",
		});
		const recompute = () => {
			if (!expression) {
				valueEl.setText("(no expression)");
				return;
			}
			const result = evaluateFormula(this.plugin.app, this.file, expression);
			valueEl.setText(result || "(empty)");
		};
		recompute();
		new Setting(parent).addButton((btn) =>
			btn.setButtonText("Recompute").onClick(() => recompute())
		);
	}

	private renderLookup(parent: HTMLElement): void {
		const lookup = this.schema.lookups.find((l) => l.name === this.field.name);
		const list = parent.createEl("ul");
		const status = parent.createEl("div", { text: "Loading…" });

		const refresh = async () => {
			list.empty();
			status.setText("Running query…");
			try {
				if (!lookup) {
					status.setText("(lookup not defined)");
					return;
				}
				const result = await this.plugin.lookups.run(lookup.query, this.file);
				if (result.files.length === 0) status.setText("(no results)");
				else status.setText(`${result.files.length} result(s)`);
				for (const f of result.files) {
					const li = list.createEl("li");
					const a = li.createEl("a", { text: f.basename, cls: "internal-link" });
					a.dataset.href = f.path;
					a.addEventListener("click", () => {
						this.plugin.app.workspace.openLinkText(f.path, this.file.path, false);
						this.close();
					});
				}
			} catch (err) {
				status.setText(`Error: ${err instanceof Error ? err.message : String(err)}`);
			}
		};

		new Setting(parent).addButton((btn) => {
			btn.setButtonText("Refresh").onClick(() => void refresh());
		});
		void refresh();
	}

	private async write(value: unknown): Promise<void> {
		await this.plugin.app.fileManager.processFrontMatter(this.file, (fm) => {
			if (value == null || value === "" || (Array.isArray(value) && value.length === 0)) {
				delete fm[this.field.name];
			} else {
				fm[this.field.name] = value;
			}
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/**
 * Fuzzy file picker scoped to instances of a target fileClass (or the whole
 * vault if no target is set on the field).
 */
class SchemaFilePickerModal extends FuzzySuggestModal<TFile> {
	private readonly plugin: SchemaPlugin;
	private readonly field: FieldSchema;
	private readonly onPick: (path: string | null) => void;

	constructor(
		app: App,
		plugin: SchemaPlugin,
		field: FieldSchema,
		onPick: (path: string | null) => void
	) {
		super(app);
		this.plugin = plugin;
		this.field = field;
		this.onPick = onPick;
	}

	getItems(): TFile[] {
		const target = this.field.target;
		if (!target) return this.app.vault.getMarkdownFiles();
		const schema = this.plugin.loader.getResolved(target);
		if (!schema?.folder) return this.app.vault.getMarkdownFiles();
		const folder = schema.folder;
		const prefix = folder.endsWith("/") ? folder : folder + "/";
		return this.app.vault
			.getMarkdownFiles()
			.filter((f) => f.path === folder || f.path.startsWith(prefix));
	}

	getItemText(item: TFile): string {
		return item.basename;
	}

	onChooseItem(item: TFile): void {
		this.onPick(item.path);
	}
}

/**
 * Picks a field from the active file's schema and opens FieldEditModal.
 */
export class FieldPickerModal extends FuzzySuggestModal<FieldSchema> {
	private readonly plugin: SchemaPlugin;
	private readonly file: TFile;
	private readonly schema: TypeSchema;

	constructor(plugin: SchemaPlugin, file: TFile, schema: TypeSchema) {
		super(plugin.app);
		this.plugin = plugin;
		this.file = file;
		this.schema = schema;
	}

	getItems(): FieldSchema[] {
		return this.schema.fields;
	}

	getItemText(item: FieldSchema): string {
		return `${item.name} (${item.type})`;
	}

	onChooseItem(item: FieldSchema): void {
		new FieldEditModal(this.plugin, this.file, this.schema, item).open();
	}
}
