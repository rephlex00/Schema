import { Notice, Setting } from "obsidian";
import type SchemaPlugin from "../main";
import type { AutoRefreshedField, AutoRefreshedFieldKind } from "../main";
import { promptForString } from "./prompt-modal";

const KIND_OPTIONS: AutoRefreshedFieldKind[] = ["text", "color", "icon"];

/**
 * Renders the global "Auto-refreshed frontmatter fields" editor: a list of
 * (name, kind) entries with add/remove/reorder. Edits commit immediately to
 * plugin settings.
 *
 * Renaming a field here does NOT migrate the value stored in each schema's
 * `defaults` map — those keys go stale. The user is responsible for renaming
 * the matching key in each type's Defaults section.
 */
export class AutoRefreshedFieldsEditor {
	private readonly plugin: SchemaPlugin;
	private readonly onChange: () => void;

	constructor(plugin: SchemaPlugin, onChange: () => void) {
		this.plugin = plugin;
		this.onChange = onChange;
	}

	render(parent: HTMLElement): void {
		const wrap = parent.createDiv({ cls: "schema-auto-refreshed-editor" });
		wrap.createEl("div", {
			cls: "setting-item-description",
			text: "Frontmatter keys that get reset to schema defaults whenever a note's type changes. Each entry has a kind that controls the per-type Defaults editor widget (text input, color picker, icon name).",
		});

		const list = wrap.createDiv({ cls: "schema-arf-list" });
		this.plugin.settings.autoRefreshedFields.forEach((entry, index) => {
			this.renderRow(list, entry, index);
		});

		new Setting(wrap).addButton((btn) => {
			btn.setButtonText("+ Add field")
				.setCta()
				.onClick(() => void this.addField());
		});
	}

	private renderRow(parent: HTMLElement, entry: AutoRefreshedField, index: number): void {
		const row = parent.createDiv({ cls: "schema-arf-row" });

		const nameInput = row.createEl("input", {
			type: "text",
			cls: "schema-arf-name",
			attr: { value: entry.name, placeholder: "key name" },
		});
		nameInput.addEventListener("change", () => {
			this.update(index, { name: nameInput.value.trim() });
		});

		const kindSelect = row.createEl("select", { cls: "schema-arf-kind" });
		for (const k of KIND_OPTIONS) {
			const opt = kindSelect.createEl("option", { text: k, attr: { value: k } });
			if (k === entry.kind) opt.selected = true;
		}
		kindSelect.addEventListener("change", () => {
			this.update(index, { kind: kindSelect.value as AutoRefreshedFieldKind });
		});

		const upBtn = row.createEl("button", { text: "↑", cls: "schema-arf-btn" });
		upBtn.disabled = index === 0;
		upBtn.addEventListener("click", () => this.move(index, -1));

		const downBtn = row.createEl("button", { text: "↓", cls: "schema-arf-btn" });
		downBtn.disabled = index === this.plugin.settings.autoRefreshedFields.length - 1;
		downBtn.addEventListener("click", () => this.move(index, 1));

		const delBtn = row.createEl("button", { text: "×", cls: "schema-arf-btn schema-arf-del" });
		delBtn.addEventListener("click", () => this.remove(index));
	}

	private async addField(): Promise<void> {
		const name = await promptForString(
			this.plugin.app,
			"Add auto-refreshed field",
			"Frontmatter key name"
		);
		if (!name) return;
		if (this.plugin.settings.autoRefreshedFields.some((f) => f.name === name)) {
			new Notice(`Schema: "${name}" is already in the auto-refreshed list.`);
			return;
		}
		this.plugin.settings.autoRefreshedFields.push({ name, kind: "text" });
		await this.commit();
	}

	private remove(index: number): void {
		this.plugin.settings.autoRefreshedFields.splice(index, 1);
		void this.commit();
	}

	private move(index: number, delta: number): void {
		const arr = this.plugin.settings.autoRefreshedFields;
		const target = index + delta;
		if (target < 0 || target >= arr.length) return;
		const [moved] = arr.splice(index, 1);
		arr.splice(target, 0, moved);
		void this.commit();
	}

	private update(index: number, partial: Partial<AutoRefreshedField>): void {
		const arr = this.plugin.settings.autoRefreshedFields;
		arr[index] = { ...arr[index], ...partial };
		void this.commit();
	}

	private async commit(): Promise<void> {
		await this.plugin.saveSettings();
		this.onChange();
	}
}
