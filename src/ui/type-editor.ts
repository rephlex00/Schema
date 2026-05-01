import { Notice, Setting, setIcon } from "obsidian";
import type SchemaPlugin from "../main";
import { inheritedFieldNames, inheritedLookupNames } from "../schema/resolve";
import type { TypeSchema } from "../schema/types";
import { FieldListEditor } from "./field-list-editor";
import { LookupListEditor } from "./lookup-list-editor";
import { confirmAction } from "./prompt-modal";

function isHex(s: string): boolean {
	return /^#[0-9A-Fa-f]{6}$/.test(s.trim());
}

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
		const iconName = typeof schema.defaults?.icon === "string" ? schema.defaults.icon : "";
		const color = typeof schema.defaults?.color === "string" ? schema.defaults.color : "";
		if (iconName) {
			const iconEl = summary.createSpan({ cls: "schema-type-icon" });
			setIcon(iconEl, iconName);
			if (color) iconEl.style.color = color;
		}
		const nameEl = summary.createEl("strong", {
			text: schema.name,
			cls: "schema-type-name",
		});
		if (color) nameEl.style.color = color;
		const ext = schema.extends ? ` extends ${schema.extends}` : "";
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
				text: "(no auto-refreshed fields configured globally — see Settings → Schema → Global)",
			});
			return;
		}

		for (const ar of fields) {
			const current = schema.defaults?.[ar.name];
			const value = typeof current === "string" ? current : current != null ? String(current) : "";
			const setting = new Setting(parent).setName(ar.name);
			switch (ar.kind) {
				case "color":
					this.renderColorPicker(setting, value, (v) => this.queueDefault(schema, ar.name, v));
					break;
				case "icon":
					this.renderIconInput(setting, value, (v) => this.queueDefault(schema, ar.name, v));
					break;
				default:
					setting.addText((t) => {
						t.setValue(value).onChange((v) => this.queueDefault(schema, ar.name, v));
					});
					break;
			}
		}
	}

	private queueDefault(schema: TypeSchema, key: string, value: string): void {
		const next = { ...(schema.defaults ?? {}) };
		if (value.trim() === "") delete next[key];
		else next[key] = value;
		this.queue({ defaults: next });
	}

	private renderColorPicker(setting: Setting, current: string, onChange: (v: string) => void): void {
		const wrap = setting.controlEl.createDiv({ cls: "schema-color-control" });

		const swatch = wrap.createEl("input", {
			type: "color",
			cls: "schema-color-swatch",
		});
		swatch.value = isHex(current) ? current : "#888888";

		const text = wrap.createEl("input", {
			type: "text",
			cls: "schema-color-text",
		});
		text.value = current;
		text.placeholder = "#RRGGBB";

		swatch.addEventListener("input", () => {
			text.value = swatch.value;
			onChange(swatch.value);
		});
		text.addEventListener("change", () => {
			const v = text.value.trim();
			if (isHex(v)) swatch.value = v;
			onChange(v);
		});
	}

	private renderIconInput(setting: Setting, current: string, onChange: (v: string) => void): void {
		const wrap = setting.controlEl.createDiv({ cls: "schema-icon-control" });
		const preview = wrap.createSpan({ cls: "schema-icon-preview" });
		if (current) setIcon(preview, current);

		const input = wrap.createEl("input", {
			type: "text",
			cls: "schema-icon-text",
		});
		input.value = current;
		input.placeholder = "lucide icon name (e.g. user)";

		input.addEventListener("input", () => {
			preview.empty();
			if (input.value) setIcon(preview, input.value);
		});
		input.addEventListener("change", () => onChange(input.value.trim()));
	}

	private renderFields(parent: HTMLElement, schema: TypeSchema): void {
		parent.createEl("h5", { text: `Fields (${schema.fields.length})` });
		const inherited = inheritedFieldNames(this.plugin.loader.rawMap(), schema.name);
		if (inherited.length > 0) {
			parent.createEl("div", {
				cls: "schema-inheritance-hint",
				text: `+ inherited from ${schema.extends}: ${inherited.join(", ")}`,
			});
		}
		new FieldListEditor(this.plugin, schema.name).render(parent);
	}

	private renderLookups(parent: HTMLElement, schema: TypeSchema): void {
		parent.createEl("h5", { text: `Lookups (${schema.lookups.length})` });
		const inherited = inheritedLookupNames(this.plugin.loader.rawMap(), schema.name);
		if (inherited.length > 0) {
			parent.createEl("div", {
				cls: "schema-inheritance-hint",
				text: `+ inherited from ${schema.extends}: ${inherited.join(", ")}`,
			});
		}
		new LookupListEditor(this.plugin, schema.name).render(parent);
	}

	private renderDelete(parent: HTMLElement, schema: TypeSchema): void {
		new Setting(parent).addButton((btn) => {
			btn.setButtonText("Delete type")
				.setWarning()
				.onClick(async () => {
					const ok = await confirmAction(
						this.plugin.app,
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
