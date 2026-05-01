import { MarkdownView, setIcon, type EventRef, type WorkspaceLeaf } from "obsidian";
import type SchemaPlugin from "../main";

const BANNER_CLASS = "schema-type-banner";

/**
 * Renders a subtle horizontal banner at the top of typed-note views showing
 * the type's icon, name, and folder. Inserted as the first child of the
 * `view-content` element, above the editor's scroll area.
 *
 * Updated on:
 * - active-leaf-change (banner moves to the new active view)
 * - metadataCache.changed (banner refreshes when type/icon/color edits land)
 * - schema-changed (banner refreshes when defaults change)
 *
 * The banner is purely decorative — no events bound to it.
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
		if (!file) {
			existing?.remove();
			return;
		}

		const cache = this.plugin.app.metadataCache.getFileCache(file);
		const typeName = cache?.frontmatter?.type;
		if (typeof typeName !== "string" || typeName.length === 0) {
			existing?.remove();
			return;
		}

		const schema = this.plugin.loader.getResolved(typeName);
		if (!schema) {
			existing?.remove();
			return;
		}

		const color = typeof schema.defaults?.color === "string" ? schema.defaults.color : "";
		const icon = typeof schema.defaults?.icon === "string" ? schema.defaults.icon : "";
		const folder = schema.folder ?? "";

		const banner = (existing as HTMLElement | null) ?? this.createBanner(container);

		if (color) banner.style.setProperty("--type-color", color);
		else banner.style.removeProperty("--type-color");

		const iconEl = banner.querySelector(`.${BANNER_CLASS}-icon`) as HTMLElement | null;
		const nameEl = banner.querySelector(`.${BANNER_CLASS}-name`) as HTMLElement | null;
		const folderEl = banner.querySelector(`.${BANNER_CLASS}-folder`) as HTMLElement | null;

		if (iconEl) {
			iconEl.empty();
			if (icon) setIcon(iconEl, icon);
		}
		if (nameEl) nameEl.setText(typeName);
		if (folderEl) folderEl.setText(folder);
	}

	private createBanner(container: HTMLElement): HTMLElement {
		const banner = container.createDiv({ cls: BANNER_CLASS });
		banner.createSpan({ cls: `${BANNER_CLASS}-icon` });
		banner.createSpan({ cls: `${BANNER_CLASS}-name` });
		banner.createSpan({ cls: `${BANNER_CLASS}-folder` });
		// Move the banner to the top of the content container.
		container.insertBefore(banner, container.firstChild);
		return banner;
	}

	private removeAllBanners(): void {
		this.plugin.app.workspace.iterateAllLeaves((leaf) => {
			const view = leaf.view;
			if (view instanceof MarkdownView) {
				const banner = view.contentEl?.querySelector(`.${BANNER_CLASS}`);
				banner?.remove();
			}
		});
	}
}
