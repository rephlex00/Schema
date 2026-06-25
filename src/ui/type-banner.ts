import { MarkdownView, TFile, setIcon, type EventRef, type WorkspaceLeaf } from "obsidian";
import type SchemaPlugin from "../main";
import { readTypeKey } from "../util/frontmatter";
import { getTabHeaderEl } from "./leaf";
import { TypeSwitcherModal } from "./type-switcher-modal";

const BANNER_CLASS = "schema-type-banner";
/** Marks the file tab and view header as carrying the object-type tint. */
const CHROME_CLASS = "schema-chrome-tinted";

/**
 * Renders a subtle horizontal banner at the top of typed-note views showing
 * the type's icon and its ancestry breadcrumb (parent types › current type),
 * with a right-aligned "Schema" label. Inserted as the first child of the
 * `view-content` element, above the editor's scroll area.
 *
 * Updated on:
 * - active-leaf-change (banner moves to the new active view)
 * - metadataCache.changed (banner refreshes when type/icon/color edits land)
 * - schema-changed (banner refreshes when defaults change)
 *
 * The banner is purely decorative - no events bound to it.
 */
export class TypeBannerManager {
	private readonly plugin: SchemaPlugin;
	private leafRef: EventRef | null = null;
	private metaRef: EventRef | null = null;
	private schemaListener: (() => void) | null = null;

	constructor(plugin: SchemaPlugin) {
		this.plugin = plugin;
	}

	start(): void {
		this.leafRef = this.plugin.app.workspace.on("active-leaf-change", (leaf) => {
			this.refreshLeaf(leaf);
		});
		this.metaRef = this.plugin.app.metadataCache.on("changed", (file) => {
			const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
			if (view?.file?.path === file.path) this.refreshView(view);
		});
		this.schemaListener = () => this.refreshAllLeaves();
		this.plugin.loader.on("schema-changed", this.schemaListener);

		this.refreshAllLeaves();
	}

	stop(): void {
		if (this.leafRef) this.plugin.app.workspace.offref(this.leafRef);
		if (this.metaRef) this.plugin.app.metadataCache.offref(this.metaRef);
		if (this.schemaListener) this.plugin.loader.off("schema-changed", this.schemaListener);
		this.leafRef = null;
		this.metaRef = null;
		this.schemaListener = null;
		this.removeAllBanners();
	}

	/** Re-apply banners and chrome tint across all open leaves. Public so the
	 *  settings toggle can refresh immediately. No-ops when the banner is off
	 *  (the manager isn't running, and the tint has nothing to match). */
	refresh(): void {
		if (!this.plugin.settings.showTypeBanner) return;
		this.refreshAllLeaves();
	}

	private refreshAllLeaves(): void {
		this.plugin.app.workspace.iterateAllLeaves((leaf) => {
			this.refreshLeaf(leaf);
		});
	}

	private refreshLeaf(leaf: WorkspaceLeaf | null): void {
		if (!leaf) return;
		const view = leaf.view;
		if (view instanceof MarkdownView) this.refreshView(view);
	}

	private refreshView(view: MarkdownView): void {
		const file = view.file;
		const container = view.contentEl;
		if (!container) return;

		const existing = container.querySelector(`.${BANNER_CLASS}`);

		const cache = file ? this.plugin.app.metadataCache.getFileCache(file) : null;
		const typeName = readTypeKey(
			cache?.frontmatter as Record<string, unknown> | undefined,
			this.plugin.settings.typeKey
		);
		const schema = typeName ? this.plugin.loader.getResolved(typeName) : undefined;
		if (!file || !typeName || !schema) {
			existing?.remove();
			this.clearChromeTint(view);
			return;
		}

		const color = typeof schema.defaults?.color === "string" ? schema.defaults.color : "";
		const icon = typeof schema.defaults?.icon === "string" ? schema.defaults.icon : "";

		const banner = (existing as HTMLElement | null) ?? this.createBanner(container);
		banner.dataset.filePath = file.path;
		banner.dataset.typeName = typeName;

		if (color) banner.style.setProperty("--type-color", color);
		else banner.style.removeProperty("--type-color");

		const iconEl = banner.querySelector(`.${BANNER_CLASS}-icon`) as HTMLElement | null;
		const nameEl = banner.querySelector(`.${BANNER_CLASS}-name`) as HTMLElement | null;

		if (iconEl) {
			iconEl.empty();
			if (icon) setIcon(iconEl, icon);
		}
		if (nameEl) this.renderBreadcrumb(nameEl, typeName);

		if (this.plugin.settings.tintTabAndHeader) this.applyChromeTint(view, color);
		else this.clearChromeTint(view);
	}

	/** The two chrome regions above the banner: the file tab in the tab bar and
	 *  the view header. */
	private chromeElements(view: MarkdownView): HTMLElement[] {
		const els: HTMLElement[] = [];
		const tabHeaderEl = getTabHeaderEl(view.leaf);
		if (tabHeaderEl) els.push(tabHeaderEl);
		const header = view.containerEl?.querySelector(".view-header");
		if (header instanceof HTMLElement) els.push(header);
		return els;
	}

	private applyChromeTint(view: MarkdownView, color: string): void {
		for (const el of this.chromeElements(view)) {
			el.classList.add(CHROME_CLASS);
			if (color) el.style.setProperty("--type-color", color);
			else el.style.removeProperty("--type-color");
		}
	}

	private clearChromeTint(view: MarkdownView): void {
		for (const el of this.chromeElements(view)) {
			el.classList.remove(CHROME_CLASS);
			el.style.removeProperty("--type-color");
		}
	}

	/** Populate the name element with the type's ancestry: each parent type
	 *  (via `extends`) followed by the current type, e.g. `fact › person`. The
	 *  current type is the emphasized leaf; ancestors render muted. A type with
	 *  no parents shows just its own name. */
	private renderBreadcrumb(nameEl: HTMLElement, typeName: string): void {
		nameEl.empty();
		const chain = this.ancestryChain(typeName);
		chain.forEach((name, i) => {
			if (i > 0) nameEl.createSpan({ cls: `${BANNER_CLASS}-sep`, text: "›" });
			const isLeaf = i === chain.length - 1;
			nameEl.createSpan({
				cls: isLeaf ? `${BANNER_CLASS}-leaf` : `${BANNER_CLASS}-ancestor`,
				text: name,
			});
		});
	}

	/** Walk the `extends` chain from `typeName` up to its root ancestor,
	 *  returning names in root → leaf order. Cycle-guarded. */
	private ancestryChain(typeName: string): string[] {
		const chain: string[] = [];
		const seen = new Set<string>();
		let cur: string | undefined = typeName;
		while (cur && !seen.has(cur)) {
			seen.add(cur);
			chain.unshift(cur);
			cur = this.plugin.loader.get(cur)?.extends;
		}
		return chain;
	}

	private createBanner(container: HTMLElement): HTMLElement {
		const banner = container.createDiv({ cls: BANNER_CLASS });
		banner.createSpan({ cls: `${BANNER_CLASS}-icon` });
		banner.createSpan({ cls: `${BANNER_CLASS}-name` });
		// Static right-aligned label identifying the banner's source.
		banner.createSpan({ cls: `${BANNER_CLASS}-label`, text: "Schema" });
		// Click → open the type switcher for this banner's file.
		banner.setAttr("role", "button");
		banner.setAttr("title", "Click to switch type");
		banner.addEventListener("click", () => this.handleBannerClick(banner));
		// Move the banner to the top of the content container.
		container.insertBefore(banner, container.firstChild);
		return banner;
	}

	private handleBannerClick(banner: HTMLElement): void {
		const path = banner.dataset.filePath;
		const typeName = banner.dataset.typeName;
		if (!path || !typeName) return;
		const file = this.plugin.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return;
		new TypeSwitcherModal(this.plugin, file, typeName).open();
	}

	private removeAllBanners(): void {
		this.plugin.app.workspace.iterateAllLeaves((leaf) => {
			const view = leaf.view;
			if (view instanceof MarkdownView) {
				view.contentEl?.querySelector(`.${BANNER_CLASS}`)?.remove();
				this.clearChromeTint(view);
			}
		});
	}
}
