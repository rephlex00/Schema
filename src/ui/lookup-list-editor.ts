import { Notice, Setting, setIcon } from "obsidian";
import type SchemaPlugin from "../main";
import type { LookupSchema } from "../schema/types";
import { buildRowActions, moveActions } from "./field-list-editor";
import { promptForString } from "./prompt-modal";
import { QueryPlaygroundModal } from "./query-playground";

/**
 * Renders the "Custom lookups" editor for a single TypeSchema. One row per
 * lookup with an inline-expand editor: name, query, render mode, output mode,
 * autoUpdate toggle (only shown when render=frontmatter).
 *
 * Backlinks (lookups auto-synthesized from a global property's `inverse:`)
 * are rendered separately by `renderBacklinksCards`. This editor only owns
 * hand-written lookups.
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

		new Setting(parent)
			.addButton((btn) => {
				btn.setButtonText("+ Add custom lookup")
					.setCta()
					.onClick(() => void this.addLookup());
			})
			.addButton((btn) => {
				btn.setButtonText("Open query playground")
					.setTooltip(
						"Prototype a Dataview query against the open note, then paste it into a custom lookup."
					)
					.onClick(() => new QueryPlaygroundModal(this.plugin).open());
			});

		if (schema.lookups.length === 0) {
			parent.createEl("div", { cls: "schema-empty", text: "No custom lookups yet." });
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
			text: ` ${whereThisLands(lookup)}`,
		});
		buildRowActions(summary, [
			...moveActions(
				index > 0,
				index < total - 1,
				() => this.move(index, -1),
				() => this.move(index, 1)
			),
			{ icon: "trash-2", label: "Delete", danger: true, handler: () => this.remove(index) },
		]);

		const body = details.createEl("div", { cls: "schema-lookup-body" });

		const landingHint = body.createDiv({ cls: "schema-lookup-landing" });
		landingHint.setText(whereThisLands(lookup));

		new Setting(body)
			.setName("Name")
			.setDesc(
				"Becomes the property name (if writing to YAML) or the code-block label (if rendering in the body)."
			)
			.addText((t) => {
				t.setValue(lookup.name).onChange((v) => {
					this.queueUpdate(index, { name: v.trim() });
				});
			});

		new Setting(body)
			.setName("Query")
			.setDesc(
				"A Dataview JS query. `dv` is the Dataview API, `current` is the note this lookup runs on. Example: dv.pages('\"Moments\"').filter(m => m.people?.includes(current.file.link))"
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

		new Setting(body)
			.setName("Where the result goes")
			.setDesc(
				`"Property" writes the result into the note's YAML so it shows up in the Properties panel. "In the note body" renders it live via a \`\`\`schema-lookup\`\`\` code block you add to the note.`
			)
			.addDropdown((d) => {
				d.addOption("frontmatter", "Property (written to YAML)");
				d.addOption("block", "In the note body (rendered live)");
				d.setValue(lookup.render);
				d.onChange((v) => {
					this.queueUpdate(index, { render: v as LookupSchema["render"] });
					landingHint.setText(
						whereThisLands({ ...lookup, render: v as LookupSchema["render"] })
					);
				});
			});

		new Setting(body)
			.setName("How to display it")
			.setDesc(
				'"List" is comma-separated, "Bulleted list" stacks them vertically, "Count" stores just the number of results.'
			)
			.addDropdown((d) => {
				d.addOption("list", "List (comma-separated)");
				d.addOption("bullet-list", "Bulleted list");
				d.addOption("count", "Count only");
				d.setValue(lookup.output);
				d.onChange((v) => {
					this.queueUpdate(index, { output: v as LookupSchema["output"] });
					landingHint.setText(
						whereThisLands({ ...lookup, output: v as LookupSchema["output"] })
					);
				});
			});

		if (lookup.render === "frontmatter") {
			new Setting(body)
				.setName("Refresh automatically")
				.setDesc(
					'When on, the property re-runs whenever the vault changes. When off, you have to refresh it manually with the "Refresh frontmatter lookups (vault-wide)" command.'
				)
				.addToggle((toggle) => {
					toggle.setValue(lookup.autoUpdate !== false);
					toggle.onChange((v) => {
						this.queueUpdate(index, { autoUpdate: v });
					});
				});
		}

		const previewWrap = body.createDiv({ cls: "schema-lookup-preview-wrap" });
		const previewEl = previewWrap.createDiv({ cls: "schema-lookup-preview" });
		previewEl.hide();
		new Setting(previewWrap)
			.setName("Test on the open note")
			.setDesc(
				"Runs this query against whichever note you have open right now and shows the first five results."
			)
			.addButton((btn) => {
				btn.setButtonText("Run").onClick(
					() => void this.runPreview(this.currentLookup(index) ?? lookup, previewEl)
				);
			});
	}

	/** Latest persisted version of the lookup at `index`. Reads from the loader
	 *  instead of capturing the closed-over `lookup` so debounced edits made
	 *  before clicking Preview are included. */
	private currentLookup(index: number): LookupSchema | null {
		const schema = this.plugin.loader.get(this.typeName);
		return schema?.lookups[index] ?? null;
	}

	private async runPreview(lookup: LookupSchema, el: HTMLElement): Promise<void> {
		el.empty();
		el.show();
		const file = this.plugin.app.workspace.getActiveFile();
		if (!file) {
			el.createDiv({
				cls: "schema-lookup-preview-error",
				text: "Open any note first. The query uses `current` to refer to the open file.",
			});
			return;
		}
		el.createDiv({
			cls: "schema-lookup-preview-status",
			text: `Running against ${file.basename}…`,
		});
		try {
			const t0 = performance.now();
			const result = await this.plugin.lookups.run(lookup.query, file);
			const ms = Math.round(performance.now() - t0);
			el.empty();
			el.createDiv({
				cls: "schema-lookup-preview-status",
				text: `${result.files.length} result${result.files.length === 1 ? "" : "s"} in ${ms}ms (against ${file.basename})`,
			});
			if (result.files.length === 0) return;
			const list = el.createEl("ul", { cls: "schema-lookup-preview-list" });
			for (const f of result.files.slice(0, 5)) {
				const li = list.createEl("li");
				const a = li.createEl("a", { text: f.basename, href: "#" });
				a.addEventListener("click", (e) => {
					e.preventDefault();
					void this.plugin.app.workspace.openLinkText(f.path, "", false);
				});
			}
			if (result.files.length > 5) {
				el.createDiv({
					cls: "schema-lookup-preview-more",
					text: `… and ${result.files.length - 5} more`,
				});
			}
		} catch (err) {
			el.empty();
			el.createDiv({
				cls: "schema-lookup-preview-error",
				text: `Error: ${err instanceof Error ? err.message : String(err)}`,
			});
		}
	}

	private async addLookup(): Promise<void> {
		const schema = this.plugin.loader.get(this.typeName);
		if (!schema) return;
		const name = await promptForString(this.plugin.app, "Add custom lookup", "Lookup name");
		if (!name) return;
		if (schema.lookups.some((l) => l.name === name)) {
			new Notice(`Schema: custom lookup "${name}" already exists.`);
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

/** One-line plain-English description of where the result will appear in
 *  the note. Mirrors the four-knob picker into a single sentence so the user
 *  can see the destination at a glance. */
function whereThisLands(lookup: Pick<LookupSchema, "name" | "render" | "output">): string {
	const name = lookup.name || "(unnamed)";
	if (lookup.render === "frontmatter") {
		if (lookup.output === "count") {
			return `Writes a number to the note's \`${name}\` property.`;
		}
		if (lookup.output === "bullet-list") {
			return `Writes a wikilink list to the note's \`${name}\` property.`;
		}
		return `Writes a comma-separated wikilink list to the note's \`${name}\` property.`;
	}
	const shape =
		lookup.output === "count"
			? "the count"
			: lookup.output === "bullet-list"
			? "a bulleted list"
			: "a list";
	return `Renders ${shape} when you add \`\`\`schema-lookup ${name}\`\`\` to the note body.`;
}
