import { App, PluginSettingTab, Setting } from "obsidian";
import type SchemaPlugin from "../main";

/**
 * Stub for the v2 Settings UI. Full implementation arrives in phase 2.0-C.
 * Currently shows the global toggles and a count of loaded types.
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
		containerEl.createEl("h2", { text: "Schema" });

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
			.setName("Auto-refreshed frontmatter fields")
			.setDesc(
				"Comma-separated list of frontmatter keys that get reset to schema defaults on every type change."
			)
			.addText((text) => {
				text.setValue(this.plugin.settings.autoRefreshedFields.join(", ")).onChange(
					async (value) => {
						this.plugin.settings.autoRefreshedFields = value
							.split(",")
							.map((s) => s.trim())
							.filter(Boolean);
						await this.plugin.saveSettings();
					}
				);
			});

		const runtime = this.plugin.lookups.usingDataview() ? "Dataview (installed)" : "Built-in fallback";
		new Setting(containerEl).setName("Lookup runtime").setDesc(runtime).setDisabled(true);

		const types = this.plugin.loader.getAll();
		containerEl.createEl("h3", { text: `Loaded types (${types.length})` });
		const ul = containerEl.createEl("ul");
		for (const t of types) {
			const folder = t.folder ?? "(no folder)";
			ul.createEl("li", {
				text: `${t.name}${t.extends ? " extends " + t.extends : ""} → ${folder} · ${t.fields.length} fields · ${t.lookups.length} lookups`,
			});
		}
		const errs = this.plugin.loader.getValidationErrors();
		if (errs.length > 0) {
			containerEl.createEl("h3", { text: "Validation issues" });
			const eu = containerEl.createEl("ul");
			for (const e of errs) {
				eu.createEl("li", { text: `[${e.level}] ${e.type}: ${e.message}` });
			}
		}
	}
}
