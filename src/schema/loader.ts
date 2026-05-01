import { Events, type App, type EventRef, type TAbstractFile, TFile } from "obsidian";
import { parseFileClass, typeNameFromPath } from "./parser";
import type { TypeSchema, ValidationError } from "./types";
import { validateAll } from "./validator";

export interface SchemaLoaderOptions {
	/** Vault-relative folder where fileClass definitions live. */
	schemaFolder: string;
}

const RELOAD_DEBOUNCE_MS = 150;

/**
 * Reads and watches the user's fileClass definitions, exposing them as a typed
 * in-memory map. Emits `schema-loaded` after the initial scan and `schema-changed`
 * whenever a file under `schemaFolder` is added/modified/deleted.
 *
 * Events are emitted on this instance (subclass of Events) — listeners attach
 * via `loader.on("schema-loaded", () => ...)`.
 */
export class SchemaLoader extends Events {
	private readonly app: App;
	private readonly schemaFolder: string;
	private readonly schemas = new Map<string, TypeSchema>();
	private lastErrors: ValidationError[] = [];
	private reloadTimer: number | null = null;
	private vaultRefs: EventRef[] = [];

	constructor(app: App, options: SchemaLoaderOptions) {
		super();
		this.app = app;
		this.schemaFolder = options.schemaFolder.replace(/\/$/, "");
	}

	/** Returns a snapshot of currently-loaded schemas. */
	getAll(): TypeSchema[] {
		return Array.from(this.schemas.values());
	}

	/** Returns one schema by type name, or undefined. */
	get(typeName: string): TypeSchema | undefined {
		return this.schemas.get(typeName);
	}

	/** Returns the most recent validation errors from the last full scan. */
	getValidationErrors(): ValidationError[] {
		return [...this.lastErrors];
	}

	/** Returns the configured schema folder (vault-relative). */
	getSchemaFolder(): string {
		return this.schemaFolder;
	}

	/**
	 * Initial scan + start watching. Idempotent.
	 */
	async start(): Promise<void> {
		await this.fullReload();

		this.vaultRefs.push(
			this.app.vault.on("create", (file) => this.onVaultEvent(file)),
			this.app.vault.on("modify", (file) => this.onVaultEvent(file)),
			this.app.vault.on("delete", (file) => this.onVaultEvent(file)),
			this.app.vault.on("rename", (file, oldPath) => this.onVaultEvent(file, oldPath))
		);
	}

	/** Stop watching and clear in-memory state. */
	stop(): void {
		for (const ref of this.vaultRefs) this.app.vault.offref(ref);
		this.vaultRefs = [];
		if (this.reloadTimer != null) {
			window.clearTimeout(this.reloadTimer);
			this.reloadTimer = null;
		}
		this.schemas.clear();
		this.lastErrors = [];
	}

	/** Force a full re-scan of the schema folder. */
	async fullReload(): Promise<void> {
		this.schemas.clear();
		const files = this.collectSchemaFiles();
		for (const file of files) {
			await this.loadOne(file);
		}
		this.runValidation();
		this.trigger("schema-loaded", this.getAll());
	}

	private collectSchemaFiles(): TFile[] {
		const folder = this.schemaFolder;
		return this.app.vault
			.getMarkdownFiles()
			.filter((f) => f.path === folder || f.path.startsWith(folder + "/"));
	}

	private async loadOne(file: TFile): Promise<void> {
		const source = await this.app.vault.cachedRead(file);
		const schema = parseFileClass(file.path, source);
		if (schema) this.schemas.set(schema.name, schema);
	}

	private isSchemaFile(file: TAbstractFile): boolean {
		if (!(file instanceof TFile)) return false;
		if (file.extension !== "md") return false;
		const folder = this.schemaFolder;
		return file.path === folder || file.path.startsWith(folder + "/");
	}

	private onVaultEvent(file: TAbstractFile, oldPath?: string): void {
		// Trigger when either the new or old path falls inside the schema folder.
		const inFolder = this.isSchemaFile(file);
		const wasInFolder =
			oldPath != null &&
			(oldPath === this.schemaFolder || oldPath.startsWith(this.schemaFolder + "/"));
		if (!inFolder && !wasInFolder) return;
		this.scheduleReload();
	}

	private scheduleReload(): void {
		if (this.reloadTimer != null) window.clearTimeout(this.reloadTimer);
		this.reloadTimer = window.setTimeout(() => {
			this.reloadTimer = null;
			void this.fullReload().then(() => this.trigger("schema-changed", this.getAll()));
		}, RELOAD_DEBOUNCE_MS);
	}

	private runValidation(): void {
		const result = validateAll(this.schemas);
		this.lastErrors = result.errors;
	}
}

// Helper kept for callers that want to derive a name without instantiating a loader.
export { typeNameFromPath };
