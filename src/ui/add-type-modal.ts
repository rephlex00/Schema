import { App, Modal, Notice, Setting } from "obsidian";
import type SchemaPlugin from "../main";
import type { TypeSchema } from "../schema/types";
import { FolderSuggest } from "./file-suggest";

/**
 * Modal that asks for a new object type's name + optional parent + optional
 * folder, then commits a fresh empty TypeSchema to the loader.
 */
export class AddTypeModal extends Modal {
	private readonly plugin: SchemaPlugin;
	private readonly onCreate: () => void;
	private name = "";
	private extendsValue = "";
	private folder = "";

	constructor(plugin: SchemaPlugin, onCreate: () => void) {
		super(plugin.app);
		this.plugin = plugin;
		this.onCreate = onCreate;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h3", { text: "Add object type" });
		const typeKey = this.plugin.settings.typeKey;

		new Setting(contentEl)
			.setName("Name")
			.setDesc(`Used as the value of \`${typeKey}:\` on every note of this kind. Lowercase letters, digits, dashes and underscores. No spaces. Example: recipe, daily_note, book.`)
			.addText((t) => {
				t.setPlaceholder("e.g. recipe").onChange((v) => (this.name = v.trim()));
				window.setTimeout(() => t.inputEl.focus(), 0);
			});

		new Setting(contentEl)
			.setName("Inherits from")
			.setDesc("Optional. Picks another object type as a starting point. Properties, lookups, and defaults are inherited. Leave at (none) for a standalone object type.")
			.addDropdown((d) => {
				d.addOption("", "(none)");
				for (const s of this.plugin.loader.getAll()) {
					d.addOption(s.name, s.name);
				}
				d.onChange((v) => (this.extendsValue = v));
			});

		new Setting(contentEl)
			.setName("Folder")
			.setDesc("Where new notes of this object type are saved. Leave blank for parent-only object types (never instantiated directly). You can change this later.")
			.addText((t) => {
				t.setPlaceholder("e.g. Facts/Recipes").onChange((v) => (this.folder = v.trim()));
				new FolderSuggest(this.plugin.app, t.inputEl).onSelect((folder) => {
					t.setValue(folder.path);
					this.folder = folder.path;
				});
			});

		new Setting(contentEl)
			.addButton((btn) =>
				btn
					.setButtonText("Create")
					.setCta()
					.onClick(() => this.commit())
			)
			.addButton((btn) => btn.setButtonText("Cancel").onClick(() => this.close()));
	}

	private commit(): void {
		if (!this.name) {
			new Notice("Schema: name is required.");
			return;
		}
		if (!/^[a-z][a-z0-9_-]*$/.test(this.name)) {
			new Notice("Schema: name must be lowercase letters, digits, '-' or '_'.");
			return;
		}
		if (this.plugin.loader.get(this.name)) {
			new Notice(`Schema: object type "${this.name}" already exists.`);
			return;
		}
		const schema: TypeSchema = {
			name: this.name,
			extends: this.extendsValue || undefined,
			folder: this.folder || undefined,
			tags: [],
			fields: [],
			lookups: [],
			defaults: {},
		};
		this.plugin.loader.add(schema);
		new Notice(`Schema: added object type "${this.name}".`);
		this.onCreate();
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
