import { SuggestModal, TFile, setIcon } from "obsidian";
import type SchemaPlugin from "../main";
import type { TypeSchema } from "../schema/types";

/**
 * Lets the user switch a typed note's `type:` to a different defined type.
 * Selection writes the new value to frontmatter; the TypeChangeWatcher handles
 * the reshelve + clean + body-template pipeline from there.
 *
 * Opened from the type banner or the type chip in the properties pane.
 */
export class TypeSwitcherModal extends SuggestModal<TypeSchema> {
	private readonly plugin: SchemaPlugin;
	private readonly file: TFile;
	private readonly currentType: string;

	constructor(plugin: SchemaPlugin, file: TFile, currentType: string) {
		super(plugin.app);
		this.plugin = plugin;
		this.file = file;
		this.currentType = currentType;
		this.setPlaceholder(`Switch type (currently "${currentType}") to…`);
	}

	getSuggestions(query: string): TypeSchema[] {
		const q = query.trim().toLowerCase();
		return this.plugin.loader
			.getAll()
			.filter((s) => s.name !== this.currentType)
			.filter((s) => {
				if (q.length === 0) return true;
				const hay = `${s.name} ${s.extends ?? ""} ${s.folder ?? ""}`.toLowerCase();
				return hay.includes(q);
			})
			.sort((a, b) => a.name.localeCompare(b.name));
	}

	renderSuggestion(schema: TypeSchema, el: HTMLElement): void {
		el.empty();
		el.addClass("schema-switcher-row");
		const resolved = this.plugin.loader.getResolved(schema.name) ?? schema;
		const color = typeof resolved.defaults?.color === "string" ? resolved.defaults.color : "";
		const icon = typeof resolved.defaults?.icon === "string" ? resolved.defaults.icon : "";
		if (color) el.style.setProperty("--type-color", color);

		const chip = el.createSpan({ cls: "schema-switcher-chip" });
		if (icon) {
			const iconEl = chip.createSpan({ cls: "schema-switcher-icon" });
			setIcon(iconEl, icon);
		}
		chip.createSpan({ cls: "schema-switcher-name", text: schema.name });

		const meta: string[] = [];
		if (schema.extends) meta.push(`extends ${schema.extends}`);
		if (schema.folder) meta.push(schema.folder);
		else meta.push("(abstract)");
		el.createSpan({ cls: "schema-switcher-meta", text: meta.join(" · ") });
	}

	onChooseSuggestion(schema: TypeSchema): void {
		// Write the new type to frontmatter. TypeChangeWatcher (subscribed to
		// metadataCache.on("changed")) will pick this up and run the full
		// reshelve + clean + body-template pipeline.
		const typeKey = this.plugin.settings.typeKey;
		void this.plugin.app.fileManager.processFrontMatter(this.file, (fm: Record<string, unknown>) => {
			fm[typeKey] = schema.name;
		});
	}
}
