import { App, Modal, Notice, Setting } from "obsidian";
import type SchemaPlugin from "../main";
import type { TypeSchema } from "../schema/types";

/**
 * Modal that asks for a new type's name + optional parent + optional folder,
 * then commits a fresh empty TypeSchema to the loader.
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

		new Setting(contentEl)
			.setName("Name")
			.setDesc("Lowercase, no spaces. Becomes the value of `type:` on instance notes.")
			.addText((t) => {
				t.setPlaceholder("e.g. recipe").onChange((v) => (this.name = v.trim()));
				window.setTimeout(() => t.inputEl.focus(), 0);
			});

		new Setting(contentEl)
			.setName("Extends")
			.setDesc("Optional parent type.")
			.addDropdown((d) => {
				d.addOption("", "(none)");
				for (const s of this.plugin.loader.getAll()) {
					d.addOption(s.name, s.name);
				}
				d.onChange((v) => (this.extendsValue = v));
			});

		new Setting(contentEl)
			.setName("Folder")
			.setDesc("Optional. Leave blank for abstract parents.")
			.addText((t) => {
				t.setPlaceholder("e.g. Facts/Recipes").onChange((v) => (this.folder = v.trim()));
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
			new Notice(`Schema: type "${this.name}" already exists.`);
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
		new Notice(`Schema: added type "${this.name}".`);
		this.onCreate();
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
