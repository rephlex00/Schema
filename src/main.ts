import { Notice, Plugin } from "obsidian";
import { CreateCommandRegistry } from "./lifecycle/commands";
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

	async onload() {
		await this.loadSettings();

		this.loader = new SchemaLoader(this.app, {
			schemaFolder: this.settings.schemaFolder,
		});
		this.createCommands = new CreateCommandRegistry(this);

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

		console.log("[schema] Plugin loaded.");
	}

	onunload() {
		this.loader?.stop();
		console.log("[schema] Plugin unloaded.");
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
