import { App, ButtonComponent, PluginSettingTab, Setting, SettingGroup } from "obsidian";
import type SchemaPlugin from "../main";
import { renderAppearanceVisualsPane } from "./settings-panes/appearance-visuals-pane";
import { renderIntegrationsPane } from "./settings-panes/integrations-pane";
import { renderLifecycleMappingsPane } from "./settings-panes/lifecycle-mappings-pane";
import { renderLifecycleNotePane } from "./settings-panes/lifecycle-note-pane";
import { renderLifecycleTemplatesPane } from "./settings-panes/lifecycle-templates-pane";
import { renderPropertiesFieldsPane } from "./settings-panes/properties-fields-pane";
import { renderPropertiesFiltersPane } from "./settings-panes/properties-filters-pane";
import { renderStructureTypesPane } from "./settings-panes/structure-types-pane";

type PaneId =
	| "structure-types"
	| "properties-fields"
	| "lifecycle-note"
	| "lifecycle-mappings"
	| "properties-filters"
	| "appearance-visuals"
	| "integrations";

interface PaneDef {
	id: PaneId;
	title: string;
	summary: string;
}

interface PaneGroup {
	label: string;
	panes: PaneId[];
}

const PANE_REGISTRY: Record<PaneId, PaneDef> = {
	"structure-types": {
		id: "structure-types",
		title: "Object types",
		summary: "Define and edit object types",
	},
	"properties-fields": {
		id: "properties-fields",
		title: "Global properties",
		summary: "Reusable property registry",
	},
	"lifecycle-note": {
		id: "lifecycle-note",
		title: "Creation and lifecycle",
		summary: "Automation rules and body templates",
	},
	"lifecycle-mappings": {
		id: "lifecycle-mappings",
		title: "Folder → Object mappings",
		summary: "Map folders to object types",
	},
	"properties-filters": {
		id: "properties-filters",
		title: "Custom template filters",
		summary: "JS helpers for folder and filename templates",
	},
	"appearance-visuals": {
		id: "appearance-visuals",
		title: "UI elements",
		summary: "Banner, chip, and file-list icons",
	},
	integrations: {
		id: "integrations",
		title: "Integrations",
		summary: "Dataview, Templater, Graph view, and Notebook Navigator",
	},
};

const PANE_GROUPS: PaneGroup[] = [
	{ label: "Structure", panes: ["structure-types", "properties-fields"] },
	{ label: "Lifecycle", panes: ["lifecycle-note", "lifecycle-mappings", "properties-filters"] },
	{ label: "Appearance", panes: ["appearance-visuals"] },
	{ label: "Integrations", panes: ["integrations"] },
];

/**
 * Top-level Settings → Schema tab.
 *
 * Mirrors Notebook Navigator's landing-then-sub-page UX. Each landing row and
 * the sub-page title bar are built from Obsidian's native `Setting` /
 * `SettingGroup` primitives so the look matches the rest of Settings on both
 * desktop and mobile. No custom card CSS.
 */
export class SchemaSettingsTab extends PluginSettingTab {
	private readonly plugin: SchemaPlugin;
	private rerenderListener: (() => void) | null = null;
	private activePane: PaneId | null = null;
	private filterText = "";
	/** When set, the next renderPane consumes it: scroll to / expand the row
	 *  whose data-schema-anchor matches. Cleared after consumption. */
	private pendingAnchor: string | null = null;

	constructor(app: App, plugin: SchemaPlugin) {
		super(app, plugin);
		this.plugin = plugin;
		// Expose a cross-pane navigator any UI module can call.
		plugin.navigateSettings = (pane: string, anchor?: string) => {
			if (!(pane in PANE_REGISTRY)) return;
			this.navigate(pane as PaneId, anchor);
		};
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		if (this.activePane === null) {
			this.renderLanding(containerEl);
		} else {
			this.renderPane(containerEl, this.activePane);
		}

		this.detachRerenderListener();
		this.rerenderListener = () => {
			if (this.containerEl.contains(this.containerEl.ownerDocument.activeElement)) return;
			this.display();
		};
		this.plugin.loader.on("schema-changed", this.rerenderListener);
	}

	hide(): void {
		this.detachRerenderListener();
		// Reset to landing so re-opening Settings is consistent with NN.
		this.activePane = null;
	}

	private detachRerenderListener(): void {
		if (this.rerenderListener) {
			this.plugin.loader.off("schema-changed", this.rerenderListener);
			this.rerenderListener = null;
		}
	}

	private navigate(id: PaneId | null, anchor?: string): void {
		if (this.activePane === id && !anchor) return;
		this.activePane = id;
		this.pendingAnchor = anchor ?? null;
		this.display();
		if (this.pendingAnchor) this.consumeAnchor();
	}

	/** Find an element by `data-schema-anchor` in the active pane, scroll it
	 *  into view, and open it if it's a <details>. Called after renderPane. */
	private consumeAnchor(): void {
		const anchor = this.pendingAnchor;
		if (!anchor) return;
		this.pendingAnchor = null;
		// Defer so the pane's async renderers (loops, sub-editors) have a
		// chance to populate the DOM first.
		window.setTimeout(() => {
			const target = this.containerEl.querySelector<HTMLElement>(
				`[data-schema-anchor="${anchor.replace(/"/g, '\\"')}"]`
			);
			if (!target) return;
			if (target.instanceOf(HTMLDetailsElement)) target.open = true;
			const details = target.closest("details");
			if (details instanceof HTMLDetailsElement) details.open = true;
			target.scrollIntoView({ behavior: "smooth", block: "start" });
		}, 80);
	}

	// --- Landing -----------------------------------------------------------

	private renderLanding(parent: HTMLElement): void {
		const errCount = this.plugin.loader.getValidationErrors().length;
		const hasError = this.plugin.loader.getValidationErrors().some((e) => e.level === "error");
		const counts = this.landingCounts();

		for (const group of PANE_GROUPS) {
			const groupEl = parent.createDiv({ cls: "setting-group" });
			const settingGroup = new SettingGroup(groupEl);
			settingGroup.setHeading(group.label);
			for (const paneId of group.panes) {
				const def = PANE_REGISTRY[paneId];
				const badge =
					paneId === "structure-types" && errCount > 0
						? { count: errCount, error: hasError }
						: null;
				const count = counts[paneId];
				settingGroup.addSetting((s) => this.configurePageLink(s, def, badge, count));
			}
		}

		const footer = parent.createDiv({ cls: "schema-settings-version" });
		footer.setText(`Schema v${this.plugin.manifest.version}`);
	}

	/** Neutral "how many" chips shown on the landing rows so the user gets a
	 *  sense of scale before drilling in. Only panes backed by a countable
	 *  collection appear here; the rest stay chip-free. */
	private landingCounts(): Partial<Record<PaneId, number>> {
		return {
			"structure-types": this.plugin.loader.getAll().length,
			"properties-fields": Object.keys(this.plugin.settings.globalFields).length,
			"lifecycle-mappings": Object.keys(this.plugin.settings.folderMappings).length,
			"properties-filters": Object.keys(this.plugin.settings.customFilters).length,
		};
	}

	private configurePageLink(
		setting: Setting,
		def: PaneDef,
		badge: { count: number; error: boolean } | null,
		count?: number,
	): void {
		setting.setName(def.title).setDesc(def.summary);
		setting.addExtraButton((b) => {
			b.setIcon("chevron-right").onClick(() => this.navigate(def.id));
			b.extraSettingsEl.setAttr("aria-label", def.title);
		});

		if (typeof count === "number") {
			const countEl = setting.nameEl.createSpan({
				cls: "schema-settings-count",
				text: String(count),
			});
			countEl.setAttr("aria-label", `${count} item${count === 1 ? "" : "s"}`);
		}

		if (badge) {
			const badgeEl = setting.nameEl.createSpan({
				cls: `schema-settings-badge${badge.error ? " schema-settings-badge-error" : " schema-settings-badge-warn"}`,
				text: String(badge.count),
			});
			badgeEl.setAttr("aria-label", `${badge.count} validation ${badge.error ? "error" : "warning"}${badge.count === 1 ? "" : "s"}`);
		}

		// Whole row is the click target. Matches NN's page-link pattern.
		setting.settingEl.addClass("schema-settings-page-link");
		setting.settingEl.tabIndex = 0;
		setting.settingEl.setAttr("role", "button");
		setting.settingEl.setAttr("aria-label", def.title);
		setting.settingEl.addEventListener("click", (e) => {
			// Avoid double-firing when the chevron itself is clicked.
			const target = e.target as HTMLElement | null;
			if (target?.closest(".setting-item-control")) return;
			this.navigate(def.id);
		});
		setting.settingEl.addEventListener("keydown", (e) => {
			if (e.key !== "Enter" && e.key !== " ") return;
			e.preventDefault();
			this.navigate(def.id);
		});
	}

	// --- Sub-page shell ----------------------------------------------------

	private renderPane(parent: HTMLElement, paneId: PaneId): void {
		const def = PANE_REGISTRY[paneId];

		// Title bar with inline back button. Obsidian-native heading row.
		const title = new Setting(parent).setName(def.title).setHeading();
		title.settingEl.addClass("schema-settings-titlebar");
		title.nameEl.empty();
		const back = new ButtonComponent(title.nameEl);
		back
			.setIcon("chevron-left")
			.setTooltip("Back to Schema settings")
			.onClick(() => this.navigate(null));
		back.buttonEl.addClass("clickable-icon");
		back.buttonEl.addClass("schema-settings-back-button");
		title.nameEl.createSpan({ text: def.title });

		// Page description sits under the title.
		const desc = parent.createDiv({ cls: "schema-settings-page-description" });
		desc.setText(paneDescriptions(this.plugin.settings.typeKey)[paneId]);

		this.dispatchPane(parent, paneId);
	}

	private dispatchPane(body: HTMLElement, paneId: PaneId): void {
		const refresh = () => this.display();
		switch (paneId) {
			case "structure-types":
				renderStructureTypesPane(this.plugin, body, refresh, {
					getFilterText: () => this.filterText,
					setFilterText: (v) => {
						this.filterText = v;
					},
				});
				break;
			case "properties-fields":
				renderPropertiesFieldsPane(this.plugin, body, refresh);
				break;
			case "lifecycle-note":
				// Merged pane: automation rules, then body-template settings. Each
				// render function supplies its own section heading.
				renderLifecycleNotePane(this.plugin, body);
				renderLifecycleTemplatesPane(this.plugin, body);
				break;
			case "lifecycle-mappings":
				renderLifecycleMappingsPane(this.plugin, body, refresh);
				break;
			case "properties-filters":
				renderPropertiesFiltersPane(this.plugin, body, refresh);
				break;
			case "appearance-visuals":
				renderAppearanceVisualsPane(this.plugin, body);
				break;
			case "integrations":
				renderIntegrationsPane(this.plugin, body);
				break;
		}
	}
}

function paneDescriptions(typeKey: string): Record<PaneId, string> {
	return {
		"structure-types": "Every object type defines a folder, filename pattern, properties, and defaults.",
		"properties-fields": "Define a property once. Every object type that references it stays in sync.",
		"lifecycle-note":
			"What happens automatically when a note's object type or folder changes, and where body templates come from.",
		"lifecycle-mappings": "Map new notes created in a folder to an object type.",
		"properties-filters":
			"Snippets of JavaScript usable as filters in template fields, e.g. `{{ name | initials }}`.",
		"appearance-visuals": "Where the object type shows up in the note UI.",
		integrations:
			"Other plugins Schema talks to: the query and templating engines, plus one-click color and icon sync to Graph view and Notebook Navigator.",
	};
}
