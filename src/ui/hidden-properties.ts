import type SchemaPlugin from "../main";

/**
 * Hides global properties flagged `hidden` from the rendered properties widget
 * in Live Preview and Reading view. The value stays in the note's YAML, and
 * Source mode is left untouched - the static rules in `styles.css` are scoped to
 * `.is-live-preview` / `.markdown-reading-view`, so they never match Source.
 *
 * Properties are global by name, so hiding is keyed purely on the property key.
 * Rather than injecting a stylesheet (which Obsidian forbids), we toggle the
 * `schema-hidden-prop` class on each `.metadata-property` element whose key is
 * flagged, and let the static CSS do the hiding. A MutationObserver re-applies
 * the class as Obsidian (re)renders property widgets; the set of hidden keys is
 * recomputed whenever the schema changes (which is also when a `hidden` flag is
 * toggled in settings).
 */
const HIDDEN_CLASS = "schema-hidden-prop";

export class HiddenPropertiesManager {
	private readonly plugin: SchemaPlugin;
	private observer: MutationObserver | null = null;
	private schemaListener: (() => void) | null = null;
	private hiddenKeys = new Set<string>();

	constructor(plugin: SchemaPlugin) {
		this.plugin = plugin;
	}

	start(): void {
		this.recomputeKeys();
		this.schemaListener = () => this.refresh();
		this.plugin.loader.on("schema-changed", this.schemaListener);

		// Newly-rendered property widgets are added nodes; toggle the class on
		// them as they appear instead of maintaining a dynamic stylesheet.
		this.observer = new MutationObserver((mutations) => {
			for (const m of mutations) {
				m.addedNodes.forEach((node) => {
					if (node.nodeType !== 1) return;
					const el = node as HTMLElement;
					if (el.matches?.(".metadata-property")) this.applyTo(el);
					el.querySelectorAll?.(".metadata-property").forEach((p) =>
						this.applyTo(p as HTMLElement)
					);
				});
			}
		});
		this.observer.observe(activeDocument.body, { childList: true, subtree: true });
		this.applyAll();
	}

	stop(): void {
		if (this.schemaListener) this.plugin.loader.off("schema-changed", this.schemaListener);
		this.schemaListener = null;
		this.observer?.disconnect();
		this.observer = null;
		// Drop any classes we added so disabling the plugin reveals the properties.
		activeDocument
			.querySelectorAll(`.metadata-property.${HIDDEN_CLASS}`)
			.forEach((el) => (el as HTMLElement).removeClass(HIDDEN_CLASS));
	}

	refresh(): void {
		this.recomputeKeys();
		this.applyAll();
	}

	/** Rebuild the set of property keys that should be hidden. */
	private recomputeKeys(): void {
		const globals = this.plugin.settings.globalFields ?? {};
		this.hiddenKeys = new Set(
			Object.values(globals)
				.filter((f) => f.hidden === true)
				.map((f) => f.name)
		);
	}

	/** Re-apply the hidden class across every currently-rendered property. */
	private applyAll(): void {
		activeDocument
			.querySelectorAll(".metadata-property")
			.forEach((el) => this.applyTo(el as HTMLElement));
	}

	private applyTo(el: HTMLElement): void {
		const key = el.getAttribute("data-property-key") ?? "";
		el.toggleClass(HIDDEN_CLASS, this.hiddenKeys.has(key));
	}
}
