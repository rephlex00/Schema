import { Notice, Plugin, TFile } from "obsidian";
import { cleanFrontmatter } from "./lifecycle/clean";
import { CreateCommandRegistry } from "./lifecycle/commands";
import { reshelveToSchema } from "./lifecycle/reshelve";
import { TypeChangeWatcher } from "./lifecycle/watcher";
import { registerBlockRenderer } from "./lookup/block-renderer";
import { LookupEngine } from "./lookup/engine";
import {
	FrontmatterLookupRenderer,
	migrateLookupsToBlock,
} from "./lookup/frontmatter-renderer";
import { SchemaLoader } from "./schema/loader";
import type { TypeSchema } from "./schema/types";

interface SchemaSettings {
	/** Vault-relative folder where fileClass definitions are stored. */
	schemaFolder: string;
	/** Auto-reshelve a file when its `type:` frontmatter changes. (Phase 3.) */
	autoReshelveOnTypeChange: boolean;
}

const DEFAULT_SETTINGS: SchemaSettings = {
	schemaFolder: "Templates/Objects",
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

		this.loader = new SchemaLoader(this.app, {
			schemaFolder: this.settings.schemaFolder,
		});
		this.createCommands = new CreateCommandRegistry(this);
		this.typeWatcher = new TypeChangeWatcher(this);
		this.lookups = new LookupEngine(this.app);
		this.fmLookupRenderer = new FrontmatterLookupRenderer(this);

		registerBlockRenderer(this);

		// Defer initial schema scan until the vault has finished indexing,
		// so cachedRead returns up-to-date content.
		this.app.workspace.onLayoutReady(() => {
			void this.loader.start().then(() => {
				const count = this.loader.getAll().length;
				const errs = this.loader.getValidationErrors().filter((e) => e.level === "error");
				if (errs.length > 0) {
					new Notice(`Schema: ${count} types loaded, ${errs.length} validation error(s) — see console.`, 5000);
					console.warn("[schema] validation errors:", errs);
				} else {
					console.log(`[schema] loaded ${count} types from ${this.settings.schemaFolder}`);
				}
				this.createCommands.refresh(this.loader.getAll());
				this.typeWatcher.start();
				this.fmLookupRenderer.start();
				console.log(
					`[schema] lookup runtime: ${this.lookups.usingDataview() ? "dataview" : "builtin"}`
				);
			});
		});

		this.registerEvent(
			this.loader.on("schema-changed", ((schemas: TypeSchema[]) => {
				console.log(`[schema] schema-changed: ${schemas.length} types`);
				this.createCommands.refresh(schemas);
			}) as (...data: unknown[]) => unknown)
		);

		this.addCommand({
			id: "reload-schemas",
			name: "Reload schemas",
			callback: async () => {
				await this.loader.fullReload();
				const count = this.loader.getAll().length;
				new Notice(`Schema: reloaded ${count} types.`);
			},
		});

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
			id: "migrate-lookups-to-block",
			name: "Migrate lookups to block mode",
			callback: () => migrateLookupsToBlock(this),
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
		const result = await cleanFrontmatter(this.app, target, schema);
		const moveSummary =
			moveResult && moveResult.from !== moveResult.to ? ` moved → ${moveResult.to}` : "";
		new Notice(
			`Schema: ${schema.name}${moveSummary} · removed ${result.removed.length}, added ${result.added.length}`
		);
	}

	private showLoadedTypes() {
		const schemas = this.loader.getAll();
		if (schemas.length === 0) {
			new Notice("Schema: no types loaded. Check Templates/Objects/.");
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
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
