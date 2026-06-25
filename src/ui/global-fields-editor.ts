import { Notice, Setting, setIcon } from "obsidian";
import type SchemaPlugin from "../main";
import { ALL_FIELD_TYPES, type FieldSchema, type FieldType } from "../schema/types";
import { confirmAction, promptForString } from "./prompt-modal";
import { TemplateFileSuggest } from "./file-suggest";
import { TYPE_DESCRIPTIONS } from "./type-selector";

/**
 * Renders the "Global properties" pane. The canonical library of property
 * definitions: every property defined on an object type is a reference into
 * this registry; editing a global propagates to every object type that uses
 * it. Renaming a global also rewrites every per-type reference atomically.
 *
 * Each row is an expandable details element with name, data type, and
 * type-specific options (target / inverse for File/MultiFile, options for
 * Select / Formula / Date defaults, etc.). Edits debounce and commit via
 * `loader.updateAll`.
 */
export class GlobalFieldsEditor {
	private readonly plugin: SchemaPlugin;
	private readonly onChange: () => void;
	private debounceTimer: number | null = null;
	private pending = new Map<string, Partial<FieldSchema>>();

	constructor(plugin: SchemaPlugin, onChange: () => void) {
		this.plugin = plugin;
		this.onChange = onChange;
	}

	render(parent: HTMLElement): void {
		const wrap = parent.createDiv({ cls: "schema-global-fields-editor" });

		const globals = this.plugin.settings.globalFields ?? {};
		const entries = Object.entries(globals).sort((a, b) => a[0].localeCompare(b[0]));

		new Setting(wrap)
			.setName("Property library")
			.setDesc(
				"Every property used by any object type is defined here once. An object type just picks which properties it uses; the data type, options, target, etc. all come from this list. Edit a property here and every object type that uses it updates automatically."
			)
			.addButton((btn) => {
				btn.setButtonText("+ Add property")
					.setCta()
					.onClick(() => void this.addField());
			});

		if (entries.length === 0) {
			wrap.createEl("div", { cls: "schema-empty", text: "No properties defined yet." });
			return;
		}

		const list = wrap.createDiv({ cls: "schema-fields-list" });
		for (const [name, field] of entries) {
			this.renderRow(list, name, field);
		}
	}

	private renderRow(parent: HTMLElement, name: string, field: FieldSchema): void {
		const usingTypes = this.typesUsingProperty(name);
		const details = parent.createEl("details", { cls: "schema-field-row schema-gf-row" });
		details.setAttr("data-schema-anchor", `global-property:${name}`);
		const summary = details.createEl("summary");
		const chevron = summary.createSpan({ cls: "schema-summary-chevron" });
		setIcon(chevron, "chevron-right");
		const text = summary.createSpan({ cls: "schema-row-text" });
		text.createEl("strong", { text: name });
		const meta: string[] = [field.type];
		if (field.target) meta.push(`→ ${field.target}`);
		if (field.universal) meta.push("universal");
		if (field.hidden) meta.push("hidden");
		meta.push(
			usingTypes.length === 0
				? "unused"
				: `${usingTypes.length} usage${usingTypes.length === 1 ? "" : "s"}`
		);
		text.createEl("span", { cls: "schema-type-meta", text: ` · ${meta.join(" · ")}` });

		const actions = summary.createSpan({ cls: "schema-row-actions" });
		const delBtn = actions.createEl("button", {
			cls: "schema-row-btn schema-row-btn-danger",
			attr: { type: "button", "aria-label": "Delete property", title: "Delete property" },
		});
		setIcon(delBtn, "trash-2");
		delBtn.addEventListener("click", (e) => {
			e.preventDefault();
			e.stopPropagation();
			void this.removeField(name);
		});

		const body = details.createEl("div", { cls: "schema-field-body schema-gf-expanded" });

		new Setting(body)
			.setName("Name")
			.setDesc("The YAML property name as it appears in notes. Renaming here renames it on every object type that uses this property. No broken links.")
			.addText((t) => {
				t.setValue(name).onChange((v) => {
					const newName = v.trim();
					if (!newName || newName === name) return;
					// Defer rename until blur to avoid renaming on every keystroke.
				});
				t.inputEl.addEventListener("change", () => {
					const newName = t.inputEl.value.trim();
					if (!newName || newName === name) {
						t.inputEl.value = name;
						return;
					}
					void this.renameField(name, newName);
				});
			});

		let descEl: HTMLElement | null = null;
		const typeSetting = new Setting(body)
			.setName("Data type")
			.addDropdown((d) => {
				for (const ft of ALL_FIELD_TYPES) d.addOption(ft, ft);
				d.setValue(field.type);
				d.onChange((next) => {
					this.queueUpdate(name, { type: next as FieldType });
					if (descEl) descEl.setText(TYPE_DESCRIPTIONS[next as FieldType] ?? "");
				});
			});
		descEl = typeSetting.controlEl.createDiv({ cls: "schema-data-type-desc" });
		descEl.setText(TYPE_DESCRIPTIONS[field.type] ?? "");

		new Setting(body)
			.setName("Universal")
			.setDesc(
				"Include this property in every object type automatically (no need to add it to each type). Set its default value per object type in that type's Defaults section."
			)
			.addToggle((t) => {
				t.setValue(field.universal === true).onChange((v) => {
					this.queueUpdate(name, { universal: v ? true : undefined });
				});
			});

		new Setting(body)
			.setName("Hide from properties panel")
			.setDesc(
				"Keep this property in the note's YAML but hide it from the properties panel in Live Preview and Reading view. It still shows in Source mode."
			)
			.addToggle((t) => {
				t.setValue(field.hidden === true).onChange((v) => {
					this.queueUpdate(name, { hidden: v ? true : undefined });
				});
			});

		this.renderTypeSpecificOptions(body, name, field);

		if (usingTypes.length > 0) {
			const usedBy = body.createDiv({ cls: "schema-gf-used-by" });
			usedBy.createSpan({ cls: "schema-gf-used-by-label", text: "Used by:" });
			usingTypes.forEach((typeName, i) => {
				if (i > 0) usedBy.createSpan({ text: " · " });
				usedBy.createSpan({ cls: "schema-gf-used-by-chip", text: typeName });
			});
		}
	}

	private renderTypeSpecificOptions(parent: HTMLElement, name: string, field: FieldSchema): void {
		switch (field.type) {
			case "File":
			case "MultiFile": {
				// Track the live control values so the hint reflects edits - the
				// captured `field` object is replaced (not mutated) by queueUpdate,
				// so reading field.inverse/field.target here would always be stale.
				let currentTarget = field.target ?? "";
				let currentInverse = field.inverse ?? "";
				new Setting(parent)
					.setName("Links to notes of object type")
					.setDesc("Restricts the link picker to notes of one specific object type. Leave blank to allow links to any note.")
					.addDropdown((d) => {
						d.addOption("", "(any note)");
						for (const s of this.plugin.loader.getAll()) {
							d.addOption(s.name, s.name);
						}
						d.setValue(field.target ?? "");
						d.onChange((v) => {
							currentTarget = v;
							this.queueUpdate(name, { target: v || undefined });
							updateBacklinkHint();
						});
					});
				const inverseSetting = new Setting(parent)
					.setName("Backlinks name")
					.setDesc(
						"When set, every note of the target object type gets a frontmatter list under this name containing every note that links here via this property. Leave blank to skip. Example: on `person.organization` (target = organization), setting this to \"members\" gives every organization note a `members:` list of the people who work there."
					)
					.addText((t) => {
						t.setValue(field.inverse ?? "")
							.setPlaceholder("e.g. members")
							.onChange((v) => {
								currentInverse = v;
								this.queueUpdate(name, { inverse: v.trim() || undefined });
								updateBacklinkHint();
							});
					});
				const hintEl = inverseSetting.settingEl.createDiv({
					cls: "schema-backlinks-hint",
				});
				const updateBacklinkHint = () => {
					hintEl.empty();
					const trimmed = currentInverse.trim();
					const target = currentTarget.trim();
					if (!trimmed) return;
					if (!target) {
						hintEl.addClass("schema-backlinks-hint-warn");
						hintEl.setText(
							"Set the target object type above before naming the backlinks list."
						);
						return;
					}
					hintEl.removeClass("schema-backlinks-hint-warn");
					hintEl.appendText("→ Creates a ");
					hintEl.createEl("code", { text: trimmed });
					hintEl.appendText(" backlinks list on ");
					const link = hintEl.createEl("a", { text: target, href: "#" });
					link.addEventListener("click", (e) => {
						e.preventDefault();
						this.plugin.navigateSettings?.(
							"structure-types",
							`type:${target}`
						);
					});
					hintEl.appendText(".");
				};
				updateBacklinkHint();
				return;
			}
			case "Formula": {
				const opts = (field.options ?? {}) as Record<string, unknown>;
				new Setting(parent)
					.setName("Expression")
					.setDesc("JavaScript expression evaluated against the note's properties. Use `fm` for the property map and `file` for the file. Example: fm.firstname + ' ' + fm.lastname")
					.addTextArea((t) => {
						t.setValue(typeof opts.expression === "string" ? opts.expression : "")
							.setPlaceholder("fm.firstname + ' ' + fm.lastname")
							.onChange((v) => {
								this.queueUpdate(name, {
									options: { ...opts, expression: v },
								});
							});
						t.inputEl.rows = 2;
						t.inputEl.style.fontFamily = "var(--font-monospace)";
					});
				return;
			}
			case "Date":
			case "DateTime":
			case "Time": {
				const opts = (field.options ?? {}) as Record<string, unknown>;
				new Setting(parent)
					.setName("Pre-fill with the current date/time when a note is created")
					.addToggle((t) => {
						t.setValue(opts.defaultNow === true).onChange((v) => {
							const next = { ...opts };
							if (v) next.defaultNow = true;
							else delete next.defaultNow;
							this.queueUpdate(name, { options: next });
						});
					});
				return;
			}
			case "Select":
			case "Cycle": {
				const opts = (field.options ?? {}) as Record<string, unknown>;
				new Setting(parent)
					.setName("Pull choices from a note")
					.setDesc("Path to a note whose bullet-list items become the choices. Useful for sharing one list (e.g. relationship types) across many properties.")
					.addText((t) => {
						t.setValue(
							typeof opts.valuesListNotePath === "string"
								? opts.valuesListNotePath
								: ""
						)
							.setPlaceholder("e.g. Templates/Definitions/relationships.md")
							.onChange((v) => {
								const next = { ...opts };
								if (v.trim() === "") delete next.valuesListNotePath;
								else next.valuesListNotePath = v.trim();
								this.queueUpdate(name, { options: next });
							});
						new TemplateFileSuggest(this.plugin.app, t.inputEl, "").onSelect((file) => {
							t.setValue(file.path);
							const next = { ...opts, valuesListNotePath: file.path };
							this.queueUpdate(name, { options: next });
						});
					});
				new Setting(parent)
					.setName("Or list the choices here")
					.setDesc("One choice per line. Only used when the note path above is empty.")
					.addTextArea((t) => {
						const values = opts.valuesList as Record<string, string> | undefined;
						const lines = values ? Object.values(values).join("\n") : "";
						t.setValue(lines).onChange((v) => {
							const items = v.split("\n").map((s) => s.trim()).filter(Boolean);
							const valuesList: Record<string, string> = {};
							items.forEach((val, i) => (valuesList[String(i)] = val));
							this.queueUpdate(name, { options: { ...opts, valuesList } });
						});
						t.inputEl.rows = 3;
					});
				return;
			}
			default:
				return;
		}
	}

	private async addField(): Promise<void> {
		const name = await promptForString(
			this.plugin.app,
			"Add property",
			"Property name (as it will appear in YAML)"
		);
		if (!name) return;
		const norm = name.trim();
		if (!norm) return;
		if (norm in (this.plugin.settings.globalFields ?? {})) {
			new Notice(`Schema: a property named "${norm}" already exists.`);
			return;
		}
		this.plugin.settings.globalFields[norm] = { name: norm, type: "Input" };
		this.plugin.loader.setGlobalFields(this.plugin.settings.globalFields);
		// schema-changed fires; the SchemaSettingsTab listener re-renders.
	}

	private async removeField(name: string): Promise<void> {
		const usages = this.countUsages(name);
		const usagesMsg = usages > 0
			? ` ${usages} object type${usages === 1 ? "" : "s"} use it. Those usages will be left pointing at nothing until you remove them.`
			: "";
		const ok = await confirmAction(
			this.plugin.app,
			`Delete property "${name}"?${usagesMsg}`
		);
		if (!ok) return;
		delete this.plugin.settings.globalFields[name];
		this.plugin.loader.setGlobalFields(this.plugin.settings.globalFields);
	}

	private async renameField(oldName: string, newName: string): Promise<void> {
		const globals = this.plugin.settings.globalFields;
		if (newName in globals) {
			new Notice(`Schema: a property named "${newName}" already exists.`);
			return;
		}
		// Rename the global entry.
		const renamed: FieldSchema = { ...globals[oldName], name: newName };
		const nextGlobals: Record<string, FieldSchema> = { ...globals, [newName]: renamed };
		delete nextGlobals[oldName];

		// Rename every per-type reference to the old name.
		const nextSchemas = this.plugin.loader.getAll().map((s) => ({
			...s,
			fields: s.fields.map((f) =>
				f.name === oldName ? { ...f, name: newName } : f
			),
		}));

		this.plugin.settings.globalFields = nextGlobals;
		this.plugin.loader.updateAll({ schemas: nextSchemas, globalFields: nextGlobals });
	}

	private queueUpdate(name: string, partial: Partial<FieldSchema>): void {
		const cur = this.pending.get(name) ?? {};
		this.pending.set(name, { ...cur, ...partial });
		if (this.debounceTimer != null) window.clearTimeout(this.debounceTimer);
		this.debounceTimer = window.setTimeout(() => {
			this.debounceTimer = null;
			const updates = this.pending;
			this.pending = new Map();
			const globals = this.plugin.settings.globalFields;
			for (const [n, patch] of updates) {
				if (!globals[n]) continue;
				globals[n] = { ...globals[n], ...patch };
			}
			this.plugin.loader.setGlobalFields(globals);
		}, 400);
	}

	private countUsages(name: string): number {
		return this.typesUsingProperty(name).length;
	}

	private typesUsingProperty(name: string): string[] {
		const used: string[] = [];
		for (const schema of this.plugin.loader.getAll()) {
			if (schema.fields.some((f) => f.name === name)) used.push(schema.name);
		}
		return used.sort((a, b) => a.localeCompare(b));
	}
}
