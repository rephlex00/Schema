import { Notice, TFile, type EventRef } from "obsidian";
import type SchemaPlugin from "../main";
import { cleanFrontmatter } from "./clean";
import { resolveFolder, reshelveToSchema } from "./reshelve";

/**
 * Watches `metadataCache.on("changed")` for `type:` value changes and runs the
 * reshelve + clean pipeline atomically.
 *
 * State: keeps a per-file `lastSeenType` cache so changes that don't actually
 * alter the type are no-ops. Also short-circuits while it's actively reshelving
 * a file so its own writes don't trigger a reentrant cycle.
 */
export class TypeChangeWatcher {
	private readonly plugin: SchemaPlugin;
	private readonly lastSeenType = new Map<string, string>();
	private ref: EventRef | null = null;

	constructor(plugin: SchemaPlugin) {
		this.plugin = plugin;
	}

	/** Shared in-flight set with FolderMappingWatcher. Either watcher locks the
	 *  path while it's writing so the other doesn't react to its own write. */
	private get inFlight(): Set<string> {
		return this.plugin.lifecycleInFlight;
	}

	start(): void {
		// Seed the cache with current types so the FIRST change event after
		// startup is comparing against the real prior value.
		for (const file of this.plugin.app.vault.getMarkdownFiles()) {
			const cache = this.plugin.app.metadataCache.getFileCache(file);
			const t = cache?.frontmatter?.type;
			if (typeof t === "string") this.lastSeenType.set(file.path, t);
		}

		this.ref = this.plugin.app.metadataCache.on("changed", (file) => {
			void this.onChanged(file);
		});
	}

	stop(): void {
		if (this.ref) {
			this.plugin.app.metadataCache.offref(this.ref);
			this.ref = null;
		}
		this.lastSeenType.clear();
	}

	private async onChanged(file: TFile): Promise<void> {
		if (!this.plugin.settings.autoReshelveOnTypeChange) return;
		if (this.inFlight.has(file.path)) return;

		const cache = this.plugin.app.metadataCache.getFileCache(file);
		const newType = cache?.frontmatter?.type;
		if (typeof newType !== "string" || newType.length === 0) {
			this.lastSeenType.delete(file.path);
			return;
		}

		const prior = this.lastSeenType.get(file.path);
		this.lastSeenType.set(file.path, newType);

		// Skip if first time seeing this file (initial-index event).
		if (prior === undefined) return;
		if (prior === newType) return;

		const schema = this.plugin.loader.getResolved(newType);
		if (!schema) {
			new Notice(`Schema: type "${newType}" is not a known type.`);
			return;
		}

		const fm = (cache?.frontmatter as Record<string, unknown> | undefined) ?? {};

		// Lock BOTH the old and the predicted new path before kicking off the
		// rename, so the FolderMappingWatcher can't react to our own
		// vault.rename event during the window between renameFile firing and
		// our finally block running.
		const originalPath = file.path;
		const targetFolder = resolveFolder(schema, fm);
		const predictedPath = targetFolder
			? `${targetFolder.replace(/\/+$/, "")}/${file.name}`
			: originalPath;
		this.inFlight.add(originalPath);
		const predictedDifferent = predictedPath !== originalPath;
		if (predictedDifferent) this.inFlight.add(predictedPath);

		try {
			const moveResult = await reshelveToSchema(this.plugin.app, file, schema, fm);
			// After a rename, the TFile's path is updated in-place by Obsidian. Re-fetch.
			const movedFile = this.plugin.app.vault.getAbstractFileByPath(moveResult?.to ?? file.path);
			const target = movedFile instanceof TFile ? movedFile : file;

			const cleanResult = await cleanFrontmatter(
				this.plugin.app,
				target,
				schema,
				this.plugin.settings.autoRefreshedFields
			);

			// Update lastSeenType for the new path (file.path got mutated by rename).
			if (moveResult && moveResult.from !== moveResult.to) {
				this.lastSeenType.delete(moveResult.from);
				this.lastSeenType.set(moveResult.to, newType);
			}

			const moveSummary =
				moveResult && moveResult.from !== moveResult.to
					? ` moved → ${moveResult.to}`
					: "";
			const fieldsSummary =
				cleanResult.removed.length > 0 || cleanResult.added.length > 0
					? ` · removed ${cleanResult.removed.length}, added ${cleanResult.added.length}`
					: "";
			new Notice(`Schema: retyped to "${newType}"${moveSummary}${fieldsSummary}`);
		} catch (err) {
			console.error("[schema] type-change handling failed:", err);
			new Notice(`Schema: type-change error — see console.`);
		} finally {
			this.inFlight.delete(originalPath);
			if (predictedDifferent) this.inFlight.delete(predictedPath);
			// In case the actual destination path differs from the prediction
			// (rare — would mean reshelveToSchema disambiguated or the schema
			// folder template resolved differently), also clear file.path.
			if (file.path !== originalPath && file.path !== predictedPath) {
				this.inFlight.delete(file.path);
			}
		}
	}
}
