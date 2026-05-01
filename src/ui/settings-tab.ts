import { App, PluginSettingTab, Setting } from "obsidian";
import type SchemaPlugin from "../main";
import { AddTypeModal } from "./add-type-modal";
import { AutoRefreshedFieldsEditor } from "./auto-refreshed-fields-editor";
import { FolderMappingsEditor } from "./folder-mappings-editor";
import { TypeEditor } from "./type-editor";

/**
 * Top-level Settings → Schema tab. Renders global toggles, validation issues,
 * the type list, and an "Add type" button.
 *
 * Re-renders when the loader emits `schema-changed` (via plugin re-display),
 * so edits made via the loader's API show up immediately.
 */
export class SchemaSettingsTab extends PluginSettingTab {
	private readonly plugin: SchemaPlugin;
	private rerenderListener: (() => void) | null = null;

	constructor(app: App, plugin: SchemaPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("h2", { text: "Schema" });

		this.renderGlobal(containerEl);
		this.renderValidation(containerEl);
		this.renderTypes(containerEl);

		// Wire up live re-render on schema-changed.
		this.detachRerenderListener();
		this.rerenderListener = () => this.display();
		this.plugin.loader.on("schema-changed", this.rerenderListener);
	}

	hide(): void {
		this.detachRerenderListener();
	}

	private detachRerenderListener(): void {
		if (this.rerenderListener) {
			this.plugin.loader.off("schema-changed", this.rerenderListener);
			this.rerenderListener = null;
		}
	}

	private renderGlobal(parent: HTMLElement): void {
		parent.createEl("h3", { text: "Global" });

		new Setting(parent)
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

		parent.createEl("h4", { text: "Auto-refreshed frontmatter fields" });
		new AutoRefreshedFieldsEditor(this.plugin, () => this.display()).render(parent);

		parent.createEl("h4", { text: "Folder mappings" });
		new FolderMappingsEditor(this.plugin, () => this.display()).render(parent);

		const runtime = this.plugin.lookups.usingDataview() ? "Dataview (installed)" : "Built-in fallback";
		new Setting(parent).setName("Lookup runtime").setDesc(runtime).setDisabled(true);
	}

	private renderValidation(parent: HTMLElement): void {
		const errs = this.plugin.loader.getValidationErrors();
		const errors = errs.filter((e) => e.level === "error");
		const warnings = errs.filter((e) => e.level === "warning");
		if (errors.length === 0 && warnings.length === 0) return;

		parent.createEl("h3", { text: "Validation issues" });
		const ul = parent.createEl("ul", { cls: "schema-validation-list" });
		for (const e of [...errors, ...warnings]) {
			ul.createEl("li", { text: `[${e.level}] ${e.type}: ${e.message}` });
		}
	}

	private renderTypes(parent: HTMLElement): void {
		const types = this.plugin.loader
			.getAll()
			.slice()
			.sort((a, b) => a.name.localeCompare(b.name));

		const heading = parent.createEl("div", { cls: "schema-types-heading" });
		heading.createEl("h3", { text: `Types (${types.length})` });

		new Setting(parent).addButton((btn) => {
			btn.setButtonText("+ Add type")
				.setCta()
				.onClick(() => {
					new AddTypeModal(this.plugin, () => this.display()).open();
				});
		});

		if (types.length === 0) {
			parent.createEl("div", {
				cls: "schema-empty",
				text: "No types defined yet. Click '+ Add type' to start.",
			});
			return;
		}

		const list = parent.createEl("div", { cls: "schema-types-list" });
		for (const schema of types) {
			new TypeEditor(this.plugin, schema.name).render(list, false);
		}
	}
}
