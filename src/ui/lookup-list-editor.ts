import { Notice, Setting, setIcon } from "obsidian";
import type SchemaPlugin from "../main";
import type { LookupSchema } from "../schema/types";
import { buildRowActions } from "./field-list-editor";
import { promptForString } from "./prompt-modal";

/**
 * Renders the `Lookups` section for a single TypeSchema. One row per lookup
 * with inline-expand editor: name, query (textarea), render mode, output mode,
 * autoUpdate toggle (only shown when render=frontmatter).
 */
export class LookupListEditor {
	private readonly plugin: SchemaPlugin;
	private readonly typeName: string;
	private debounceTimer: number | null = null;
	/** Per-lookup-index accumulated edits. Same fix as FieldListEditor. */
	private pending = new Map<number, Partial<LookupSchema>>();

	constructor(plugin: SchemaPlugin, typeName: string) {
		this.plugin = plugin;
		this.typeName = typeName;
	}

	render(parent: HTMLElement): void {
		const schema = this.plugin.loader.get(this.typeName);
		if (!schema) return;

		new Setting(parent).addButton((btn) => {
			btn.setButtonText("+ Add lookup")
				.setCta()
				.onClick(() => void this.addLookup());
		});

		if (schema.lookups.length === 0) {
			parent.createEl("div", { cls: "schema-empty", text: "(no lookups)" });
			return;
		}

		const list = parent.createEl("div", { cls: "schema-lookups-list" });
		schema.lookups.forEach((lookup, index) => this.renderRow(list, lookup, index));
	}

	private renderRow(parent: HTMLElement, lookup: LookupSchema, index: number): void {
		const schema = this.plugin.loader.get(this.typeName);
		const total = schema?.lookups.length ?? 0;
		const row = parent.createEl("div", { cls: "schema-lookup-row" });
		const details = row.createEl("details");
		const summary = details.createEl("summary");
		const chevron = summary.createSpan({ cls: "schema-summary-chevron" });
		setIcon(chevron, "chevron-right");
		const text = summary.createSpan({ cls: "schema-row-text" });
		text.createEl("strong", { text: lookup.name });
		text.createEl("span", {
			cls: "schema-type-meta",
			text: ` ${lookup.render}/${lookup.output}${lookup.render === "frontmatter" && lookup.autoUpdate === false ? " (manual)" : ""}`,
		});
		buildRowActions(
			summary,
			index > 0,
			index < total - 1,
			() => this.move(index, -1),
			() => this.move(index, 1),
			() => this.remove(index)
		);

		const body = details.createEl("div", { cls: "schema-lookup-body" });

		new Setting(body).setName("Name").addText((t) => {
			t.setValue(lookup.name).onChange((v) => {
				this.queueUpdate(index, { name: v.trim() });
			});
		});

		new Setting(body)
			.setName("Query")
			.setDesc(
				"Dataview JS expression. `dv` and `current` are injected. Example: dv.pages('\"Moments\"').filter(...)"
			)
			.addTextArea((t) => {
				t.setValue(lookup.query).onChange((v) => {
					this.queueUpdate(index, { query: v });
				});
				t.inputEl.rows = 4;
				t.inputEl.style.fontFamily = "var(--font-monospace)";
				t.inputEl.style.fontSize = "12px";
				t.inputEl.style.width = "100%";
			});

		new Setting(body).setName("Render").addDropdown((d) => {
			d.addOption("frontmatter", "frontmatter (writes to YAML)");
			d.addOption("block", "block (live in note body via ```schema-lookup```)");
			d.setValue(lookup.render);
			d.onChange((v) => {
				this.queueUpdate(index, { render: v as LookupSchema["render"] });
			});
		});

		new Setting(body).setName("Output").addDropdown((d) => {
			d.addOption("list", "list (comma-separated)");
			d.addOption("bullet-list", "bullet list");
			d.addOption("count", "count");
			d.setValue(lookup.output);
			d.onChange((v) => {
				this.queueUpdate(index, { output: v as LookupSchema["output"] });
			});
		});

		if (lookup.render === "frontmatter") {
			new Setting(body)
				.setName("Auto-update")
				.setDesc("If off, lookup is only refreshed via the manual command.")
				.addToggle((toggle) => {
					toggle.setValue(lookup.autoUpdate !== false);
					toggle.onChange((v) => {
						this.queueUpdate(index, { autoUpdate: v });
					});
				});
		}
	}

	private async addLookup(): Promise<void> {
		const schema = this.plugin.loader.get(this.typeName);
		if (!schema) return;
		const name = await promptForString(this.plugin.app, "Add lookup", "Lookup name");
		if (!name) return;
		if (schema.lookups.some((l) => l.name === name)) {
			new Notice(`Schema: lookup "${name}" already exists.`);
			return;
		}
		const newLookup: LookupSchema = {
			name,
			query: `dv.pages('"Moments"').filter(m => true)`,
			render: "frontmatter",
			output: "list",
			autoUpdate: true,
		};
		const lookups = [...schema.lookups, newLookup];
		this.plugin.loader.update(this.typeName, { lookups });
	}

	private remove(index: number): void {
		const schema = this.plugin.loader.get(this.typeName);
		if (!schema) return;
		const lookups = schema.lookups.filter((_, i) => i !== index);
		this.plugin.loader.update(this.typeName, { lookups });
	}

	private move(index: number, delta: number): void {
		const schema = this.plugin.loader.get(this.typeName);
		if (!schema) return;
		const target = index + delta;
		if (target < 0 || target >= schema.lookups.length) return;
		const lookups = [...schema.lookups];
		const [moved] = lookups.splice(index, 1);
		lookups.splice(target, 0, moved);
		this.plugin.loader.update(this.typeName, { lookups });
	}

	private queueUpdate(index: number, partial: Partial<LookupSchema>): void {
		const cur = this.pending.get(index) ?? {};
		this.pending.set(index, { ...cur, ...partial });
		if (this.debounceTimer != null) window.clearTimeout(this.debounceTimer);
		this.debounceTimer = window.setTimeout(() => {
			this.debounceTimer = null;
			const schema = this.plugin.loader.get(this.typeName);
			if (!schema) return;
			const updates = this.pending;
			this.pending = new Map();
			const lookups = schema.lookups.map((l, i) =>
				updates.has(i) ? { ...l, ...updates.get(i)! } : l
			);
			this.plugin.loader.update(this.typeName, { lookups });
		}, 400);
	}
}
