import { Notice, Setting } from "obsidian";
import type SchemaPlugin from "../main";
import { promptForString } from "./prompt-modal";

/**
 * Renders the global "Folder mappings" editor: each row is one (folder → type)
 * entry. New files in (or moves into) a mapped folder auto-set the file's
 * `type:` frontmatter to the configured type.
 *
 * One mapping per folder. Most-specific (longest prefix) wins at runtime.
 */
export class FolderMappingsEditor {
	private readonly plugin: SchemaPlugin;
	private readonly onChange: () => void;

	constructor(plugin: SchemaPlugin, onChange: () => void) {
		this.plugin = plugin;
		this.onChange = onChange;
	}

	render(parent: HTMLElement): void {
		const wrap = parent.createDiv({ cls: "schema-folder-mappings-editor" });

		new Setting(wrap)
			.setName("Auto-classify on folder match")
			.setDesc(
				"When enabled, files created in (or moved into) a mapped folder are auto-classified. Disable to make mappings inert without removing them."
			)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.autoClassifyOnFolderMatch)
					.onChange(async (v) => {
						this.plugin.settings.autoClassifyOnFolderMatch = v;
						await this.plugin.saveSettings();
					});
			});

		wrap.createEl("div", {
			cls: "setting-item-description",
			text: "Each row maps one folder to a type. Files created in the folder (or moved into it) get auto-typed. Most-specific match wins (longer prefix), so subdirectories without explicit mappings inherit the parent's type.",
		});

		const list = wrap.createDiv({ cls: "schema-fm-list" });
		const entries = Object.entries(this.plugin.settings.folderMappings).sort((a, b) =>
			a[0].localeCompare(b[0])
		);
		for (const [folder, type] of entries) {
			this.renderRow(list, folder, type);
		}

		new Setting(wrap).addButton((btn) => {
			btn.setButtonText("+ Add mapping")
				.setCta()
				.onClick(() => void this.addMapping());
		});
	}

	private renderRow(parent: HTMLElement, folder: string, type: string): void {
		const row = parent.createDiv({ cls: "schema-fm-row" });

		const folderInput = row.createEl("input", {
			type: "text",
			cls: "schema-fm-folder",
			attr: { value: folder, placeholder: "Folder path (no leading slash)" },
		});
		folderInput.addEventListener("change", () => {
			const newFolder = folderInput.value.trim().replace(/\/+$/, "");
			if (!newFolder) {
				new Notice("Schema: folder cannot be empty.");
				folderInput.value = folder;
				return;
			}
			if (newFolder !== folder && newFolder in this.plugin.settings.folderMappings) {
				new Notice(`Schema: folder "${newFolder}" is already mapped.`);
				folderInput.value = folder;
				return;
			}
			delete this.plugin.settings.folderMappings[folder];
			this.plugin.settings.folderMappings[newFolder] = type;
			void this.commit();
		});

		const select = row.createEl("select", { cls: "schema-fm-type" });
		const types = this.plugin.loader.getAll().slice().sort((a, b) => a.name.localeCompare(b.name));
		for (const s of types) {
			const opt = select.createEl("option", { text: s.name, attr: { value: s.name } });
			if (s.name === type) opt.selected = true;
		}
		select.addEventListener("change", () => {
			this.plugin.settings.folderMappings[folder] = select.value;
			void this.commit();
		});

		const delBtn = row.createEl("button", { text: "×", cls: "schema-arf-btn schema-arf-del" });
		delBtn.addEventListener("click", () => {
			delete this.plugin.settings.folderMappings[folder];
			void this.commit();
		});
	}

	private async addMapping(): Promise<void> {
		const folder = await promptForString(
			this.plugin.app,
			"Add folder mapping",
			"Folder path",
			"e.g. Facts/People"
		);
		if (!folder) return;
		const norm = folder.replace(/\/+$/, "");
		if (!norm) return;
		if (norm in this.plugin.settings.folderMappings) {
			new Notice(`Schema: folder "${norm}" is already mapped.`);
			return;
		}
		const types = this.plugin.loader.getAll();
		if (types.length === 0) {
			new Notice("Schema: no types defined yet — add a type first.");
			return;
		}
		this.plugin.settings.folderMappings[norm] = types[0].name;
		await this.commit();
	}

	private async commit(): Promise<void> {
		await this.plugin.saveSettings();
		this.onChange();
	}
}
