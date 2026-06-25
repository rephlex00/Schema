import type SchemaPlugin from "../main";

/**
 * Hides global properties flagged `hidden` from the rendered properties widget
 * in Live Preview and Reading view. The value stays in the note's YAML, and
 * Source mode is left untouched - its `.markdown-source-view` lacks the
 * `.is-live-preview` class, so the scoped rules below never match it and the
 * raw frontmatter (hence the property) stays visible there.
 *
 * Properties are global by name, so hiding is keyed purely on the property key
 * via a single injected stylesheet - no per-view DOM walking like
 * TypeChipPropertyManager needs. The stylesheet is rebuilt whenever the schema
 * changes (which is also when a `hidden` flag is toggled in settings).
 */
export class HiddenPropertiesManager {
	private readonly plugin: SchemaPlugin;
	private styleEl: HTMLStyleElement | null = null;
	private schemaListener: (() => void) | null = null;

	constructor(plugin: SchemaPlugin) {
		this.plugin = plugin;
	}

	start(): void {
		this.styleEl = document.head.createEl("style", {
			attr: { "data-schema": "hidden-properties" },
		});
		this.schemaListener = () => this.refresh();
		this.plugin.loader.on("schema-changed", this.schemaListener);
		this.refresh();
	}

	stop(): void {
		if (this.schemaListener) this.plugin.loader.off("schema-changed", this.schemaListener);
		this.schemaListener = null;
		this.styleEl?.remove();
		this.styleEl = null;
	}

	refresh(): void {
		if (!this.styleEl) return;
		const globals = this.plugin.settings.globalFields ?? {};
		const rules = Object.values(globals)
			.filter((f) => f.hidden === true)
			.map((f) => this.ruleFor(f.name));
		this.styleEl.textContent = rules.join("\n");
	}

	private ruleFor(key: string): string {
		const k = cssEscapeAttr(key);
		return (
			`.markdown-source-view.is-live-preview .metadata-property[data-property-key="${k}"],\n` +
			`.markdown-reading-view .metadata-property[data-property-key="${k}"] { display: none; }`
		);
	}
}

/** Escape a value for use inside a double-quoted CSS attribute selector. */
function cssEscapeAttr(value: string): string {
	return value.replace(/(["\\])/g, "\\$1");
}
