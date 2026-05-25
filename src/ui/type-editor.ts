import { Notice, Setting, setIcon } from "obsidian";
import type SchemaPlugin from "../main";
import {
	inheritedFieldNames,
	inheritedLookupNames,
	synthesizedInverseLookups,
} from "../schema/resolve";
import type { TypeSchema } from "../schema/types";
import { renderTemplate } from "../util/liquid";
import { FieldListEditor } from "./field-list-editor";
import { LookupListEditor } from "./lookup-list-editor";
import { confirmAction, promptForString } from "./prompt-modal";

function isHex(s: string): boolean {
	return /^#[0-9A-Fa-f]{6}$/.test(s.trim());
}

/** Type-row action toolbar: just a delete button. Types can't be reordered
 *  here (the list is tree-sorted by extends chain), so up/down don't apply.
 *  Click is stopped from propagating so it doesn't toggle the details. */
function buildTypeRowActions(summary: HTMLElement, onDelete: () => void): void {
	const actions = summary.createSpan({ cls: "schema-row-actions" });
	const btn = actions.createEl("button", {
		cls: "schema-row-btn schema-row-btn-danger",
		attr: { type: "button", "aria-label": "Delete type", title: "Delete type" },
	});
	setIcon(btn, "trash-2");
	btn.addEventListener("click", (e) => {
		e.preventDefault();
		e.stopPropagation();
		onDelete();
	});
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
	/** Invoked after a structural change (delete/clone/extends) that the parent
	 *  settings tab must re-render to reflect (the type tree or summary changed). */
	private readonly onStructureChange: () => void;
	private container!: HTMLElement;
	private debounceTimer: number | null = null;
	private pending: Partial<TypeSchema> = {};

	constructor(plugin: SchemaPlugin, schemaName: string, onStructureChange: () => void) {
		this.plugin = plugin;
		this.schemaName = schemaName;
		this.onStructureChange = onStructureChange;
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

		const chevron = summary.createSpan({ cls: "schema-summary-chevron" });
		setIcon(chevron, "chevron-right");

		const chip = summary.createSpan({ cls: "schema-type-chip" });
		if (color) chip.style.setProperty("--type-color", color);
		if (iconName) {
			const iconEl = chip.createSpan({ cls: "schema-type-icon" });
			setIcon(iconEl, iconName);
		}
		chip.createSpan({ cls: "schema-type-name", text: schema.name });

		const ext = schema.extends ? `extends ${schema.extends}` : "";
		const meta: string[] = [];
		if (ext) meta.push(ext);
		meta.push(`${schema.fields.length} fields`);
		meta.push(`${schema.lookups.length} lookups`);
		meta.push(schema.folder ?? "(abstract)");
		summary.createEl("span", {
			cls: "schema-type-meta",
			text: meta.join(" · "),
		});

		buildTypeRowActions(summary, () => void this.deleteSelf(schema));

		const body = details.createEl("div", { cls: "schema-type-body" });
		this.renderBasics(body, schema);
		this.renderDefaults(body, schema);
		this.renderFields(body, schema);
		this.renderLookups(body, schema);
		this.renderDelete(body, schema);
	}

	private renderBasics(parent: HTMLElement, schema: TypeSchema): void {
		parent.createEl("h5", { text: "Basics" });
		const ind = parent.createDiv({ cls: "schema-section-indent" });

		new Setting(ind).setName("Name").setDesc("Read-only after creation.").addText((t) => {
			t.setValue(schema.name).setDisabled(true);
		});

		new Setting(ind)
			.setName("Extends")
			.setDesc("Parent type. The validator checks the chain; field merging is not done.")
			.addDropdown((d) => {
				d.addOption("", "(none)");
				for (const other of this.plugin.loader.getAll()) {
					if (other.name === schema.name) continue;
					d.addOption(other.name, other.name);
				}
				d.setValue(schema.extends ?? "");
				d.onChange((v) => {
					// Extends restructures the tree (nesting + inheritance hints),
					// so commit immediately and ask the parent to re-render.
					this.pending = { ...this.pending, extends: v || undefined };
					this.flush();
					this.onStructureChange();
				});
			});

		new Setting(ind)
			.setName("Folder")
			.setDesc("Where instances live. Supports {{date:YYYY}} / {{date:YYYY-MM}} tokens. Leave blank for abstract parents.")
			.addText((t) => {
				t.setValue(schema.folder ?? "")
					.setPlaceholder("e.g. Facts/People or Moments/{{date:YYYY}}")
					.onChange((v) => this.queue({ folder: v || undefined }));
			});

		const filenamePreview = ind.createDiv({ cls: "schema-filename-preview" });
		const updatePreview = (template: string) => {
			filenamePreview.setText(`→ ${this.previewFilename(schema, template)}`);
		};
		updatePreview(schema.filename ?? "");

		new Setting(ind)
			.setName("Filename template")
			.setDesc("Tokens: {{firstname}}, prompted fields, and {{date:YYYYMMDD-HHmm}} / {{time:HHmm}} (moment.js). Blank → timestamp.")
			.addText((t) => {
				t.setValue(schema.filename ?? "")
					.setPlaceholder("e.g. {{firstname}} {{lastname}} or {{date:YYYYMMDD-HHmm}}")
					.onChange((v) => {
						updatePreview(v);
						this.queue({ filename: v || undefined });
					});
			});
		ind.append(filenamePreview);

		new Setting(ind)
			.setName("Body template")
			.setDesc(
				"Path to a Templater file (vault-relative). Applied on creation; on type-change, asks before merging if body has content. Requires the Templater plugin."
			)
			.addText((t) => {
				t.setValue(schema.bodyTemplate ?? "")
					.setPlaceholder("e.g. Templates/Body/event.md")
					.onChange((v) => this.queue({ bodyTemplate: v.trim() || undefined }));
			});

		new Setting(ind)
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

		new Setting(ind)
			.setName("Create note command")
			.setDesc(
				"When on, `Schema: New " + schema.name + "` appears in the command palette. Untick to keep abstract or rarely-created types out of the palette."
			)
			.addToggle((toggle) => {
				toggle
					.setValue(schema.exposeCreateCommand !== false)
					.onChange((v) => {
						this.queue({ exposeCreateCommand: v });
					});
			});
	}

	private renderDefaults(parent: HTMLElement, schema: TypeSchema): void {
		parent.createEl("h5", { text: "Defaults" });
		const ind = parent.createDiv({ cls: "schema-section-indent" });

		const fields = this.plugin.settings.autoRefreshedFields;
		if (fields.length === 0) {
			ind.createEl("div", {
				cls: "schema-empty",
				text: "(no auto-refreshed fields configured globally — see Settings → Schema → Global)",
			});
			return;
		}

		for (const ar of fields) {
			const current = schema.defaults?.[ar.name];
			const value = typeof current === "string" ? current : current != null ? String(current) : "";
			const setting = new Setting(ind).setName(ar.name);
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
		const container = parent.createDiv({ cls: "schema-section-indent" });
		const inherited = inheritedFieldNames(this.plugin.loader.rawMap(), schema.name);
		if (inherited.length > 0) {
			container.createEl("div", {
				cls: "schema-inheritance-hint",
				text: `+ inherited from ${schema.extends}: ${inherited.join(", ")}`,
			});
		}
		new FieldListEditor(this.plugin, schema.name, this.onStructureChange).render(container);
	}

	private renderLookups(parent: HTMLElement, schema: TypeSchema): void {
		parent.createEl("h5", { text: `Lookups (${schema.lookups.length})` });
		const container = parent.createDiv({ cls: "schema-section-indent" });
		const inherited = inheritedLookupNames(this.plugin.loader.rawMap(), schema.name);
		if (inherited.length > 0) {
			container.createEl("div", {
				cls: "schema-inheritance-hint",
				text: `+ inherited from ${schema.extends}: ${inherited.join(", ")}`,
			});
		}
		const resolved = this.plugin.loader.getResolved(schema.name);
		const rawNames = new Set(schema.lookups.map((l) => l.name));
		const synthesized = synthesizedInverseLookups(this.plugin.loader.rawMap(), schema.name);
		if (synthesized.length > 0 && resolved) {
			const previewWrap = container.createDiv({ cls: "schema-inverse-preview" });
			previewWrap.createEl("div", {
				cls: "schema-inheritance-hint",
				text: `+ inverse (auto-generated):`,
			});
			for (const s of synthesized) {
				if (rawNames.has(s.name)) continue; // manual lookup wins; don't preview
				const item = previewWrap.createDiv({ cls: "schema-inverse-item" });
				item.createEl("div", {
					cls: "schema-inverse-name",
					text: `${s.name} (← ${s.sourceType})`,
				});
				const synthLookup = resolved.lookups.find((l) => l.name === s.name);
				if (synthLookup) {
					item.createEl("pre", {
						cls: "schema-inverse-query",
						text: synthLookup.query,
					});
				}
			}
		}
		new LookupListEditor(this.plugin, schema.name, this.onStructureChange).render(container);
	}

	private renderDelete(parent: HTMLElement, schema: TypeSchema): void {
		new Setting(parent)
			.addButton((btn) => {
				btn.setButtonText("Clone type").onClick(() => void this.cloneType(schema));
			})
			.addButton((btn) => {
				btn.setButtonText("Delete type")
					.setWarning()
					.onClick(() => void this.deleteSelf(schema));
			});
	}

	private async deleteSelf(schema: TypeSchema): Promise<void> {
		const ok = await confirmAction(
			this.plugin.app,
			`Delete type "${schema.name}"? Existing notes with this type will keep their frontmatter but lose schema validation.`
		);
		if (!ok) return;
		this.plugin.loader.remove(schema.name);
		new Notice(`Schema: deleted type "${schema.name}".`);
		this.onStructureChange();
	}

	/** Render the filename template with placeholder values for any prompted
	 *  fields, plus the current date. Just for the inline preview. */
	private previewFilename(schema: TypeSchema, template: string): string {
		const ctx: Record<string, unknown> = {};
		for (const f of schema.fields) {
			if (f.promptOnCreate && !(f.name in ctx)) {
				ctx[f.name] = `<${f.name}>`;
			}
		}
		const tpl = template.trim().length > 0 ? template : "{{date:YYYYMMDD-HHmm}}";
		const rendered = renderTemplate(tpl, ctx).trim();
		return rendered.length > 0 ? `${rendered}.md` : "(empty)";
	}

	private async cloneType(schema: TypeSchema): Promise<void> {
		const name = await promptForString(
			this.plugin.app,
			`Clone "${schema.name}"`,
			"New type name"
		);
		if (!name) return;
		if (this.plugin.loader.get(name)) {
			new Notice(`Schema: type "${name}" already exists.`);
			return;
		}
		const clone: TypeSchema = {
			name,
			extends: schema.extends,
			folder: schema.folder,
			filename: schema.filename,
			bodyTemplate: schema.bodyTemplate,
			tags: [...schema.tags],
			fields: schema.fields.map((f) => ({ ...f, options: f.options ? { ...f.options } : undefined })),
			lookups: schema.lookups.map((l) => ({ ...l })),
			defaults: { ...schema.defaults },
			version: schema.version,
		};
		this.plugin.loader.add(clone);
		new Notice(`Schema: cloned "${schema.name}" → "${name}".`);
		this.onStructureChange();
	}

	private queue(partial: Partial<TypeSchema>): void {
		this.pending = { ...this.pending, ...partial };
		if (this.debounceTimer != null) window.clearTimeout(this.debounceTimer);
		this.debounceTimer = window.setTimeout(() => this.flush(), 400);
	}

	/** Commit any pending edits immediately, cancelling the debounce timer.
	 *  Used before a structural re-render so in-flight text edits aren't lost. */
	private flush(): void {
		if (this.debounceTimer != null) {
			window.clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}
		if (Object.keys(this.pending).length === 0) return;
		const p = this.pending;
		this.pending = {};
		this.plugin.loader.update(this.schemaName, p);
	}
}
