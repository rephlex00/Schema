import { Notice, Setting } from "obsidian";
import type SchemaPlugin from "../main";
import type { TypeSchema } from "../schema/types";
import { FieldListEditor } from "./field-list-editor";
import { LookupListEditor } from "./lookup-list-editor";

/**
 * Renders one type's collapsible editor block. Provides Basics and Defaults
 * sub-sections (and stubs for Fields/Lookups, filled in by later phases).
 *
 * Edits are debounced through `commit()` which calls `loader.update()`,
 * triggering a `schema-changed` event that the plugin listens to and persists
 * to data.json.
 */
export class TypeEditor {
	private readonly plugin: SchemaPlugin;
	private readonly schemaName: string;
	private container!: HTMLElement;
	private debounceTimer: number | null = null;
	private pending: Partial<TypeSchema> = {};

	constructor(plugin: SchemaPlugin, schemaName: string) {
		this.plugin = plugin;
		this.schemaName = schemaName;
	}

	render(parent: HTMLElement, expanded = false): void {
		const schema = this.plugin.loader.get(this.schemaName);
		if (!schema) return;

		const details = parent.createEl("details", { cls: "schema-type-block" });
		if (expanded) details.setAttr("open", "");
		this.container = details;

		const summary = details.createEl("summary");
		const ext = schema.extends ? ` extends ${schema.extends}` : "";
		summary.createEl("strong", { text: schema.name });
		summary.createEl("span", {
			cls: "schema-type-meta",
			text: ` ${ext} · ${schema.fields.length} fields · ${schema.lookups.length} lookups${schema.folder ? " · " + schema.folder : " · (abstract)"}`,
		});

		const body = details.createEl("div", { cls: "schema-type-body" });
		this.renderBasics(body, schema);
		this.renderDefaults(body, schema);
		this.renderFields(body, schema);
		this.renderLookups(body, schema);
		this.renderDelete(body, schema);
	}

	private renderBasics(parent: HTMLElement, schema: TypeSchema): void {
		parent.createEl("h5", { text: "Basics" });

		new Setting(parent).setName("Name").setDesc("Read-only after creation.").addText((t) => {
			t.setValue(schema.name).setDisabled(true);
		});

		new Setting(parent)
			.setName("Extends")
			.setDesc("Parent type. The validator checks the chain; field merging is not done.")
			.addDropdown((d) => {
				d.addOption("", "(none)");
				for (const other of this.plugin.loader.getAll()) {
					if (other.name === schema.name) continue;
					d.addOption(other.name, other.name);
				}
				d.setValue(schema.extends ?? "");
				d.onChange((v) => this.queue({ extends: v || undefined }));
			});

		new Setting(parent)
			.setName("Folder")
			.setDesc("Where instances live. Leave blank for abstract parents.")
			.addText((t) => {
				t.setValue(schema.folder ?? "")
					.setPlaceholder("e.g. Facts/People or Moments/{{datetime|year}}")
					.onChange((v) => this.queue({ folder: v || undefined }));
			});

		new Setting(parent)
			.setName("Filename template")
			.setDesc("Liquid template for new note filenames. Blank → timestamp.")
			.addText((t) => {
				t.setValue(schema.filename ?? "")
					.setPlaceholder("e.g. {{firstname}} {{lastname}}")
					.onChange((v) => this.queue({ filename: v || undefined }));
			});

		new Setting(parent)
			.setName("Tags")
			.setDesc("Auto-classification tags. One per line.")
			.addTextArea((t) => {
				t.setValue(schema.tags.join("\n"))
					.setPlaceholder("type/person")
					.onChange((v) => {
						const tags = v
							.split("\n")
							.map((s) => s.trim())
							.filter(Boolean);
						this.queue({ tags });
					});
				t.inputEl.rows = 2;
			});
	}

	private renderDefaults(parent: HTMLElement, schema: TypeSchema): void {
		parent.createEl("h5", { text: "Defaults" });

		const fields = this.plugin.settings.autoRefreshedFields;
		if (fields.length === 0) {
			parent.createEl("div", {
				cls: "schema-empty",
				text: "(no auto-refreshed fields configured globally)",
			});
			return;
		}

		for (const key of fields) {
			const current = schema.defaults?.[key];
			const value = typeof current === "string" ? current : current != null ? String(current) : "";
			new Setting(parent).setName(key).addText((t) => {
				t.setValue(value).onChange((v) => {
					const next = { ...(schema.defaults ?? {}) };
					if (v.trim() === "") delete next[key];
					else next[key] = v;
					this.queue({ defaults: next });
				});
			});
		}
	}

	private renderFields(parent: HTMLElement, schema: TypeSchema): void {
		parent.createEl("h5", { text: `Fields (${schema.fields.length})` });
		new FieldListEditor(this.plugin, schema.name).render(parent);
	}

	private renderLookups(parent: HTMLElement, schema: TypeSchema): void {
		parent.createEl("h5", { text: `Lookups (${schema.lookups.length})` });
		new LookupListEditor(this.plugin, schema.name).render(parent);
	}

	private renderDelete(parent: HTMLElement, schema: TypeSchema): void {
		new Setting(parent).addButton((btn) => {
			btn.setButtonText("Delete type")
				.setWarning()
				.onClick(() => {
					const ok = window.confirm(
						`Delete type "${schema.name}"? Existing notes with this type will keep their frontmatter but lose schema validation.`
					);
					if (!ok) return;
					this.plugin.loader.remove(schema.name);
					new Notice(`Schema: deleted type "${schema.name}".`);
				});
		});
	}

	private queue(partial: Partial<TypeSchema>): void {
		this.pending = { ...this.pending, ...partial };
		if (this.debounceTimer != null) window.clearTimeout(this.debounceTimer);
		this.debounceTimer = window.setTimeout(() => {
			this.debounceTimer = null;
			const p = this.pending;
			this.pending = {};
			this.plugin.loader.update(this.schemaName, p);
		}, 400);
	}
}
