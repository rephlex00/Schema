import { MarkdownView, TFile, setIcon, type EventRef } from "obsidian";
import type SchemaPlugin from "../main";
import { readTypeKey } from "../util/frontmatter";
import { TypeSwitcherModal } from "./type-switcher-modal";

const CHIP_CLASS = "schema-type-property-chip";
const HOST_CLASS = "schema-has-type-chip";

/**
 * Overlays a chip on top of the `type:` property's value cell in any visible
 * MarkdownView's properties pane. The chip shows the type's icon and name with
 * the configured color, mirroring the chip used in the settings tab.
 *
 * The underlying value text/input stays in place - the chip is just a visual
 * overlay that hides when the cell is focused (so editing still works).
 *
 * Refreshes on:
 * - layout-change / active-leaf-change (catches view switches and mode toggles)
 * - metadataCache.changed (catches type changes from edits)
 * - schema-changed (catches color/icon edits in settings)
 *
 * Falls back to a MutationObserver scoped to the workspace root, since
 * Obsidian renders the property pane asynchronously after layout-change.
 */
export class TypeChipPropertyManager {
	private readonly plugin: SchemaPlugin;
	private leafRef: EventRef | null = null;
	private layoutRef: EventRef | null = null;
	private metaRef: EventRef | null = null;
	private schemaListener: (() => void) | null = null;
	private observer: MutationObserver | null = null;
	private debounceTimer: number | null = null;

	constructor(plugin: SchemaPlugin) {
		this.plugin = plugin;
	}

	start(): void {
		this.leafRef = this.plugin.app.workspace.on("active-leaf-change", () => this.scheduleRefresh());
		this.layoutRef = this.plugin.app.workspace.on("layout-change", () => this.scheduleRefresh());
		// A metadata change only affects views showing that exact file - refresh
		// just those instead of sweeping every leaf on every edit in the vault.
		this.metaRef = this.plugin.app.metadataCache.on("changed", (file) => this.refreshFile(file));
		this.schemaListener = () => this.scheduleRefresh();
		this.plugin.loader.on("schema-changed", this.schemaListener);

		// Properties view renders async after layout-change. Watching the
		// workspace root for inserted nodes ensures we catch newly-rendered
		// property cells. Filtered to attributes/childList only.
		const root = this.plugin.app.workspace.containerEl;
		this.observer = new MutationObserver(() => this.scheduleRefresh());
		this.observer.observe(root, {
			childList: true,
			subtree: true,
		});

		this.refresh();
	}

	stop(): void {
		if (this.leafRef) this.plugin.app.workspace.offref(this.leafRef);
		if (this.layoutRef) this.plugin.app.workspace.offref(this.layoutRef);
		if (this.metaRef) this.plugin.app.metadataCache.offref(this.metaRef);
		if (this.schemaListener) this.plugin.loader.off("schema-changed", this.schemaListener);
		this.observer?.disconnect();
		if (this.debounceTimer != null) window.clearTimeout(this.debounceTimer);
		this.leafRef = null;
		this.layoutRef = null;
		this.metaRef = null;
		this.schemaListener = null;
		this.observer = null;
		this.debounceTimer = null;
		this.removeAllChips();
	}

	private scheduleRefresh(): void {
		if (this.debounceTimer != null) return; // coalesce bursts
		this.debounceTimer = window.setTimeout(() => {
			this.debounceTimer = null;
			this.refresh();
		}, 50);
	}

	private refresh(): void {
		// Pause the observer while WE mutate the DOM, otherwise our own chip
		// insertions re-trigger the observer and schedule another sweep.
		this.withObserverPaused(() => {
			this.plugin.app.workspace.iterateAllLeaves((leaf) => {
				const view = leaf.view;
				if (!(view instanceof MarkdownView)) return;
				this.refreshView(view);
			});
		});
	}

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

	/** Refresh only the views currently showing `file` (metadata-change fast path). */
	private refreshFile(file: TFile): void {
		this.withObserverPaused(() => {
			this.plugin.app.workspace.iterateAllLeaves((leaf) => {
				const view = leaf.view;
				if (view instanceof MarkdownView && view.file?.path === file.path) {
					this.refreshView(view);
				}
			});
		});
	}

	private refreshView(view: MarkdownView): void {
		const file = view.file;
		if (!file) return;
		const container = view.containerEl;
		if (!container) return;

		const cache = this.plugin.app.metadataCache.getFileCache(file);
		const typeKey = this.plugin.settings.typeKey;
		const typeName = readTypeKey(
			cache?.frontmatter as Record<string, unknown> | undefined,
			typeKey
		);
		const schema = typeName ? this.plugin.loader.getResolved(typeName) : undefined;

		// Find every type-property cell in this view (edit + reading mode each
		// have their own DOM tree). The cell is keyed by the configured object-
		// type frontmatter key.
		const selector = `[data-property-key="${cssEscape(typeKey)}"] .metadata-property-value`;
		const cells = container.querySelectorAll<HTMLElement>(selector);
		cells.forEach((cell) => {
			if (!schema || !typeName) {
				this.removeChipFrom(cell);
				return;
			}
			this.applyChip(cell, typeName, schema.defaults ?? {}, file);
		});
	}

	private applyChip(
		cell: HTMLElement,
		typeName: string,
		defaults: Record<string, unknown>,
		file: TFile
	): void {
		cell.classList.add(HOST_CLASS);
		const color = typeof defaults.color === "string" ? defaults.color : "";
		const icon = typeof defaults.icon === "string" ? defaults.icon : "";

		let chip = cell.querySelector<HTMLElement>(`.${CHIP_CLASS}`);
		const isNew = !chip;
		if (!chip) {
			chip = cell.createSpan({ cls: CHIP_CLASS }) as HTMLElement;
			chip.setAttr("title", "Click to switch type");
			chip.addEventListener("click", this.handleChipClick);
		}

		chip.dataset.filePath = file.path;

		// Compare current state to avoid unnecessary DOM churn.
		const expectedColor = color || "";
		const currentColor = chip.dataset.color || "";
		const currentName = chip.dataset.typeName || "";
		const currentIcon = chip.dataset.icon || "";
		if (
			!isNew &&
			currentName === typeName &&
			currentColor === expectedColor &&
			currentIcon === icon
		) {
			return;
		}

		chip.empty();
		chip.dataset.typeName = typeName;
		chip.dataset.color = expectedColor;
		chip.dataset.icon = icon;
		if (color) chip.style.setProperty("--type-color", color);
		else chip.style.removeProperty("--type-color");

		if (icon) {
			const iconEl = chip.createSpan({ cls: "schema-type-icon" });
			setIcon(iconEl, icon);
		}
		chip.createSpan({ cls: "schema-type-name", text: typeName });
	}

	private handleChipClick = (e: Event): void => {
		e.stopPropagation();
		e.preventDefault();
		const chip = e.currentTarget as HTMLElement;
		const path = chip.dataset.filePath;
		const typeName = chip.dataset.typeName;
		if (!path || !typeName) return;
		const file = this.plugin.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return;
		new TypeSwitcherModal(this.plugin, file, typeName).open();
	};

	private removeChipFrom(cell: HTMLElement): void {
		cell.classList.remove(HOST_CLASS);
		const chip = cell.querySelector(`.${CHIP_CLASS}`);
		chip?.remove();
	}

	private removeAllChips(): void {
		const root = this.plugin.app.workspace.containerEl;
		root.querySelectorAll<HTMLElement>(
			`.${HOST_CLASS}`
		).forEach((cell) => this.removeChipFrom(cell));
	}
}

function cssEscape(value: string): string {
	if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
		return CSS.escape(value);
	}
	return value.replace(/(["\\])/g, "\\$1");
}
