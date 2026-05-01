import { App, PluginSettingTab, Setting } from "obsidian";
import type SchemaPlugin from "../main";
import { AddTypeModal } from "./add-type-modal";
import { AutoRefreshedFieldsEditor } from "./auto-refreshed-fields-editor";
import { FolderMappingsEditor } from "./folder-mappings-editor";
import { TypeEditor } from "./type-editor";

type TabId = "global" | "objects" | "appearance";

interface TabDef {
	id: TabId;
	label: string;
}

const TABS: TabDef[] = [
	{ id: "global", label: "Global" },
	{ id: "objects", label: "Objects" },
	{ id: "appearance", label: "Appearance" },
];

/**
 * Top-level Settings → Schema tab. Renders a tab bar at the top and the
 * active tab's content below. Validation issues, when present, render at the
 * top of every tab so they're never missed.
 *
 * Re-renders when the loader emits `schema-changed` (via plugin re-display),
 * so edits made via the loader's API show up immediately.
 */
export class SchemaSettingsTab extends PluginSettingTab {
	private readonly plugin: SchemaPlugin;
	private rerenderListener: (() => void) | null = null;
	private filterText = "";
	private activeTab: TabId = "objects";

	constructor(app: App, plugin: SchemaPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("h2", { text: "Schema" });

		this.renderTabBar(containerEl);
		this.renderValidation(containerEl);

		const body = containerEl.createDiv({ cls: "schema-tab-body" });
		switch (this.activeTab) {
			case "global":
				this.renderGlobal(body);
				break;
			case "objects":
				this.renderTypes(body);
				break;
			case "appearance":
				this.renderAppearance(body);
				break;
		}

		this.detachRerenderListener();
		this.rerenderListener = () => this.display();
		this.plugin.loader.on("schema-changed", this.rerenderListener);
	}

	hide(): void {
		this.detachRerenderListener();
	}

	private detachRerenderListener(): void {
		if (this.rerenderListener) {
			this.plugin.loader.off("schema-changed", this.rerenderListener);
			this.rerenderListener = null;
		}
	}

	private renderTabBar(parent: HTMLElement): void {
		const bar = parent.createDiv({ cls: "schema-tab-bar" });
		for (const tab of TABS) {
			const btn = bar.createEl("button", {
				cls: `schema-tab-btn${this.activeTab === tab.id ? " active" : ""}`,
				text: tab.label,
				attr: { type: "button" },
			});
			btn.addEventListener("click", () => {
				if (this.activeTab === tab.id) return;
				this.activeTab = tab.id;
				this.display();
			});
		}
	}

	private renderGlobal(parent: HTMLElement): void {
		new Setting(parent)
			.setName("Auto-reshelve on type change")
			.setDesc(
				"When a note's `type:` frontmatter changes, automatically move it to the new type's folder and update its frontmatter."
			)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.autoReshelveOnTypeChange)
					.onChange(async (value) => {
						this.plugin.settings.autoReshelveOnTypeChange = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(parent)
			.setName("Auto-classify on folder match")
			.setDesc(
				"When a file is created or moved into a mapped folder, set its `type:` to that folder's type."
			)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.autoClassifyOnFolderMatch)
					.onChange(async (value) => {
						this.plugin.settings.autoClassifyOnFolderMatch = value;
						await this.plugin.saveSettings();
					});
			});

		parent.createEl("h4", { text: "Auto-refreshed frontmatter fields" });
		new AutoRefreshedFieldsEditor(this.plugin, () => this.display()).render(parent);

		parent.createEl("h4", { text: "Folder mappings" });
		new FolderMappingsEditor(this.plugin, () => this.display()).render(parent);

		const runtime = this.plugin.lookups.usingDataview() ? "Dataview (installed)" : "Built-in fallback";
		new Setting(parent).setName("Lookup runtime").setDesc(runtime).setDisabled(true);
	}

	private renderAppearance(parent: HTMLElement): void {
		new Setting(parent)
			.setName("Show type banner")
			.setDesc(
				"Render a subtle horizontal banner at the top of typed-note views showing the type's icon, name, and folder."
			)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.showTypeBanner)
					.onChange(async (value) => {
						this.plugin.settings.showTypeBanner = value;
						await this.plugin.saveSettings();
						if (value) this.plugin.typeBanner.start();
						else this.plugin.typeBanner.stop();
					});
			});

		new Setting(parent)
			.setName("Replace type property with chip")
			.setDesc(
				"In the note's properties pane, overlay a colored chip on top of the `type:` value (mirroring the settings tab styling). Editing still works — the chip hides when the cell is focused."
			)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.replaceTypePropertyWithChip)
					.onChange(async (value) => {
						this.plugin.settings.replaceTypePropertyWithChip = value;
						await this.plugin.saveSettings();
						if (value) this.plugin.typeChipProperty.start();
						else this.plugin.typeChipProperty.stop();
					});
			});
	}

	private renderValidation(parent: HTMLElement): void {
		const errs = this.plugin.loader.getValidationErrors();
		const errors = errs.filter((e) => e.level === "error");
		const warnings = errs.filter((e) => e.level === "warning");
		if (errors.length === 0 && warnings.length === 0) return;

		const wrap = parent.createDiv({ cls: "schema-validation-banner" });
		wrap.createEl("strong", {
			text: `Validation: ${errors.length} error${errors.length === 1 ? "" : "s"}, ${warnings.length} warning${warnings.length === 1 ? "" : "s"}`,
		});
		const ul = wrap.createEl("ul", { cls: "schema-validation-list" });
		for (const e of [...errors, ...warnings]) {
			ul.createEl("li", { text: `[${e.level}] ${e.type}: ${e.message}` });
		}
	}

	private renderTypes(parent: HTMLElement): void {
		const allTypes = this.plugin.loader
			.getAll()
			.slice()
			.sort((a, b) => a.name.localeCompare(b.name));

		const heading = parent.createEl("div", { cls: "schema-types-heading" });
		heading.createEl("h3", { text: `Types (${allTypes.length})` });

		new Setting(parent)
			.setName("Filter")
			.setDesc("Substring match across name, extends, and folder.")
			.addText((t) => {
				t.setPlaceholder("type to filter…").setValue(this.filterText).onChange((v) => {
					this.filterText = v;
					this.refreshTypeList();
				});
			})
			.addButton((btn) => {
				btn.setButtonText("+ Add type")
					.setCta()
					.onClick(() => {
						new AddTypeModal(this.plugin, () => this.display()).open();
					});
			});

		if (allTypes.length === 0) {
			parent.createEl("div", {
				cls: "schema-empty",
				text: "No types defined yet. Click '+ Add type' to start.",
			});
			return;
		}

		const list = parent.createEl("div", { cls: "schema-types-list" });
		this.populateTypeList(list);
	}

	/** (Re)populate the types list based on `this.filterText`. Types render
	 *  as a parent-child tree: types extending another type are nested below
	 *  their parent and indented one level. Filtering keeps matched types AND
	 *  their ancestors so the tree structure stays intact. */
	private populateTypeList(list: HTMLElement): void {
		list.empty();
		const allTypes = this.plugin.loader.getAll().slice();
		const byName = new Map(allTypes.map((t) => [t.name, t] as const));
		const q = this.filterText.trim().toLowerCase();

		const matches = (s: { name: string; extends?: string; folder?: string }): boolean => {
			if (q.length === 0) return true;
			const hay = `${s.name} ${s.extends ?? ""} ${s.folder ?? ""}`.toLowerCase();
			return hay.includes(q);
		};

		const visible = new Set<string>();
		for (const t of allTypes) {
			if (!matches(t)) continue;
			let cur: string | undefined = t.name;
			const seen = new Set<string>();
			while (cur && !seen.has(cur)) {
				seen.add(cur);
				visible.add(cur);
				cur = byName.get(cur)?.extends;
			}
		}

		if (visible.size === 0) {
			list.createEl("div", {
				cls: "schema-empty",
				text: `No types match "${this.filterText}".`,
			});
			return;
		}

		const childrenOf = new Map<string, string[]>();
		const roots: string[] = [];
		for (const t of allTypes) {
			if (!visible.has(t.name)) continue;
			const parent = t.extends && visible.has(t.extends) ? t.extends : null;
			if (parent) {
				if (!childrenOf.has(parent)) childrenOf.set(parent, []);
				childrenOf.get(parent)!.push(t.name);
			} else {
				roots.push(t.name);
			}
		}
		const cmp = (a: string, b: string) => a.localeCompare(b);
		roots.sort(cmp);
		for (const arr of childrenOf.values()) arr.sort(cmp);

		const renderTree = (name: string, depth: number) => {
			new TypeEditor(this.plugin, name).render(list, false, depth);
			const kids = childrenOf.get(name) ?? [];
			for (const k of kids) renderTree(k, depth + 1);
		};
		for (const r of roots) renderTree(r, 0);
	}

	private refreshTypeList(): void {
		const list = this.containerEl.querySelector(".schema-types-list");
		if (list instanceof HTMLElement) this.populateTypeList(list);
	}
}
