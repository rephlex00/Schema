import { Notice, Setting, setIcon, TFile } from "obsidian";
import {
	compareTemplateToSchema,
	extractTemplatePropertyList,
	resolveBodyTemplatePath,
	writeTemplatePropertyList,
	fieldTypeFromObsidianType,
	type TemplateComparison,
	type TemplateCompareRow,
	type TemplatePropertyEntry,
} from "../lifecycle/body-template";
import { TemplaterBridge } from "../lifecycle/templater-bridge";
import type SchemaPlugin from "../main";
import { inheritedFieldsWithSource, inheritedLookupNames } from "../schema/resolve";
import type { FieldSchema, TypeSchema } from "../schema/types";
import { renderTemplate } from "../util/liquid";
import { effectiveFields, getUniversalFields } from "../util/universal";
import { renderBacklinksCards } from "./backlinks-card";
import { renderColorControl, renderIconControl } from "./widgets/pickers";
import { buildRowActions, FieldListEditor, type InheritedRow } from "./field-list-editor";
import { FolderSuggest, TemplateFileSuggest } from "./file-suggest";
import { LookupListEditor } from "./lookup-list-editor";
import { confirmAction, promptForString } from "./prompt-modal";
import { renderSection } from "./section";

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
		details.setAttr("data-schema-anchor", `type:${schema.name}`);
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
		meta.push(`${schema.fields.length} propert${schema.fields.length === 1 ? "y" : "ies"}`);
		meta.push(`${schema.lookups.length} lookup${schema.lookups.length === 1 ? "" : "s"}`);
		meta.push(schema.folder ?? "(no folder · parent only)");
		summary.createEl("span", {
			cls: "schema-type-meta",
			text: meta.join(" · "),
		});

		// Types can't be reordered here (the list is tree-sorted by extends chain),
		// so the only action is delete.
		buildRowActions(summary, [
			{
				icon: "trash-2",
				label: "Delete object type",
				danger: true,
				handler: () => void this.deleteSelf(schema),
			},
		]);

		const body = details.createEl("div", { cls: "schema-type-body" });
		this.renderBasics(body, schema);
		this.renderDefaults(body, schema);
		this.renderFields(body, schema);
		this.renderLookups(body, schema);
		this.renderDelete(body, schema);
	}

	private renderBasics(parent: HTMLElement, schema: TypeSchema): void {
		const body = renderSection(parent, {
			title: "Basics",
			description: "Name, inheritance, folder, filename, body template, and tags.",
		});

		const typeKey = this.plugin.settings.typeKey;
		new Setting(body)
			.setName("Name")
			.setDesc(`The value this object type's notes will carry in their \`${typeKey}:\` property. Can't be renamed once the object type exists. Clone it to make a copy with a new name.`)
			.addText((t) => {
				t.setValue(schema.name).setDisabled(true);
			});

		new Setting(body)
			.setName("Inherits from")
			.setDesc("Pick another object type to extend. This object type then inherits its parent's properties, lookups, and defaults. You only configure what's different. Useful for variants like \"author\" extending \"person\".")
			.addDropdown((d) => {
				d.addOption("", "(none)");
				for (const other of this.plugin.loader.getAll()) {
					if (other.name === schema.name) continue;
					d.addOption(other.name, other.name);
				}
				d.setValue(schema.extends ?? "");
				d.onChange((v) => this.queue({ extends: v || undefined }));
			});

		new Setting(body)
			.setName("Folder")
			.setDesc("Where new notes of this object type go. Date tokens like {{date:YYYY}} and {{date:YYYY-MM}} are expanded when the note is created (handy for journals). Leave blank if this object type is parent-only (never instantiated).")
			.addText((t) => {
				t.setValue(schema.folder ?? "")
					.setPlaceholder("e.g. Facts/People or Moments/{{date:YYYY}}")
					.onChange((v) => this.queue({ folder: v || undefined }));
				new FolderSuggest(this.plugin.app, t.inputEl).onSelect((folder) => {
					t.setValue(folder.path);
					this.queue({ folder: folder.path });
				});
			});

		// Filename pattern row with the live preview tucked underneath it.
		const filenameBlock = body.createDiv({ cls: "schema-section-row-block" });
		new Setting(filenameBlock)
			.setName("Filename pattern")
			.setDesc("How new notes of this object type are named. Use {{property_name}} for any property and date tokens like {{date:YYYYMMDD-HHmm}} or {{time:HHmm}}. Leave blank to use a date-time stamp.")
			.addText((t) => {
				t.setValue(schema.filename ?? "")
					.setPlaceholder("e.g. {{firstname}} {{lastname}} or {{date:YYYYMMDD-HHmm}}")
					.onChange((v) => {
						updatePreview(v);
						this.queue({ filename: v || undefined });
					});
			});
		const filenameAppendix = filenameBlock.createDiv({ cls: "schema-section-row-appendix" });
		const filenamePreview = filenameAppendix.createDiv({ cls: "schema-filename-preview" });
		const updatePreview = (template: string) => {
			filenamePreview.setText(`→ ${this.previewFilename(schema, template)}`);
		};
		updatePreview(schema.filename ?? "");

		this.renderBodyTemplateRow(body, schema);

		new Setting(body)
			.setName("Tags")
			.setDesc(`Any note carrying one of these tags is treated as this object type, even without an explicit \`${typeKey}:\` property. One tag per line, no leading #. Example: type/person`)
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

		new Setting(body)
			.setName(`Add a "new ${schema.name}" command`)
			.setDesc(
				`Adds "Schema: New ${schema.name}" to the command palette and hotkey list, so you can create one with a keystroke. Turn off for parent-only object types that aren't meant to be instantiated.`
			)
			.addToggle((toggle) => {
				toggle
					.setValue(schema.exposeCreateCommand !== false)
					.onChange((v) => {
						this.queue({ exposeCreateCommand: v });
					});
			});
	}

	/**
	 * Body-template row: path input + Save/Load buttons + status + diff hint.
	 *
	 * Save and Load each enable only when the template's frontmatter and the
	 * type's property list disagree. Save writes property names/defaults into
	 * the template's frontmatter (preserving its Templater body). Load adopts
	 * the template's property list, adding global properties for keys that
	 * don't exist yet.
	 */
	private renderBodyTemplateRow(body: HTMLElement, schema: TypeSchema): void {
		const isTemplaterInstalled = () => new TemplaterBridge(this.plugin.app).isInstalled();

		const block = body.createDiv({ cls: "schema-section-row-block" });

		let pathInput: HTMLInputElement | null = null;

		let saveBtn: HTMLButtonElement | null = null;
		let loadBtn: HTMLButtonElement | null = null;
		let inFlight = false;
		let refreshTimer: number | null = null;
		// Accordion open state. null = follow the default (open when out of sync);
		// once the user toggles it, their choice sticks across refreshes.
		let expanded: boolean | null = null;

		const setButtonsEnabled = (saveEnabled: boolean, loadEnabled: boolean) => {
			if (saveBtn) {
				saveBtn.disabled = !saveEnabled;
				if (saveEnabled) saveBtn.addClass("mod-cta");
				else saveBtn.removeClass("mod-cta");
			}
			if (loadBtn) {
				loadBtn.disabled = !loadEnabled;
				if (loadEnabled) loadBtn.addClass("mod-cta");
				else loadBtn.removeClass("mod-cta");
			}
		};

		const refresh = async () => {
			if (inFlight) return;
			// Use the resolved schema (own + inherited fields) for the diff.
			// Templates legitimately contain inherited keys, so comparing
			// against own-only would flag every multi-level type as out of
			// sync forever.
			const rawFresh = this.plugin.loader.get(schema.name) ?? schema;
			const fresh = this.plugin.loader.getResolved(schema.name) ?? rawFresh;
			const templaterInstalled = isTemplaterInstalled();
			warnEl.empty();
			warnEl.removeClass("visible");
			if (pathInput) pathInput.removeClass("schema-input-invalid");

			const explicit = !!(rawFresh.bodyTemplate && rawFresh.bodyTemplate.trim().length > 0);
			const resolved = resolveBodyTemplatePath(this.plugin, rawFresh);

			if (!resolved) {
				statusEl.setText("No template assigned.");
				setButtonsEnabled(false, false);
				return;
			}

			const file = this.plugin.app.vault.getAbstractFileByPath(resolved);
			if (!(file instanceof TFile)) {
				warnEl.setText(`Template not found: ${resolved}`);
				warnEl.addClass("visible");
				if (pathInput && explicit) pathInput.addClass("schema-input-invalid");
				statusEl.setText("No template assigned.");
				setButtonsEnabled(false, false);
				return;
			}

			const template = (await extractTemplatePropertyList(this.plugin, resolved, fresh)) ?? [];
			const comparison = compareTemplateToSchema(template, fresh);
			const inSync = comparison.inSync;

			statusEl.empty();
			this.renderTemplateCompare(statusEl, {
				resolved,
				explicit,
				comparison,
				open: expanded ?? !inSync,
				onToggle: (next) => {
					expanded = next;
				},
			});

			const buttonsEnabled = !inSync && templaterInstalled;
			setButtonsEnabled(buttonsEnabled, buttonsEnabled);
		};

		// Debounce refresh during text-input bursts so we don't vault.read +
		// YAML-parse the template on every keystroke.
		const scheduleRefresh = () => {
			if (refreshTimer != null) window.clearTimeout(refreshTimer);
			refreshTimer = window.setTimeout(() => {
				refreshTimer = null;
				void refresh();
			}, 200);
		};

		const guardedAction = async (action: () => Promise<void>) => {
			if (inFlight) return;
			inFlight = true;
			setButtonsEnabled(false, false);
			try {
				await action();
			} finally {
				inFlight = false;
				await refresh();
			}
		};

		new Setting(block)
			.setName("Body template")
			.setDesc(
				isTemplaterInstalled()
					? `Templater file used as the starting body for new notes of this object type. Also applied when an existing note becomes this object type. The template's frontmatter mirrors this object type's property list (use Save and Load below to sync). Suggestions come from your templates folder set in Lifecycle → Templates.`
					: `Templater is not installed. Body templates are disabled until you install it.`
			)
			.addText((t) => {
				pathInput = t.inputEl;
				t.setValue(schema.bodyTemplate ?? "")
					.setPlaceholder("e.g. Templates/Body/event.md")
					.setDisabled(!isTemplaterInstalled())
					.onChange((v) => {
						this.queue({ bodyTemplate: v.trim() || undefined });
						scheduleRefresh();
					});
				const suggest = new TemplateFileSuggest(
					this.plugin.app,
					t.inputEl,
					this.plugin.settings.templatesFolder
				);
				suggest.onSelect((file) => {
					t.setValue(file.path);
					this.queue({ bodyTemplate: file.path });
					scheduleRefresh();
				});
			});

		const appendix = block.createDiv({ cls: "schema-section-row-appendix" });
		const statusEl = appendix.createDiv({ cls: "schema-body-template-status" });
		const warnEl = appendix.createDiv({ cls: "schema-inline-warning" });

		const actions = block.createDiv({ cls: "schema-section-row-actions" });
		actions.createDiv({
			cls: "schema-section-row-actions-note",
			text: "Syncs frontmatter only - template body is preserved.",
		});
		saveBtn = actions.createEl("button", {
			text: "Save to template",
			attr: { type: "button", title: "Write this object type's property list into the template's frontmatter (body untouched)" },
		});
		saveBtn.disabled = true;
		saveBtn.addEventListener("click", () => void guardedAction(() => this.handleSaveToTemplate(schema)));

		loadBtn = actions.createEl("button", {
			text: "Load from template",
			attr: { type: "button", title: "Replace this object type's owned property list with what's in the template's frontmatter (inherited properties unchanged)" },
		});
		loadBtn.disabled = true;
		loadBtn.addEventListener("click", () => void guardedAction(() => this.handleLoadFromTemplate(schema)));

		void refresh();
	}

	/** Render the body-template sync card as an accordion: a summary row (path,
	 *  source, sync pill, chevron) that expands into a settings-vs-template
	 *  side-by-side comparison with the mismatches called out. */
	private renderTemplateCompare(
		parent: HTMLElement,
		opts: {
			resolved: string;
			explicit: boolean;
			comparison: TemplateComparison;
			open: boolean;
			onToggle: (open: boolean) => void;
		}
	): void {
		const { resolved, explicit, comparison } = opts;
		const inSync = comparison.inSync;

		const details = parent.createEl("details", { cls: "schema-template-compare" });
		details.open = opts.open;
		details.addEventListener("toggle", () => opts.onToggle(details.open));

		const summary = details.createEl("summary", { cls: "schema-body-template-active" });
		const iconEl = summary.createSpan({ cls: "schema-body-template-active-icon" });
		setIcon(iconEl, "file-text");
		const text = summary.createDiv({ cls: "schema-body-template-active-text" });
		text.createDiv({ cls: "schema-body-template-active-path", text: resolved });
		text.createDiv({
			cls: "schema-body-template-active-source",
			text: explicit ? "Set manually on this object type" : "Auto-detected by object-type name",
		});
		const pill = summary.createSpan({
			cls: `schema-sync-pill ${inSync ? "is-ok" : "is-warn"}`,
		});
		const pillIcon = pill.createSpan({ cls: "schema-sync-pill-icon" });
		setIcon(pillIcon, inSync ? "check" : "alert-triangle");
		pill.createSpan({ text: inSync ? "In sync" : "Out of sync" });
		const chevron = summary.createSpan({ cls: "schema-template-compare-chevron" });
		setIcon(chevron, "chevron-down");

		const bodyEl = details.createDiv({ cls: "schema-template-compare-body" });

		if (!inSync) {
			const reasons: string[] = [];
			const { missing, extra, typeMismatch } = comparison.counts;
			if (missing > 0) reasons.push(`${missing} missing from template`);
			if (extra > 0) reasons.push(`${extra} extra in template`);
			if (typeMismatch > 0)
				reasons.push(`${typeMismatch} type ${typeMismatch === 1 ? "mismatch" : "mismatches"}`);
			if (comparison.order === "different") reasons.push("property order differs");
			bodyEl.createDiv({
				cls: "schema-template-compare-reason",
				text: `Out of sync: ${reasons.join(", ")}.`,
			});
		}

		const grid = bodyEl.createDiv({ cls: "schema-template-compare-grid" });
		grid.createDiv({ cls: "schema-template-compare-head", text: "Settings" });
		grid.createDiv({ cls: "schema-template-compare-head schema-template-compare-gutter" });
		grid.createDiv({ cls: "schema-template-compare-head", text: "Template" });

		for (const row of comparison.rows) {
			this.renderCompareRow(grid, row);
		}
	}

	private renderCompareRow(grid: HTMLElement, row: TemplateCompareRow): void {
		const GLYPH: Record<TemplateCompareRow["status"], string> = {
			match: "=",
			"missing-in-template": "→",
			"extra-in-template": "←",
			"type-mismatch": "≠",
		};

		const settings = grid.createDiv({
			cls: `schema-template-compare-cell schema-compare-${row.status}`,
		});
		if (row.settingsType) {
			settings.createSpan({ cls: "schema-template-compare-name", text: row.name });
			settings.createSpan({ cls: "schema-template-compare-type", text: row.settingsType });
		} else {
			settings.createSpan({ cls: "schema-template-compare-absent", text: "—" });
		}

		grid.createDiv({
			cls: `schema-template-compare-gutter schema-compare-${row.status}`,
			text: GLYPH[row.status],
		});

		const template = grid.createDiv({
			cls: `schema-template-compare-cell schema-compare-${row.status}`,
		});
		if (row.templateType) {
			template.createSpan({ cls: "schema-template-compare-name", text: row.name });
			template.createSpan({ cls: "schema-template-compare-type", text: row.templateType });
		} else {
			template.createSpan({ cls: "schema-template-compare-absent", text: "—" });
		}
	}

	private async handleSaveToTemplate(schema: TypeSchema): Promise<void> {
		const rawFresh = this.plugin.loader.get(schema.name) ?? schema;
		const resolvedSchema = this.plugin.loader.getResolved(schema.name) ?? rawFresh;
		const resolved = resolveBodyTemplatePath(this.plugin, rawFresh);
		if (!resolved) return;
		try {
			// Write the merged (own + inherited) field list so the template's
			// frontmatter matches the full shape of a real note.
			await writeTemplatePropertyList(this.plugin, resolved, resolvedSchema);
			new Notice(`Schema: template ${resolved} frontmatter updated (body untouched).`);
		} catch (err) {
			console.error("[schema] writeTemplatePropertyList failed:", err);
			new Notice(`Schema: failed to write template. See console.`);
		}
	}

	private async handleLoadFromTemplate(schema: TypeSchema): Promise<void> {
		const fresh = this.plugin.loader.get(schema.name) ?? schema;
		const resolved = resolveBodyTemplatePath(this.plugin, fresh);
		if (!resolved) return;
		const entries = await extractTemplatePropertyList(this.plugin, resolved, fresh);
		if (!entries) return;
		this.applyTemplatePropertyList(fresh, entries);
	}

	private applyTemplatePropertyList(schema: TypeSchema, entries: TemplatePropertyEntry[]): void {
		// Skip entries inherited from a parent - Load on a child shouldn't
		// silently steal inherited fields into the child's owned list, since
		// that breaks future inheritance changes on the parent.
		const inheritedNames = new Set(
			inheritedFieldsWithSource(this.plugin.loader.rawMap(), schema.name).map(
				({ field }) => field.name
			)
		);
		const globals: Record<string, FieldSchema> = { ...this.plugin.settings.globalFields };
		const nextFields: FieldSchema[] = [];
		for (const entry of entries) {
			if (inheritedNames.has(entry.name)) continue;
			if (!globals[entry.name]) {
				globals[entry.name] = {
					name: entry.name,
					type: fieldTypeFromObsidianType(entry.obsidianType),
				};
			}
			nextFields.push({ name: entry.name, type: globals[entry.name].type });
		}
		this.plugin.settings.globalFields = globals;
		const nextSchemas = this.plugin.loader.getAll().map((s) =>
			s.name === schema.name ? { ...s, fields: nextFields } : s
		);
		// updateAll fires schema-changed, whose handler persists settings - no
		// separate saveSettings call is needed.
		this.plugin.loader.updateAll({ schemas: nextSchemas, globalFields: globals });
		new Notice(
			`Schema: ${schema.name} now matches template (${nextFields.length} owned properties, inherited unchanged).`
		);
	}

	private renderDefaults(parent: HTMLElement, schema: TypeSchema): void {
		const fields = effectiveFields(schema, getUniversalFields(this.plugin.settings.globalFields));
		const body = renderSection(parent, {
			title: "Defaults",
			description:
				"Default value for each of this object type's properties. Written into a new note when it's created, and re-applied whenever a note's object type changes. Universal properties (e.g. icon, color) appear on every object type.",
		});

		if (fields.length === 0) {
			body.createEl("div", {
				cls: "schema-empty",
				text: "This object type has no properties yet.",
			});
			return;
		}

		for (const f of fields) {
			const current = schema.defaults?.[f.name];
			const value = typeof current === "string" ? current : current != null ? String(current) : "";
			const setting = new Setting(body).setName(f.name);
			if (f.universal) {
				setting.nameEl.createSpan({ cls: "schema-universal-tag", text: "universal" });
			}
			const onChange = (v: string) => this.queueDefault(schema, f.name, v);
			switch (f.type) {
				case "Color":
					renderColorControl(setting.controlEl, value, onChange);
					break;
				case "Icon":
					renderIconControl(setting.controlEl, value, onChange);
					break;
				default:
					setting.addText((t) => {
						t.setValue(value).onChange(onChange);
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

	private renderFields(parent: HTMLElement, schema: TypeSchema): void {
		const inherited = inheritedFieldsWithSource(this.plugin.loader.rawMap(), schema.name);
		const total = schema.fields.length + inherited.length;
		const body = renderSection(parent, {
			title: "Properties",
			count: String(total),
			description:
				"Properties this object type adds to every note. Each one points to an entry in Settings → Schema → Global properties. That's where the data type (text, number, link, formula…), options, and default editor are defined. Here you only pick which properties this object type uses and whether to ask for them on create.",
		});
		const inheritedRows: InheritedRow[] = inherited.map(({ field, sourceType }) => ({
			field,
			sourceType,
		}));
		new FieldListEditor(this.plugin, schema.name, {
			inherited: inheritedRows,
			onOpenParent: (t) => this.scrollToType(t),
		}).render(body);
	}

	/** Find the ancestor type's `<details>` block in the Objects tab tree and
	 *  expand + scroll to it. Useful for the inheritance hint links. */
	private scrollToType(typeName: string): void {
		const list = this.container.ownerDocument.querySelector(".schema-types-list");
		if (!list) return;
		const blocks = list.querySelectorAll<HTMLElement>(".schema-type-block");
		for (const block of Array.from(blocks)) {
			const summary = block.querySelector(".schema-type-name") as HTMLElement | null;
			if (summary?.textContent?.trim() === typeName) {
				(block as HTMLDetailsElement).open = true;
				block.scrollIntoView({ behavior: "smooth", block: "start" });
				return;
			}
		}
	}

	private renderLookups(parent: HTMLElement, schema: TypeSchema): void {
		renderBacklinksCards(this.plugin, parent, schema);
		this.renderCustomLookups(parent, schema);
	}

	private renderCustomLookups(parent: HTMLElement, schema: TypeSchema): void {
		const details = parent.createEl("details", { cls: "schema-section schema-custom-lookups" });
		const summary = details.createEl("summary", { cls: "schema-section-header schema-custom-lookups-summary" });
		const chevron = summary.createSpan({ cls: "schema-summary-chevron" });
		setIcon(chevron, "chevron-right");
		summary.createSpan({ cls: "schema-section-title", text: "Custom lookups" });
		summary.createSpan({ cls: "schema-section-count", text: String(schema.lookups.length) });

		const body = details.createDiv({ cls: "schema-section-body" });
		body.createDiv({
			cls: "schema-section-desc",
			text: "Hand-written Dataview queries. Most lists you want are already covered by Backlinks above. Use this only for queries that can't be expressed as backlinks.",
		});
		const inherited = inheritedLookupNames(this.plugin.loader.rawMap(), schema.name);
		if (inherited.length > 0) {
			body.createEl("div", {
				cls: "schema-inheritance-hint",
				text: `+ inherited from ${schema.extends}: ${inherited.join(", ")}`,
			});
		}
		new LookupListEditor(this.plugin, schema.name).render(body);
	}

	private renderDelete(parent: HTMLElement, schema: TypeSchema): void {
		const footer = parent.createDiv({ cls: "schema-type-footer" });
		const cloneBtn = footer.createEl("button", {
			text: "Clone type",
			attr: { type: "button" },
		});
		cloneBtn.addEventListener("click", () => void this.cloneType(schema));
		const deleteBtn = footer.createEl("button", {
			text: "Delete type",
			cls: "mod-warning",
			attr: { type: "button" },
		});
		deleteBtn.addEventListener("click", () => void this.deleteSelf(schema));
	}

	private async deleteSelf(schema: TypeSchema): Promise<void> {
		const ok = await confirmAction(
			this.plugin.app,
			`Delete type "${schema.name}"? Existing notes will keep their "type: ${schema.name}" property and contents, but Schema will no longer recognise them as a known type (no defaults, no lookups, no banner or chip).`
		);
		if (!ok) return;
		this.plugin.loader.remove(schema.name);
		new Notice(`Schema: deleted type "${schema.name}".`);
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
			// Thin global-reference stubs - the canonical shape lives in globalFields
			// and the loader re-hydrates on add (mirrors the persisted form).
			fields: schema.fields.map((f) =>
				f.promptOnCreate
					? { name: f.name, type: f.type, promptOnCreate: f.promptOnCreate }
					: { name: f.name, type: f.type }
			),
			lookups: schema.lookups.map((l) => ({ ...l })),
			defaults: { ...schema.defaults },
			version: schema.version,
		};
		this.plugin.loader.add(clone);
		new Notice(`Schema: cloned "${schema.name}" → "${name}".`);
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
