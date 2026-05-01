import { Notice, Setting } from "obsidian";
import type SchemaPlugin from "../main";
import { ALL_FIELD_TYPES, type FieldSchema, type FieldType, type TypeSchema } from "../schema/types";
import { promptForString } from "./prompt-modal";

/**
 * Renders the `Fields` section for a single TypeSchema. Each field is a row
 * with an expandable inline editor. Add/remove + up/down reorder buttons.
 *
 * All edits are debounced through queueCommit, which calls
 * `loader.update(typeName, { fields })` to persist.
 */
export class FieldListEditor {
	private readonly plugin: SchemaPlugin;
	private readonly typeName: string;
	private debounceTimer: number | null = null;
	/** Per-field-index accumulated edits. A single timer flushes all of them
	 *  together so editing field A then field B within 400ms doesn't lose A. */
	private pending = new Map<number, Partial<FieldSchema>>();

	constructor(plugin: SchemaPlugin, typeName: string) {
		this.plugin = plugin;
		this.typeName = typeName;
	}

	render(parent: HTMLElement): void {
		const schema = this.plugin.loader.get(this.typeName);
		if (!schema) return;

		new Setting(parent).addButton((btn) => {
			btn.setButtonText("+ Add field")
				.setCta()
				.onClick(() => void this.addField());
		});

		if (schema.fields.length === 0) {
			parent.createEl("div", { cls: "schema-empty", text: "(no fields)" });
			return;
		}

		const list = parent.createEl("div", { cls: "schema-fields-list" });
		schema.fields.forEach((field, index) => {
			this.renderRow(list, schema, field, index);
		});
	}

	private renderRow(parent: HTMLElement, schema: TypeSchema, field: FieldSchema, index: number): void {
		const row = parent.createEl("div", { cls: "schema-field-row" });
		const details = row.createEl("details");
		const summary = details.createEl("summary");
		summary.createEl("strong", { text: field.name });
		summary.createEl("span", {
			cls: "schema-type-meta",
			text: ` (${field.type})${field.promptOnCreate ? " · prompt" : ""}${field.target ? ` · → ${field.target}` : ""}`,
		});

		const body = details.createEl("div", { cls: "schema-field-body" });

		new Setting(body).setName("Name").addText((t) => {
			t.setValue(field.name).onChange((v) => {
				this.queueFieldUpdate(index, { name: v.trim() });
			});
		});

		new Setting(body).setName("Type").addDropdown((d) => {
			for (const ft of ALL_FIELD_TYPES) d.addOption(ft, ft);
			d.setValue(field.type);
			d.onChange((v) => {
				this.queueFieldUpdate(index, { type: v as FieldType });
				// Type change reveals/hides options — re-render after commit
				window.setTimeout(() => details.parentElement?.parentElement && this.refresh(parent.parentElement), 450);
			});
		});

		new Setting(body)
			.setName("Prompt on create")
			.setDesc("If set, prompt user for this value when creating a new note of this type.")
			.addText((t) => {
				t.setValue(field.promptOnCreate ?? "")
					.setPlaceholder("e.g. First name")
					.onChange((v) => {
						this.queueFieldUpdate(index, { promptOnCreate: v.trim() || undefined });
					});
			});

		this.renderTypeSpecificOptions(body, field, index);

		const actions = body.createEl("div", { cls: "schema-field-actions" });
		new Setting(actions)
			.addButton((btn) => {
				btn.setButtonText("↑").setDisabled(index === 0).onClick(() => this.moveField(index, -1));
			})
			.addButton((btn) => {
				btn.setButtonText("↓").setDisabled(index === schema.fields.length - 1).onClick(() =>
					this.moveField(index, 1)
				);
			})
			.addButton((btn) => {
				btn.setButtonText("Delete")
					.setWarning()
					.onClick(() => this.removeField(index));
			});
	}

	private renderTypeSpecificOptions(
		parent: HTMLElement,
		field: FieldSchema,
		index: number
	): void {
		switch (field.type) {
			case "File":
			case "MultiFile": {
				new Setting(parent)
					.setName("Target type")
					.setDesc("Constrain the picker to instances of this type. Optional.")
					.addDropdown((d) => {
						d.addOption("", "(any)");
						for (const s of this.plugin.loader.getAll()) {
							if (s.name === this.typeName) continue;
							d.addOption(s.name, s.name);
						}
						d.setValue(field.target ?? "");
						d.onChange((v) => {
							this.queueFieldUpdate(index, { target: v || undefined });
						});
					});
				return;
			}
			case "Formula": {
				const opts = (field.options ?? {}) as Record<string, unknown>;
				new Setting(parent)
					.setName("Expression")
					.setDesc(
						"JS expression evaluated on read. Free vars: `fm` (frontmatter), `file` ({path,name})."
					)
					.addTextArea((t) => {
						t.setValue(typeof opts.expression === "string" ? opts.expression : "")
							.setPlaceholder("fm.firstname + ' ' + fm.lastname")
							.onChange((v) => {
								const next = { ...opts, expression: v };
								this.queueFieldUpdate(index, { options: next });
							});
						t.inputEl.rows = 2;
						t.inputEl.style.fontFamily = "var(--font-monospace)";
					});
				return;
			}
			case "Select":
			case "Cycle": {
				const opts = (field.options ?? {}) as Record<string, unknown>;
				new Setting(parent)
					.setName("Values from note path")
					.setDesc("Path to a markdown file whose lines are the choices.")
					.addText((t) => {
						t.setValue(typeof opts.valuesListNotePath === "string" ? opts.valuesListNotePath : "")
							.setPlaceholder("e.g. Templates/Definitions/relationships.md")
							.onChange((v) => {
								const next = { ...opts };
								if (v.trim() === "") delete next.valuesListNotePath;
								else next.valuesListNotePath = v.trim();
								this.queueFieldUpdate(index, { options: next });
							});
					});
				new Setting(parent)
					.setName("Inline values")
					.setDesc("One value per line. Used when no `Values from note path` is set.")
					.addTextArea((t) => {
						const values = opts.valuesList as Record<string, string> | undefined;
						const lines = values ? Object.values(values).join("\n") : "";
						t.setValue(lines).onChange((v) => {
							const items = v.split("\n").map((s) => s.trim()).filter(Boolean);
							const valuesList: Record<string, string> = {};
							items.forEach((val, i) => (valuesList[String(i)] = val));
							const next = { ...opts, valuesList };
							this.queueFieldUpdate(index, { options: next });
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
		const schema = this.plugin.loader.get(this.typeName);
		if (!schema) return;
		const name = await promptForString(this.plugin.app, "Add field", "Field name");
		if (!name) return;
		if (schema.fields.some((f) => f.name === name)) {
			new Notice(`Schema: field "${name}" already exists.`);
			return;
		}
		const newField: FieldSchema = { name, type: "Input" };
		const fields = [...schema.fields, newField];
		this.plugin.loader.update(this.typeName, { fields });
	}

	private removeField(index: number): void {
		const schema = this.plugin.loader.get(this.typeName);
		if (!schema) return;
		const fields = schema.fields.filter((_, i) => i !== index);
		this.plugin.loader.update(this.typeName, { fields });
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

	private queueFieldUpdate(index: number, partial: Partial<FieldSchema>): void {
		const cur = this.pending.get(index) ?? {};
		this.pending.set(index, { ...cur, ...partial });
		if (this.debounceTimer != null) window.clearTimeout(this.debounceTimer);
		this.debounceTimer = window.setTimeout(() => {
			this.debounceTimer = null;
			const schema = this.plugin.loader.get(this.typeName);
			if (!schema) return;
			const updates = this.pending;
			this.pending = new Map();
			const fields = schema.fields.map((f, i) =>
				updates.has(i) ? { ...f, ...updates.get(i)! } : f
			);
			this.plugin.loader.update(this.typeName, { fields });
		}, 400);
	}

	/** Hook for the parent type editor to ask for a re-render after a schema-changed event. */
	private refresh(_parent: HTMLElement | null): void {
		// no-op: the SchemaSettingsTab listens to schema-changed and calls display() itself.
	}
}
