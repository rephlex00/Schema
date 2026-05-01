import { Notice, Plugin, TFile } from "obsidian";
import { cleanFrontmatter } from "./lifecycle/clean";
import { CreateCommandRegistry } from "./lifecycle/commands";
import { reshelveToSchema } from "./lifecycle/reshelve";
import { TypeChangeWatcher } from "./lifecycle/watcher";
import { registerBlockRenderer } from "./lookup/block-renderer";
import { LookupEngine } from "./lookup/engine";
import { FrontmatterLookupRenderer } from "./lookup/frontmatter-renderer";
import { SchemaLoader } from "./schema/loader";
import type { TypeSchema } from "./schema/types";
import { FieldPickerModal } from "./ui/field-edit-modal";
import { SchemaSettingsTab } from "./ui/settings-tab";

/** Kind controls which widget renders in each type's Defaults section. */
export type AutoRefreshedFieldKind = "text" | "color" | "icon";

export interface AutoRefreshedField {
	/** Frontmatter key name. */
	name: string;
	/** Widget kind for the per-type Defaults editor. */
	kind: AutoRefreshedFieldKind;
}

export interface SchemaSettings {
	/** All registered type schemas. The Settings tab is the canonical editor. */
	schemas: TypeSchema[];
	/** Frontmatter keys (e.g. icon, color) that get reset to schema.defaults
	 *  values whenever a note's type changes. */
	autoRefreshedFields: AutoRefreshedField[];
	/** Auto-reshelve a file when its `type:` frontmatter changes. */
	autoReshelveOnTypeChange: boolean;
}

const DEFAULT_SETTINGS: SchemaSettings = {
	schemas: [],
	autoRefreshedFields: [
		{ name: "icon", kind: "icon" },
		{ name: "color", kind: "color" },
	],
	autoReshelveOnTypeChange: true,
};

export default class SchemaPlugin extends Plugin {
	settings: SchemaSettings = DEFAULT_SETTINGS;
	loader!: SchemaLoader;
	createCommands!: CreateCommandRegistry;
	typeWatcher!: TypeChangeWatcher;
	lookups!: LookupEngine;
	fmLookupRenderer!: FrontmatterLookupRenderer;

	async onload() {
		await this.loadSettings();

		this.loader = new SchemaLoader();
		this.createCommands = new CreateCommandRegistry(this);
		this.typeWatcher = new TypeChangeWatcher(this);
		this.lookups = new LookupEngine(this.app);
		this.fmLookupRenderer = new FrontmatterLookupRenderer(this);

		registerBlockRenderer(this);

		this.addSettingTab(new SchemaSettingsTab(this.app, this));

		this.app.workspace.onLayoutReady(() => {
			this.loader.start(this.settings.schemas);
			const count = this.loader.getAll().length;
			const errs = this.loader.getValidationErrors().filter((e) => e.level === "error");
			if (errs.length > 0) {
				new Notice(
					`Schema: ${count} types loaded, ${errs.length} validation error(s) — see console.`,
					5000
				);
				console.warn("[schema] validation errors:", errs);
			} else {
				console.log(`[schema] loaded ${count} types from settings`);
			}
			this.createCommands.refresh(this.loader.getAll());
			this.typeWatcher.start();
			this.fmLookupRenderer.start();
			console.log(
				`[schema] lookup runtime: ${this.lookups.usingDataview() ? "dataview" : "builtin"}`
			);
		});

		this.registerEvent(
			this.loader.on("schema-changed", ((schemas: TypeSchema[]) => {
				console.log(`[schema] schema-changed: ${schemas.length} types`);
				this.createCommands.refresh(schemas);
				// Persist schema changes to data.json
				this.settings.schemas = schemas;
				void this.saveSettings();
			}) as (...data: unknown[]) => unknown)
		);

		this.addCommand({
			id: "show-loaded-types",
			name: "Show loaded types",
			callback: () => this.showLoadedTypes(),
		});

		this.addCommand({
			id: "refresh-frontmatter-lookups",
			name: "Refresh frontmatter lookups (vault-wide)",
			callback: async () => {
				const result = await this.fmLookupRenderer.refreshAll();
				new Notice(
					`Schema: refreshed lookups — ${result.updated} files updated, ${result.errors} errors.`
				);
			},
		});

		this.addCommand({
			id: "edit-field",
			name: "Edit field",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || file.extension !== "md") return false;
				const cache = this.app.metadataCache.getFileCache(file);
				const t = cache?.frontmatter?.type;
				if (typeof t !== "string") return false;
				const schema = this.loader.get(t);
				if (!schema) return false;
				if (checking) return true;
				new FieldPickerModal(this, file, schema).open();
				return true;
			},
		});

		this.addCommand({
			id: "reshelve-active",
			name: "Reshelve and clean active file",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || file.extension !== "md") return false;
				const cache = this.app.metadataCache.getFileCache(file);
				const t = cache?.frontmatter?.type;
				if (typeof t !== "string") return false;
				const schema = this.loader.get(t);
				if (!schema) return false;
				if (checking) return true;
				void this.runManualReshelve(file, schema);
				return true;
			},
		});

		console.log("[schema] Plugin loaded.");
	}

	onunload() {
		this.typeWatcher?.stop();
		this.loader?.stop();
		console.log("[schema] Plugin unloaded.");
	}

	private async runManualReshelve(file: TFile, schema: TypeSchema): Promise<void> {
		const cache = this.app.metadataCache.getFileCache(file);
		const fm = (cache?.frontmatter as Record<string, unknown> | undefined) ?? {};
		const moveResult = await reshelveToSchema(this.app, file, schema, fm);
		const moved =
			moveResult && moveResult.from !== moveResult.to
				? this.app.vault.getAbstractFileByPath(moveResult.to)
				: file;
		const target = moved instanceof TFile ? moved : file;
		const result = await cleanFrontmatter(this.app, target, schema, this.settings.autoRefreshedFields);
		const moveSummary =
			moveResult && moveResult.from !== moveResult.to ? ` moved → ${moveResult.to}` : "";
		new Notice(
			`Schema: ${schema.name}${moveSummary} · removed ${result.removed.length}, added ${result.added.length}`
		);
	}

	private showLoadedTypes() {
		const schemas = this.loader.getAll();
		if (schemas.length === 0) {
			new Notice("Schema: no types loaded. Add some via Settings → Schema.");
			return;
		}
		const lines = schemas.map((s) => {
			const folder = s.folder ?? "(no folder)";
			const fields = s.fields.length;
			const lookups = s.lookups.length;
			const ext = s.extends ? ` extends ${s.extends}` : "";
			return `${s.name}${ext} → ${folder} · ${fields} fields · ${lookups} lookups`;
		});
		const summary = `${schemas.length} types loaded`;
		console.log(`[schema] ${summary}:\n  ${lines.join("\n  ")}`);
		const errs = this.loader.getValidationErrors();
		if (errs.length > 0) {
			console.log("[schema] validation issues:", errs);
		}
		new Notice(`Schema: ${summary}. See console for details.`);
	}

	async loadSettings() {
		const loaded = (await this.loadData()) ?? {};
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);
		this.migrateAutoRefreshedFields();
	}

	private migrateAutoRefreshedFields(): void {
		const arr = this.settings.autoRefreshedFields as unknown[];
		if (!Array.isArray(arr) || arr.length === 0) return;
		// If the first element is a string, this is the v2.0 shape — convert.
		if (typeof arr[0] === "string") {
			this.settings.autoRefreshedFields = (arr as string[]).map((name) => ({
				name,
				kind:
					name === "color" ? "color" : name === "icon" ? "icon" : "text",
			}));
			void this.saveSettings();
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
