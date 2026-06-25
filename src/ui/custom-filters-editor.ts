import { Notice, Setting, setIcon } from "obsidian";
import type SchemaPlugin from "../main";
import { registerCustomFilter } from "../util/liquid";
import { promptForString } from "./prompt-modal";

/**
 * Renders the "Custom Liquid filters" editor in the Global tab. Each row is a
 * (name, body) entry; the body is a JS expression that receives `value` and
 * returns the transformed string. Bodies are compiled live: a per-row status
 * indicator shows compile errors inline so the user can iterate without saving
 * broken filters into the runtime.
 *
 * SECURITY: bodies execute as JS at template-render time. They come from this
 * vault's data.json only - the import/export flow must NOT carry custom filters
 * from foreign schemas to keep the trust boundary at the user's own settings.
 */
export class CustomFiltersEditor {
	private readonly plugin: SchemaPlugin;
	private readonly onChange: () => void;

	constructor(plugin: SchemaPlugin, onChange: () => void) {
		this.plugin = plugin;
		this.onChange = onChange;
	}

	render(parent: HTMLElement): void {
		const wrap = parent.createDiv({ cls: "schema-custom-filters-editor" });
		wrap.createEl("div", {
			cls: "schema-inline-warning visible",
			text: "Heads up: these run as JavaScript inside Obsidian. Only paste code you understand or trust.",
		});

		const help = wrap.createEl("details", { cls: "schema-cf-help" });
		help.createEl("summary", { text: "How custom filters work" });
		const helpBody = help.createDiv({ cls: "schema-cf-help-body" });
		helpBody.createEl("p", {
			text: "Filters transform values inside folder and filename templates. Use them with the pipe syntax: {{ name | initials }}.",
		});
		helpBody.createEl("p", { text: "Example: an \"initials\" filter." });
		helpBody.createEl("pre", {
			cls: "schema-cf-help-example",
			text: "return value.split(' ').map(w => w[0]).join('').toUpperCase();\n// 'Ada Lovelace' becomes 'AL'",
		});
		helpBody.createEl("p", {
			text: "Each filter receives the value (a string) and returns the transformed string. The filter name is what you write after the pipe.",
		});

		const list = wrap.createDiv({ cls: "schema-cf-list" });
		const entries = Object.entries(this.plugin.settings.customFilters ?? {}).sort((a, b) =>
			a[0].localeCompare(b[0])
		);
		for (const [name, body] of entries) {
			this.renderRow(list, name, body);
		}

		new Setting(wrap).addButton((btn) => {
			btn.setButtonText("+ Add filter")
				.setCta()
				.onClick(() => void this.addFilter());
		});
	}

	private renderRow(parent: HTMLElement, name: string, body: string): void {
		const row = parent.createDiv({ cls: "schema-cf-row" });
		const ref = { current: name };

		const head = row.createDiv({ cls: "schema-cf-head" });
		const nameInput = head.createEl("input", {
			type: "text",
			cls: "schema-cf-name",
			attr: { value: name, placeholder: "filter name (used as {{ value | name }})" },
		});
		nameInput.addEventListener("change", () => {
			const newName = nameInput.value.trim();
			if (!newName) {
				new Notice("Schema: filter name cannot be empty.");
				nameInput.value = ref.current;
				return;
			}
			if (newName !== ref.current && newName in (this.plugin.settings.customFilters ?? {})) {
				new Notice(`Schema: filter "${newName}" already exists.`);
				nameInput.value = ref.current;
				return;
			}
			if (newName === ref.current) return;
			const map = this.plugin.settings.customFilters;
			const prevBody = map[ref.current];
			delete map[ref.current];
			map[newName] = prevBody;
			ref.current = newName;
			this.plugin.applyCustomFilters();
			void this.commit();
		});

		const delBtn = head.createEl("button", {
			cls: "schema-row-btn schema-row-btn-danger schema-arf-del",
			attr: { type: "button", "aria-label": "Delete filter", title: "Delete filter" },
		});
		setIcon(delBtn, "trash-2");
		delBtn.addEventListener("click", () => {
			delete this.plugin.settings.customFilters[ref.current];
			this.plugin.applyCustomFilters();
			void this.commit();
		});

		const bodyArea = row.createEl("textarea", {
			cls: "schema-cf-body",
			attr: { placeholder: "// receives `value`, returns the transformed string.\n// e.g. return value.split(' ').map(w => w[0]).join('').toUpperCase();" },
		});
		bodyArea.value = body;
		bodyArea.rows = 3;

		const status = row.createDiv({ cls: "schema-cf-status" });
		const updateStatus = (text: string) => {
			const result = registerCustomFilter(ref.current, text);
			if (result.ok) {
				status.setText("✓ valid JavaScript");
				status.removeClass("schema-cf-status-error");
				status.addClass("schema-cf-status-ok");
			} else {
				status.setText(`✗ ${result.error}`);
				status.removeClass("schema-cf-status-ok");
				status.addClass("schema-cf-status-error");
			}
		};
		updateStatus(body);

		bodyArea.addEventListener("input", () => updateStatus(bodyArea.value));
		bodyArea.addEventListener("change", () => {
			this.plugin.settings.customFilters[ref.current] = bodyArea.value;
			this.plugin.applyCustomFilters();
			void this.commit();
		});
	}

	private async addFilter(): Promise<void> {
		const name = await promptForString(this.plugin.app, "Add custom filter", "Filter name (used as {{ value | name }})");
		if (!name) return;
		if (name in (this.plugin.settings.customFilters ?? {})) {
			new Notice(`Schema: filter "${name}" already exists.`);
			return;
		}
		this.plugin.settings.customFilters[name] = "return value;";
		this.plugin.applyCustomFilters();
		await this.commit();
	}

	private async commit(): Promise<void> {
		await this.plugin.saveSettings();
		this.onChange();
	}
}
