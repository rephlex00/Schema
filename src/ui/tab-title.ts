import { MarkdownView, TFile, setIcon, type EventRef, type WorkspaceLeaf } from "obsidian";
import type SchemaPlugin from "../main";
import { readTypeKey } from "../util/frontmatter";
import { getTabHeaderEl } from "./leaf";

const INNER_SEL = ".workspace-tab-header-inner";
const TITLE_SEL = ".workspace-tab-header-inner-title";
/** Class of the icon span we inject. Obsidian's own tab icon slot is hidden in
 *  the main tab bar, so we add our own element instead of recoloring theirs. */
const ICON_CLASS = "schema-tab-icon";
/** Marks a title we've overridden, so we only restore tabs we touched. */
const TITLE_FLAG = "schemaTabTitle";

/**
 * Rewrites the tab bar entry for typed markdown notes:
 * - replaces the filename with a configured frontmatter property's value
 *   (`tabTitleProperty`, e.g. `title`), falling back to the filename when the
 *   property is missing or empty, and
 * - replaces the tab's leading icon with the note's type icon, colored with the
 *   type color (`showTabIcon`). Icon + color resolve through the `extends` chain,
 *   matching the banner, chip, and file-list icons.
 *
 * Works by writing into Obsidian's own tab-header DOM (the title text and the
 * `.workspace-tab-header-inner-icon` slot) and re-applying on the events that
 * make Obsidian repaint a tab: active-leaf-change, layout-change, rename, plus
 * metadataCache / schema changes for content. Best-effort and fully reversible -
 * stop() restores every tab we touched.
 *
 * Toggled by `tabTitleProperty` (non-empty) and `showTabIcon`; the manager runs
 * while either is active.
 */
export class TabTitleManager {
	private readonly plugin: SchemaPlugin;
	private leafRef: EventRef | null = null;
	private layoutRef: EventRef | null = null;
	private metaRef: EventRef | null = null;
	private renameRef: EventRef | null = null;
	private schemaListener: (() => void) | null = null;
	private debounceTimer: number | null = null;

	constructor(plugin: SchemaPlugin) {
		this.plugin = plugin;
	}

	start(): void {
		const ws = this.plugin.app.workspace;
		this.leafRef = ws.on("active-leaf-change", () => this.scheduleRefresh());
		this.layoutRef = ws.on("layout-change", () => this.scheduleRefresh());
		this.metaRef = this.plugin.app.metadataCache.on("changed", (file) => this.refreshFile(file));
		this.renameRef = this.plugin.app.vault.on("rename", () => this.scheduleRefresh());
		this.schemaListener = () => this.scheduleRefresh();
		this.plugin.loader.on("schema-changed", this.schemaListener);

		this.refresh();
	}

	stop(): void {
		const ws = this.plugin.app.workspace;
		if (this.leafRef) ws.offref(this.leafRef);
		if (this.layoutRef) ws.offref(this.layoutRef);
		if (this.metaRef) this.plugin.app.metadataCache.offref(this.metaRef);
		if (this.renameRef) this.plugin.app.vault.offref(this.renameRef);
		if (this.schemaListener) this.plugin.loader.off("schema-changed", this.schemaListener);
		if (this.debounceTimer != null) window.clearTimeout(this.debounceTimer);
		this.leafRef = null;
		this.layoutRef = null;
		this.metaRef = null;
		this.renameRef = null;
		this.schemaListener = null;
		this.debounceTimer = null;
		this.restoreAll();
	}

	isRunning(): boolean {
		return this.leafRef !== null;
	}

	/** Public so the settings toggles can re-apply immediately. */
	refresh(): void {
		this.plugin.app.workspace.iterateAllLeaves((leaf) => this.refreshLeaf(leaf));
	}

	private scheduleRefresh(): void {
		if (this.debounceTimer != null) return;
		this.debounceTimer = window.setTimeout(() => {
			this.debounceTimer = null;
			this.refresh();
		}, 50);
	}

	private refreshFile(file: TFile): void {
		this.plugin.app.workspace.iterateAllLeaves((leaf) => {
			const view = leaf.view;
			if (view instanceof MarkdownView && view.file?.path === file.path) this.refreshLeaf(leaf);
		});
	}

	private refreshLeaf(leaf: WorkspaceLeaf): void {
		const view = leaf.view;
		if (!(view instanceof MarkdownView)) return;
		const file = view.file;
		const tabHeaderEl = getTabHeaderEl(leaf);
		if (!tabHeaderEl || !file) return;

		const innerEl = tabHeaderEl.querySelector<HTMLElement>(INNER_SEL);
		const titleEl = tabHeaderEl.querySelector<HTMLElement>(TITLE_SEL);

		const cache = this.plugin.app.metadataCache.getFileCache(file);
		const fm = cache?.frontmatter as Record<string, unknown> | undefined;

		this.applyTitle(titleEl, file, fm);
		this.applyIcon(innerEl, fm);
	}

	private applyTitle(
		titleEl: HTMLElement | null,
		file: TFile,
		fm: Record<string, unknown> | undefined
	): void {
		if (!titleEl) return;
		const prop = this.plugin.settings.tabTitleProperty.trim();
		const custom = prop ? scalarToString(fm?.[prop]) : "";
		if (custom) {
			if (titleEl.textContent !== custom) titleEl.textContent = custom;
			titleEl.dataset[TITLE_FLAG] = "1";
		} else if (titleEl.dataset[TITLE_FLAG]) {
			// We had overridden it; restore the filename Obsidian would show.
			if (titleEl.textContent !== file.basename) titleEl.textContent = file.basename;
			delete titleEl.dataset[TITLE_FLAG];
		}
	}

	/** Inject (or update / remove) our own icon span as the first child of the
	 *  tab's inner element. We don't reuse Obsidian's `.workspace-tab-header-
	 *  inner-icon` slot because it's hidden in the main tab bar. */
	private applyIcon(innerEl: HTMLElement | null, fm: Record<string, unknown> | undefined): void {
		if (!innerEl) return;
		const typeName = readTypeKey(fm, this.plugin.settings.typeKey);
		const schema = typeName ? this.plugin.loader.getResolved(typeName) : undefined;
		const iconName =
			this.plugin.settings.showTabIcon && schema && typeof schema.defaults?.icon === "string"
				? schema.defaults.icon
				: "";
		const color = typeof schema?.defaults?.color === "string" ? schema.defaults.color : "";

		let icon = innerEl.querySelector<HTMLElement>(`.${ICON_CLASS}`);
		if (!iconName) {
			icon?.remove();
			return;
		}
		if (!icon) {
			icon = innerEl.createSpan({ cls: ICON_CLASS });
			innerEl.insertBefore(icon, innerEl.firstChild);
		}
		// Skip DOM churn if nothing changed.
		if (icon.dataset.icon === iconName && icon.dataset.color === color) return;
		icon.dataset.icon = iconName;
		icon.dataset.color = color;
		icon.empty();
		setIcon(icon, iconName);
		if (color) icon.style.setProperty("--type-color", color);
		else icon.style.removeProperty("--type-color");
	}

	private restoreAll(): void {
		this.plugin.app.workspace.iterateAllLeaves((leaf) => {
			const view = leaf.view;
			if (!(view instanceof MarkdownView)) return;
			const tabHeaderEl = getTabHeaderEl(leaf);
			if (!tabHeaderEl) return;
			const titleEl = tabHeaderEl.querySelector<HTMLElement>(TITLE_SEL);
			if (titleEl?.dataset[TITLE_FLAG] && view.file) {
				titleEl.textContent = view.file.basename;
				delete titleEl.dataset[TITLE_FLAG];
			}
			tabHeaderEl.querySelector(`.${ICON_CLASS}`)?.remove();
		});
	}
}

/** Render a scalar frontmatter value as a trimmed display string. Objects and
 *  arrays (and null/undefined) yield "" so the caller falls back to the
 *  filename. */
function scalarToString(v: unknown): string {
	if (typeof v === "string") return v.trim();
	if (typeof v === "number" || typeof v === "boolean") return String(v);
	return "";
}
