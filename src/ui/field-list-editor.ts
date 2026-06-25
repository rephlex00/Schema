import { Notice, Setting, TFile, setIcon } from "obsidian";
import { evaluateFormula } from "../lifecycle/formula";
import type SchemaPlugin from "../main";
import { typesLosingFieldOnRemoval } from "../schema/resolve";
import type { FieldSchema, TypeSchema } from "../schema/types";
import { promptForNewField } from "./add-field-modal";
import { openRemovePropertyModal } from "./remove-property-modal";

/** A property inherited from a parent type. Rendered greyed-out and read-only
 *  in the property list, with a link icon that opens the parent type. */
export interface InheritedRow {
	field: FieldSchema;
	sourceType: string;
}

/** Options passed by TypeEditor to control inherited-row rendering. */
export interface FieldListEditorOptions {
	inherited: InheritedRow[];
	onOpenParent: (typeName: string) => void;
}

/** A single row-action button spec. */
export interface RowAction {
	icon: string;
	label: string;
	disabled?: boolean;
	danger?: boolean;
	handler: () => void;
}

/** Row-action toolbar anchored to the right of a details `<summary>`. Buttons
 *  stop propagation so they don't toggle expand, and respect `disabled`. */
export function buildRowActions(summary: HTMLElement, actions: RowAction[]): void {
	const wrap = summary.createSpan({ cls: "schema-row-actions" });
	for (const a of actions) {
		const btn = wrap.createEl("button", {
			cls: `schema-row-btn${a.danger ? " schema-row-btn-danger" : ""}`,
			attr: { type: "button", "aria-label": a.label, title: a.label },
		});
		setIcon(btn, a.icon);
		btn.disabled = a.disabled ?? false;
		btn.addEventListener("click", (e) => {
			e.preventDefault();
			e.stopPropagation();
			if (!btn.disabled) a.handler();
		});
	}
}

/** The common up/down pair used by reorderable rows. */
function moveActions(
	canMoveUp: boolean,
	canMoveDown: boolean,
	onUp: () => void,
	onDown: () => void
): RowAction[] {
	return [
		{ icon: "chevron-up", label: "Move up", disabled: !canMoveUp, handler: onUp },
		{ icon: "chevron-down", label: "Move down", disabled: !canMoveDown, handler: onDown },
	];
}

export { moveActions };

/**
 * Renders the property list for a single TypeSchema. Inherited properties
 * appear first as greyed-out, read-only rows with a link icon to the parent;
 * owned properties follow with editable rows and trash buttons.
 *
 * All edits are debounced through queueCommit, which calls
 * `loader.update(typeName, { fields })` to persist.
 */
export class FieldListEditor {
	private readonly plugin: SchemaPlugin;
	private readonly typeName: string;
	private readonly options: FieldListEditorOptions | null;
	private debounceTimer: number | null = null;
	/** Per-field-index accumulated edits. A single timer flushes all of them
	 *  together so editing field A then field B within 400ms doesn't lose A. */
	private pending = new Map<string, Partial<FieldSchema>>();

	constructor(plugin: SchemaPlugin, typeName: string, options?: FieldListEditorOptions) {
		this.plugin = plugin;
		this.typeName = typeName;
		this.options = options ?? null;
	}

	render(parent: HTMLElement): void {
		const schema = this.plugin.loader.get(this.typeName);
		if (!schema) return;

		new Setting(parent).addButton((btn) => {
			btn.setButtonText("+ Add property")
				.setCta()
				.onClick(() => void this.addField());
		});

		const inheritedOrdered = this.orderedInherited(schema);
		if (inheritedOrdered.length > 0) {
			const inheritedList = parent.createEl("div", { cls: "schema-fields-list schema-fields-inherited" });
			inheritedOrdered.forEach((row, index) => {
				this.renderInheritedRow(inheritedList, schema, row, index, inheritedOrdered);
			});
		}

		if (schema.fields.length === 0 && inheritedOrdered.length === 0) {
			parent.createEl("div", { cls: "schema-empty", text: "No properties yet." });
			return;
		}

		if (schema.fields.length === 0) return;
		const list = parent.createEl("div", { cls: "schema-fields-list" });
		schema.fields.forEach((field, index) => {
			this.renderRow(list, schema, field, index);
		});
	}

	private orderedInherited(schema: TypeSchema): InheritedRow[] {
		const inherited = this.options?.inherited ?? [];
		if (inherited.length === 0) return [];
		const order = schema.inheritedOrder ?? [];
		const byName = new Map(inherited.map((row) => [row.field.name, row] as const));
		const ordered: InheritedRow[] = [];
		const seen = new Set<string>();
		for (const name of order) {
			const row = byName.get(name);
			if (row && !seen.has(name)) {
				ordered.push(row);
				seen.add(name);
			}
		}
		for (const row of inherited) {
			if (!seen.has(row.field.name)) ordered.push(row);
		}
		return ordered;
	}

	private renderInheritedRow(
		parent: HTMLElement,
		schema: TypeSchema,
		row: InheritedRow,
		index: number,
		ordered: InheritedRow[]
	): void {
		const rowEl = parent.createEl("div", { cls: "schema-field-row schema-inherited-row" });
		const details = rowEl.createEl("details");
		const summary = details.createEl("summary");
		const chevron = summary.createSpan({ cls: "schema-summary-chevron" });
		setIcon(chevron, "chevron-right");
		const text = summary.createSpan({ cls: "schema-row-text" });
		text.createEl("strong", { text: row.field.name });
		text.createEl("span", {
			cls: "schema-type-meta",
			text: ` (${row.field.type}) · inherited from ${row.sourceType}`,
		});
		buildRowActions(summary, [
			...moveActions(
				index > 0,
				index < ordered.length - 1,
				() => this.moveInherited(schema, ordered, index, -1),
				() => this.moveInherited(schema, ordered, index, 1)
			),
			{
				icon: "external-link",
				label: `Open parent ("${row.sourceType}")`,
				handler: () => this.options?.onOpenParent(row.sourceType),
			},
		]);

		const body = details.createEl("div", { cls: "schema-field-body" });
		body.createDiv({
			cls: "setting-item-description",
			text: `Defined on \`${row.sourceType}\`. To change its data type or options, open that object type.`,
		});
		new Setting(body)
			.setName("Name")
			.setDesc("Read-only here.")
			.addText((t) => {
				t.setValue(row.field.name);
				t.inputEl.disabled = true;
			});
		new Setting(body)
			.setName("Data type")
			.setDesc("Read-only here.")
			.addText((t) => {
				t.setValue(row.field.type);
				t.inputEl.disabled = true;
			});
	}

	private moveInherited(
		schema: TypeSchema,
		ordered: InheritedRow[],
		index: number,
		delta: number
	): void {
		const target = index + delta;
		if (target < 0 || target >= ordered.length) return;
		const names = ordered.map((r) => r.field.name);
		const [moved] = names.splice(index, 1);
		names.splice(target, 0, moved);
		this.plugin.loader.update(schema.name, { inheritedOrder: names });
	}

	private renderRow(parent: HTMLElement, schema: TypeSchema, field: FieldSchema, index: number): void {
		const row = parent.createEl("div", { cls: "schema-field-row" });
		const details = row.createEl("details");
		const summary = details.createEl("summary");
		const chevron = summary.createSpan({ cls: "schema-summary-chevron" });
		setIcon(chevron, "chevron-right");
		const text = summary.createSpan({ cls: "schema-row-text" });
		text.createEl("strong", { text: field.name });
		text.createEl("span", {
			cls: "schema-type-meta",
			text: ` (${field.type})${field.promptOnCreate ? " · prompt" : ""}${field.target ? ` · → ${field.target}` : ""}`,
		});
		buildRowActions(summary, [
			...moveActions(
				index > 0,
				index < schema.fields.length - 1,
				() => this.moveField(index, -1),
				() => this.moveField(index, 1)
			),
			{ icon: "trash-2", label: "Delete", danger: true, handler: () => void this.removeField(index) },
		]);

		const body = details.createEl("div", { cls: "schema-field-body" });
		const globalExists = field.name in (this.plugin.settings.globalFields ?? {});

		// Property shape (name, data type, target, inverse, options) lives in the
		// global property library. This row shows it read-only and points the user
		// at Settings → Schema → Global properties for edits. Only
		// `promptOnCreate` is per-usage.
		body.createDiv({
			cls: "setting-item-description",
			text: "Name, data type, and options come from this property's entry under Settings → Schema → Global properties. Edit them there to change every object type that uses it. Only the \"ask on create\" label below is specific to this object type.",
		});

		new Setting(body)
			.setName("Name")
			.setDesc("Defined globally. Read-only here.")
			.addText((t) => {
				t.setValue(field.name);
				t.inputEl.disabled = true;
			});

		new Setting(body)
			.setName("Data type")
			.setDesc("Defined globally. Read-only here.")
			.addText((t) => {
				t.setValue(field.type);
				t.inputEl.disabled = true;
			});

		if (field.target) {
			new Setting(body)
				.setName("Links to notes of object type")
				.setDesc("Defined globally. Read-only here.")
				.addText((t) => {
					t.setValue(field.target ?? "");
					t.inputEl.disabled = true;
				});
		}

		if (field.type === "Formula") {
			const opts = (field.options ?? {}) as Record<string, unknown>;
			const expr = typeof opts.expression === "string" ? opts.expression : "";
			new Setting(body)
				.setName("Expression")
				.setDesc("Defined globally. Read-only here.")
				.addTextArea((t) => {
					t.setValue(expr);
					t.inputEl.rows = 2;
					t.inputEl.style.fontFamily = "var(--font-monospace)";
					t.inputEl.disabled = true;
				});
			const previewEl = body.createDiv({ cls: "schema-formula-preview" });
			previewEl.hide();
			new Setting(body)
				.setName("Try it on the open note")
				.setDesc("Runs this formula against the currently open note's properties and shows the result.")
				.addButton((btn) => {
					btn.setButtonText("Run").onClick(() => this.previewFormula(expr, previewEl));
				});
		}

		new Setting(body)
			.setName("Ask for this on create (label)")
			.setDesc(
				"If filled in, you'll be prompted for this value when a new note of this object type is created, using this text as the label. Leave blank to skip the prompt."
			)
			.addText((t) => {
				t.setValue(field.promptOnCreate ?? "")
					.setPlaceholder("e.g. First name")
					.onChange((v) => {
						this.queueFieldUpdate(field.name, { promptOnCreate: v.trim() || undefined });
					});
			});

		if (!globalExists) {
			body.createDiv({
				cls: "schema-inline-warning visible",
				text: `No property named "${field.name}" in Global properties. Add one there, or remove this row.`,
			});
		}
	}

	private async addField(): Promise<void> {
		const schema = this.plugin.loader.get(this.typeName);
		if (!schema) return;
		const result = await promptForNewField(
			this.plugin.app,
			schema.fields.map((f) => f.name),
			this.plugin.settings.globalFields
		);
		if (!result) return;

		// Every property is global. If a global with this name doesn't exist yet,
		// create one from the modal's inputs; otherwise reuse what's there.
		const globals = this.plugin.settings.globalFields;
		if (!(result.field.name in globals)) {
			const { promptOnCreate: _, ...rest } = result.field;
			globals[result.field.name] = { ...rest };
		}
		const usage: FieldSchema = {
			name: result.field.name,
			type: globals[result.field.name].type,
		};
		if (result.field.promptOnCreate) usage.promptOnCreate = result.field.promptOnCreate;
		const nextSchemas = this.plugin.loader.getAll().map((s) =>
			s.name === this.typeName ? { ...s, fields: [...s.fields, usage] } : s
		);
		this.plugin.loader.updateAll({ schemas: nextSchemas, globalFields: globals });
	}

	private async removeField(index: number): Promise<void> {
		const schema = this.plugin.loader.get(this.typeName);
		if (!schema) return;
		const field = schema.fields[index];
		if (!field) return;

		const affectedTypes = new Set(
			typesLosingFieldOnRemoval(this.plugin.loader.rawMap(), this.typeName, field.name)
		);
		const affectedFiles: TFile[] = [];
		if (affectedTypes.size > 0) {
			const typeKey = this.plugin.settings.typeKey;
			for (const file of this.plugin.app.vault.getMarkdownFiles()) {
				const cache = this.plugin.app.metadataCache.getFileCache(file);
				const fm = cache?.frontmatter as Record<string, unknown> | undefined;
				if (!fm) continue;
				const t = fm[typeKey];
				if (typeof t !== "string" || !affectedTypes.has(t)) continue;
				if (!(field.name in fm)) continue;
				affectedFiles.push(file);
			}
		}

		const choice = await openRemovePropertyModal(this.plugin.app, {
			propertyName: field.name,
			objectTypeName: this.typeName,
			affectedCount: affectedFiles.length,
		});
		if (choice === "cancel") return;

		const fields = schema.fields.filter((_, i) => i !== index);
		this.plugin.loader.update(this.typeName, { fields });

		if (choice === "future-only" || affectedFiles.length === 0) return;

		let stripped = 0;
		for (const file of affectedFiles) {
			try {
				await this.plugin.app.fileManager.processFrontMatter(file, (fm) => {
					if (field.name in fm) {
						delete fm[field.name];
						stripped++;
					}
				});
			} catch (err) {
				console.error(`[schema] failed to remove "${field.name}" from ${file.path}:`, err);
			}
		}
		new Notice(`Removed "${field.name}" from ${stripped} note${stripped === 1 ? "" : "s"}.`);
	}

	private moveField(index: number, delta: number): void {
		const schema = this.plugin.loader.get(this.typeName);
		if (!schema) return;
		const target = index + delta;
		if (target < 0 || target >= schema.fields.length) return;
		const fields = [...schema.fields];
		const [moved] = fields.splice(index, 1);
		fields.splice(target, 0, moved);
		this.plugin.loader.update(this.typeName, { fields });
	}

	// Pending edits are keyed by field NAME (not list index) so a debounced edit
	// still lands on the right field if the list was reordered/re-rendered before
	// the timer fired.
	private queueFieldUpdate(name: string, partial: Partial<FieldSchema>): void {
		const cur = this.pending.get(name) ?? {};
		this.pending.set(name, { ...cur, ...partial });
		if (this.debounceTimer != null) window.clearTimeout(this.debounceTimer);
		this.debounceTimer = window.setTimeout(() => {
			this.debounceTimer = null;
			const schema = this.plugin.loader.get(this.typeName);
			if (!schema) return;
			const updates = this.pending;
			this.pending = new Map();
			const fields = schema.fields.map((f) =>
				updates.has(f.name) ? { ...f, ...updates.get(f.name)! } : f
			);
			this.plugin.loader.update(this.typeName, { fields });
		}, 400);
	}

	private previewFormula(expression: string, el: HTMLElement): void {
		el.empty();
		el.show();
		if (!expression.trim()) {
			el.createDiv({
				cls: "schema-formula-preview-error",
				text: "Empty expression.",
			});
			return;
		}
		const file = this.plugin.app.workspace.getActiveFile();
		if (!file) {
			el.createDiv({
				cls: "schema-formula-preview-error",
				text: "No active file. Open a note of this object type and try again.",
			});
			return;
		}
		const result = evaluateFormula(this.plugin.app, file, expression);
		if (result.startsWith("!err: ")) {
			el.createDiv({
				cls: "schema-formula-preview-error",
				text: result.slice(6),
			});
			return;
		}
		el.createDiv({
			cls: "schema-formula-preview-status",
			text: `against ${file.basename}`,
		});
		el.createDiv({
			cls: "schema-formula-preview-result",
			text: result === "" ? "(empty)" : result,
		});
	}
}
