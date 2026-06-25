import { TFile, setIcon, type EventRef } from "obsidian";
import type SchemaPlugin from "../main";
import { readTypeKey } from "../util/frontmatter";

const ICON_CLASS = "schema-file-explorer-icon";
const HOST_CLASS = "schema-has-file-explorer-icon";

/**
 * Prepends each typed markdown file's type icon to its row in the file explorer.
 * Icon + color are resolved through the `extends` chain so a child type without
 * its own icon shows its ancestor's, matching the banner and chip.
 *
 * Refreshes on layout-change, metadataCache.changed (per-file fast path), and
 * schema-changed. Uses a MutationObserver scoped to the workspace root because
 * the file explorer renders rows lazily as the user scrolls / expands folders.
 *
 * Toggleable via `showFileExplorerIcons` setting (default off - opt in).
 */
export class FileExplorerIconsManager {
	private readonly plugin: SchemaPlugin;
	private layoutRef: EventRef | null = null;
	private metaRef: EventRef | null = null;
	private schemaListener: (() => void) | null = null;
	private observer: MutationObserver | null = null;
	private debounceTimer: number | null = null;

	constructor(plugin: SchemaPlugin) {
		this.plugin = plugin;
	}

	start(): void {
		this.layoutRef = this.plugin.app.workspace.on("layout-change", () => this.scheduleRefresh());
		this.metaRef = this.plugin.app.metadataCache.on("changed", (file) => {
			this.refreshFile(file);
		});
		this.schemaListener = () => this.scheduleRefresh();
		this.plugin.loader.on("schema-changed", this.schemaListener);

		const root = this.plugin.app.workspace.containerEl;
		this.observer = new MutationObserver(() => this.scheduleRefresh());
		this.observer.observe(root, { childList: true, subtree: true });

		this.scheduleRefresh();
	}

	stop(): void {
		if (this.layoutRef) this.plugin.app.workspace.offref(this.layoutRef);
		if (this.metaRef) this.plugin.app.metadataCache.offref(this.metaRef);
		if (this.schemaListener) this.plugin.loader.off("schema-changed", this.schemaListener);
		this.observer?.disconnect();
		if (this.debounceTimer != null) window.clearTimeout(this.debounceTimer);
		this.layoutRef = null;
		this.metaRef = null;
		this.schemaListener = null;
		this.observer = null;
		this.debounceTimer = null;
		this.removeAllIcons();
	}

	private scheduleRefresh(): void {
		if (this.debounceTimer != null) return;
		this.debounceTimer = window.setTimeout(() => {
			this.debounceTimer = null;
			this.refresh();
		}, 80);
	}

	private refresh(): void {
		this.withObserverPaused(() => {
			const root = this.plugin.app.workspace.containerEl;
			const titles = root.querySelectorAll<HTMLElement>(".nav-file-title");
			titles.forEach((title) => this.refreshTitle(title));
		});
	}

	private refreshFile(file: TFile): void {
		this.withObserverPaused(() => {
			const root = this.plugin.app.workspace.containerEl;
			const escaped =
				typeof CSS !== "undefined" && typeof CSS.escape === "function"
					? CSS.escape(file.path)
					: file.path.replace(/(["\\])/g, "\\$1");
			const title = root.querySelector<HTMLElement>(`.nav-file-title[data-path="${escaped}"]`);
			if (title) this.refreshTitle(title);
		});
	}

	/** Pause the observer while WE mutate the DOM so our own icon insertions
	 *  don't re-trigger the observer and schedule another sweep. */
	private withObserverPaused(fn: () => void): void {
		this.observer?.disconnect();
		try {
			fn();
		} finally {
			this.observer?.observe(this.plugin.app.workspace.containerEl, {
				childList: true,
				subtree: true,
			});
		}
	}

	private refreshTitle(title: HTMLElement): void {
		const path = title.dataset.path;
		if (!path) return;
		const file = this.plugin.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile) || file.extension !== "md") {
			this.removeIcon(title);
			return;
		}

		const cache = this.plugin.app.metadataCache.getFileCache(file);
		const typeName = readTypeKey(
			cache?.frontmatter as Record<string, unknown> | undefined,
			this.plugin.settings.typeKey
		);
		const schema = typeName ? this.plugin.loader.getResolved(typeName) : undefined;
		if (!schema) {
			this.removeIcon(title);
			return;
		}

		const iconName = typeof schema.defaults?.icon === "string" ? schema.defaults.icon : "";
		const color = typeof schema.defaults?.color === "string" ? schema.defaults.color : "";
		if (!iconName) {
			this.removeIcon(title);
			return;
		}

		let icon = title.querySelector<HTMLElement>(`.${ICON_CLASS}`);
		if (!icon) {
			icon = document.createElement("span");
			icon.classList.add(ICON_CLASS);
			title.insertBefore(icon, title.firstChild);
			title.classList.add(HOST_CLASS);
		}

		// Skip DOM churn if nothing changed.
		if (icon.dataset.icon === iconName && icon.dataset.color === color) return;
		icon.dataset.icon = iconName;
		icon.dataset.color = color;
		icon.textContent = "";
		setIcon(icon, iconName);
		if (color) icon.style.setProperty("--type-color", color);
		else icon.style.removeProperty("--type-color");
	}

	private removeIcon(title: HTMLElement): void {
		const icon = title.querySelector(`.${ICON_CLASS}`);
		icon?.remove();
		title.classList.remove(HOST_CLASS);
	}

	private removeAllIcons(): void {
		const root = this.plugin.app.workspace.containerEl;
		root.querySelectorAll<HTMLElement>(`.${HOST_CLASS}`).forEach((title) =>
			this.removeIcon(title)
		);
	}
}
