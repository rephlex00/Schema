import { Notice, TAbstractFile, TFile, type EventRef } from "obsidian";
import type SchemaPlugin from "../main";
import { cleanFrontmatter } from "./clean";

const CREATE_DEFER_MS = 100;

/**
 * Auto-classifies files based on their containing folder.
 *
 * On `vault.on('create')` (debounced 100ms so frontmatter has a chance to be
 * indexed): if the new file has no `type:` frontmatter and lands in a folder
 * mapped to a type, set its type to that and run cleanFrontmatter to populate
 * defaults.
 *
 * On `vault.on('rename')`: if the file moves to a different folder than it
 * was in, look up the new folder's mapping. If found and the file's current
 * type differs from (or is missing) the mapped type, apply.
 *
 * Race-condition coordination: shares `plugin.lifecycleInFlight: Set<string>`
 * with TypeChangeWatcher. Either watcher locks the path while writing so the
 * other no-ops on its own write.
 *
 * Most-specific match: if multiple mapped folders match (e.g. `Moments` and
 * `Moments/Events`), the longest folder wins.
 */
export class FolderMappingWatcher {
	private readonly plugin: SchemaPlugin;
	private refs: EventRef[] = [];

	constructor(plugin: SchemaPlugin) {
		this.plugin = plugin;
	}

	private get inFlight(): Set<string> {
		return this.plugin.lifecycleInFlight;
	}

	start(): void {
		this.refs.push(
			this.plugin.app.vault.on("create", (file) => {
				if (!this.isMd(file)) return;
				// Defer slightly so the metadataCache has a chance to populate.
				window.setTimeout(() => this.onCreate(file as TFile), CREATE_DEFER_MS);
			}),
			this.plugin.app.vault.on("rename", (file, oldPath) => {
				if (!this.isMd(file)) return;
				void this.onRename(file as TFile, oldPath);
			})
		);
	}

	stop(): void {
		for (const ref of this.refs) this.plugin.app.vault.offref(ref);
		this.refs = [];
	}

	private isMd(f: TAbstractFile): boolean {
		return f instanceof TFile && f.extension === "md";
	}

	private async onCreate(file: TFile): Promise<void> {
		if (!this.plugin.settings.autoClassifyOnFolderMatch) return;
		if (this.inFlight.has(file.path)) return;

		const cache = this.plugin.app.metadataCache.getFileCache(file);
		const currentType = cache?.frontmatter?.type;
		// Don't overwrite an existing type on create — protects template-driven flows.
		if (typeof currentType === "string" && currentType.length > 0) return;

		const mapped = this.matchFolder(parentFolder(file.path));
		if (!mapped) return;

		await this.applyType(file, mapped);
	}

	private async onRename(file: TFile, oldPath: string): Promise<void> {
		if (!this.plugin.settings.autoClassifyOnFolderMatch) return;
		if (this.inFlight.has(file.path)) return;

		const oldFolder = parentFolder(oldPath);
		const newFolder = parentFolder(file.path);
		if (oldFolder === newFolder) return; // pure rename within same folder

		const mapped = this.matchFolder(newFolder);
		if (!mapped) return;

		const cache = this.plugin.app.metadataCache.getFileCache(file);
		const currentType = cache?.frontmatter?.type;
		if (currentType === mapped) return;

		await this.applyType(file, mapped);
	}

	/** Find the folder mapping with the longest matching prefix. */
	private matchFolder(folder: string): string | null {
		const mappings = this.plugin.settings.folderMappings;
		let best: string | null = null;
		let bestLen = -1;
		for (const [mappedFolder, type] of Object.entries(mappings)) {
			const norm = mappedFolder.replace(/\/+$/, "");
			if (folder === norm || (norm !== "" && folder.startsWith(norm + "/"))) {
				if (norm.length > bestLen) {
					bestLen = norm.length;
					best = type;
				}
			}
		}
		return best;
	}

	/** Set type and clean frontmatter, holding the inFlight lock. */
	private async applyType(file: TFile, typeName: string): Promise<void> {
		const schema = this.plugin.loader.get(typeName);
		if (!schema) {
			new Notice(`Schema: folder maps to unknown type "${typeName}".`);
			return;
		}
		this.inFlight.add(file.path);
		try {
			await this.plugin.app.fileManager.processFrontMatter(file, (fm) => {
				fm.type = typeName;
			});
			await cleanFrontmatter(
				this.plugin.app,
				file,
				schema,
				this.plugin.settings.autoRefreshedFields
			);
			new Notice(`Schema: classified ${file.basename} as "${typeName}".`);
		} catch (err) {
			console.error("[schema] folder-mapping classify failed:", err);
		} finally {
			this.inFlight.delete(file.path);
		}
	}
}

function parentFolder(path: string): string {
	const idx = path.lastIndexOf("/");
	return idx === -1 ? "" : path.slice(0, idx);
}
