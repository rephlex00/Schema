import { App, PluginSettingTab, Setting, TFile } from "obsidian";
import type SchemaPlugin from "../main";
import type { TypeSchema } from "../schema/types";

/**
 * Plugin settings UI: lists all loaded type schemas with their key properties.
 *
 * Read-write surface (Phase 5 scope):
 * - schemaFolder (vault-relative folder)
 * - autoReshelveOnTypeChange (toggle)
 * - per-type: edit folder, icon, color, filename — writes back to the type's
 *   source `.md` file via processFrontMatter
 *
 * Phase 6 will add field-level editing on top of this same tab.
 */
export class SchemaSettingsTab extends PluginSettingTab {
	private readonly plugin: SchemaPlugin;

	constructor(app: App, plugin: SchemaPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		this.renderGlobalSettings(containerEl);

		const schemas = this.plugin.loader
			.getAll()
			.slice()
			.sort((a, b) => a.name.localeCompare(b.name));

		const errs = this.plugin.loader.getValidationErrors();
		if (errs.length > 0) {
			containerEl.createEl("h3", { text: "Validation issues" });
			const ul = containerEl.createEl("ul");
			for (const e of errs) {
				ul.createEl("li", { text: `[${e.level}] ${e.type}: ${e.message}` });
			}
		}

		containerEl.createEl("h3", { text: `Loaded types (${schemas.length})` });
		for (const schema of schemas) {
			this.renderTypeRow(containerEl, schema);
		}
	}

	private renderGlobalSettings(containerEl: HTMLElement): void {
		containerEl.createEl("h2", { text: "Schema" });

		new Setting(containerEl)
			.setName("Schema folder")
			.setDesc("Vault-relative path to the folder containing fileClass definitions.")
			.addText((text) => {
				text.setValue(this.plugin.settings.schemaFolder).onChange(async (value) => {
					this.plugin.settings.schemaFolder = value.replace(/\/$/, "");
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Auto-reshelve on type change")
			.setDesc(
				"When a note's `type:` frontmatter changes, automatically move it to the new type's folder and update its frontmatter."
			)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.autoReshelveOnTypeChange)
					.onChange(async (value) => {
						this.plugin.settings.autoReshelveOnTypeChange = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Reload schemas")
			.setDesc("Re-scan the schema folder. Useful if external tooling modified files outside Obsidian.")
			.addButton((btn) => {
				btn.setButtonText("Reload").onClick(async () => {
					await this.plugin.loader.fullReload();
					this.display();
				});
			});

		const runtime = this.plugin.lookups.usingDataview() ? "Dataview (installed)" : "Built-in fallback";
		new Setting(containerEl).setName("Lookup runtime").setDesc(runtime).setDisabled(true);
	}

	private renderTypeRow(containerEl: HTMLElement, schema: TypeSchema): void {
		const block = containerEl.createDiv({ cls: "schema-type-block" });
		block.createEl("h4", { text: `${schema.icon ? schema.icon + " " : ""}${schema.name}` });

		const ext = schema.extends ? ` extends ${schema.extends}` : "";
		const fields = schema.fields.length;
		const lookups = schema.lookups.length;
		block.createEl("div", {
			text: `${schema.sourcePath}${ext} · ${fields} fields · ${lookups} lookups`,
			cls: "schema-type-meta",
		});

		new Setting(block).setName("Folder").addText((text) => {
			text.setValue(schema.folder ?? "").onChange((v) =>
				this.scheduleWriteSchema(schema, { folder: v })
			);
		});

		new Setting(block).setName("Filename template").addText((text) => {
			text.setValue(schema.filename ?? "")
				.setPlaceholder("e.g. {{firstname}} {{lastname}} or leave blank for timestamp")
				.onChange((v) => this.scheduleWriteSchema(schema, { filename: v }));
		});

		new Setting(block).setName("Icon").addText((text) => {
			text.setValue(schema.icon ?? "").onChange((v) =>
				this.scheduleWriteSchema(schema, { icon: v })
			);
		});

		new Setting(block).setName("Color").addText((text) => {
			text.setValue(schema.color ?? "")
				.setPlaceholder("#RRGGBB")
				.onChange((v) => this.scheduleWriteSchema(schema, { color: v }));
		});
	}

	private writeTimer: number | null = null;
	private pending = new Map<string, Record<string, string>>();

	private scheduleWriteSchema(schema: TypeSchema, partial: Record<string, string>): void {
		const cur = this.pending.get(schema.name) ?? {};
		this.pending.set(schema.name, { ...cur, ...partial });
		if (this.writeTimer != null) window.clearTimeout(this.writeTimer);
		this.writeTimer = window.setTimeout(() => {
			this.writeTimer = null;
			void this.flushPendingWrites();
		}, 500);
	}

	private async flushPendingWrites(): Promise<void> {
		const writes = Array.from(this.pending.entries());
		this.pending.clear();
		for (const [name, partial] of writes) {
			const schema = this.plugin.loader.get(name);
			if (!schema) continue;
			const file = this.plugin.app.vault.getAbstractFileByPath(schema.sourcePath);
			if (!(file instanceof TFile)) continue;
			await this.plugin.app.fileManager.processFrontMatter(file, (fm) => {
				for (const [k, v] of Object.entries(partial)) {
					if (v === "" || v == null) {
						delete fm[k];
					} else {
						fm[k] = v;
					}
				}
			});
		}
	}
}
