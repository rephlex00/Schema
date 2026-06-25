import { App, FuzzySuggestModal, Modal, Notice, Setting, TFile } from "obsidian";
import { evaluateFormula } from "../lifecycle/formula";
import type SchemaPlugin from "../main";
import type { FieldSchema, TypeSchema } from "../schema/types";
import { confirmAction, promptForString } from "./prompt-modal";
import { renderColorControl, renderIconControl } from "./widgets/pickers";

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
			case "Icon":
				this.renderIcon(contentEl, current);
				break;
			case "Color":
				this.renderColor(contentEl, current);
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
				void this.write(v)
			);
		});
	}

	private renderMultiline(parent: HTMLElement, current: unknown): void {
		new Setting(parent).setName("Value (YAML)").addTextArea((area) => {
			const initial =
				typeof current === "string" ? current : current ? JSON.stringify(current, null, 2) : "";
			area.setValue(initial).onChange((v) => void this.write(v));
			area.inputEl.addClass("schema-mono-area");
		});
	}

	private renderNumber(parent: HTMLElement, current: unknown): void {
		new Setting(parent).setName("Value").addText((text) => {
			text.setValue(typeof current === "number" ? String(current) : "").onChange((v) => {
				const n = Number.parseFloat(v);
				void this.write(Number.isFinite(n) ? n : null);
			});
			text.inputEl.type = "number";
		});
	}

	private renderIcon(parent: HTMLElement, current: unknown): void {
		const setting = new Setting(parent).setName("Value");
		renderIconControl(setting.controlEl, typeof current === "string" ? current : "", (v) =>
			void this.write(v)
		);
	}

	private renderColor(parent: HTMLElement, current: unknown): void {
		const setting = new Setting(parent).setName("Value");
		renderColorControl(setting.controlEl, typeof current === "string" ? current : "", (v) =>
			void this.write(v)
		);
	}

	private renderToggle(parent: HTMLElement, current: unknown): void {
		new Setting(parent).setName("Value").addToggle((toggle) => {
			toggle.setValue(Boolean(current)).onChange((v) => this.write(v));
		});
	}

	private renderSelect(parent: HTMLElement, current: unknown): void {
		const options = this.field.options ?? {};
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
						void this.write(path ? `[[${path.replace(/\.md$/, "")}]]` : "");
						this.close();
					});
					picker.open();
				});
			});
	}

	private renderMulti(parent: HTMLElement, current: unknown): void {
		const isFileBacked = this.field.type === "MultiFile" || this.field.type === "MultiMedia";
		const values: string[] = Array.isArray(current) ? current.map(String) : [];

		new Setting(parent).setName("Values").setDesc(
			isFileBacked
				? "File picker is scoped to the field's target type. Click × on a chip to remove."
				: "Each chip is a string value. Click + Add to enter one."
		);
		const chips = parent.createDiv({ cls: "schema-multi-chips" });

		const render = () => {
			chips.empty();
			values.forEach((v, i) => {
				const chip = chips.createSpan({ cls: "schema-multi-chip" });
				chip.createSpan({
					cls: "schema-multi-chip-label",
					text: extractChipDisplay(v),
				});
				const close = chip.createSpan({ cls: "schema-multi-chip-close", text: "×" });
				close.addEventListener("click", () => {
					values.splice(i, 1);
					void this.write(values.length > 0 ? values : null);
					render();
				});
			});
			const addBtn = chips.createEl("button", {
				cls: "schema-multi-add",
				text: "+ Add",
				attr: { type: "button" },
			});
			addBtn.addEventListener("click", () => void this.addMultiValue(isFileBacked, values, render));
		};
		render();
	}

	private async addMultiValue(
		isFileBacked: boolean,
		values: string[],
		render: () => void
	): Promise<void> {
		if (isFileBacked) {
			const picker = new SchemaFilePickerModal(this.app, this.plugin, this.field, (path) => {
				if (!path) return;
				const wikilink = `[[${path.replace(/\.md$/, "")}]]`;
				if (values.includes(wikilink)) return;
				values.push(wikilink);
				void this.write(values);
				render();
			});
			picker.open();
			return;
		}
		const v = await promptForString(this.plugin.app, "Add value", "Value");
		const trimmed = v?.trim();
		if (!trimmed || values.includes(trimmed)) return;
		values.push(trimmed);
		void this.write(values);
		render();
	}

	private renderFormula(parent: HTMLElement): void {
		const opts = (this.field.options ?? {}) as { expression?: string };
		let expression = typeof opts.expression === "string" ? opts.expression : "";

		new Setting(parent)
			.setName("Expression")
			.setDesc(
				"Stored on the global field. Saving changes the value on every note carrying this field, on any type."
			)
			.addTextArea((t) => {
				t.setValue(expression).onChange((v) => {
					expression = v;
				});
				t.inputEl.rows = 3;
				t.inputEl.addClass("schema-code-input");
			});

		const valueLabel = parent.createEl("div", {
			cls: "schema-formula-preview-status",
			text: `Preview against ${this.file.basename}:`,
		});
		const valueEl = parent.createEl("div", { cls: "schema-formula-preview-result" });
		const recompute = () => {
			if (!expression.trim()) {
				valueEl.setText("(no expression)");
				return;
			}
			const result = evaluateFormula(this.plugin.app, this.file, expression);
			valueEl.setText(result || "(empty)");
		};
		recompute();

		new Setting(parent)
			.addButton((btn) =>
				btn.setButtonText("Recompute").onClick(() => recompute())
			)
			.addButton((btn) =>
				btn
					.setButtonText("Save expression")
					.setCta()
					.onClick(() => void this.saveFormulaExpression(expression))
			);
		valueLabel.dataset.role = "label";
	}

	private async saveFormulaExpression(expression: string): Promise<void> {
		const fieldName = this.field.name;
		const ok = await confirmAction(
			this.plugin.app,
			`Save will change the "${fieldName}" formula on every note carrying this field, on any type. Continue?`
		);
		if (!ok) return;

		const globals = this.plugin.settings.globalFields;
		const global = globals[fieldName];
		if (!global) {
			new Notice(`Schema: global field "${fieldName}" not found.`);
			return;
		}
		global.options = { ...(global.options ?? {}), expression };
		this.plugin.loader.setGlobalFields(globals);
		new Notice(`Schema: updated "${fieldName}" formula expression.`);
		this.close();
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
						void this.plugin.app.workspace.openLinkText(f.path, this.file.path, false);
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
		await this.plugin.app.fileManager.processFrontMatter(this.file, (fm: Record<string, unknown>) => {
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

/** Friendly chip label for a value in a MultiFile / MultiMedia / Multi field.
 *  Strips `[[Path/file|alias]]` to `alias` (or basename); passes plain strings
 *  through. */
function extractChipDisplay(s: string): string {
	const m = s.match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/);
	if (m) {
		const last = m[1].split("/").pop();
		return m[2] ?? last ?? m[1];
	}
	return s;
}
