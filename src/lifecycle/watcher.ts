import { Notice, TFile, type EventRef } from "obsidian";
import type SchemaPlugin from "../main";
import { readTypeKey } from "../util/frontmatter";
import { applyBodyTemplateOnRetype } from "./body-template";
import { getUniversalFields } from "../util/universal";
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
		const typeKey = this.plugin.settings.typeKey;
		for (const file of this.plugin.app.vault.getMarkdownFiles()) {
			const cache = this.plugin.app.metadataCache.getFileCache(file);
			const t = readTypeKey(cache?.frontmatter as Record<string, unknown> | undefined, typeKey);
			if (t) this.lastSeenType.set(file.path, t);
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

	/** Clear and re-populate lastSeenType from current settings.typeKey. Call
	 *  this when the user changes the object-type frontmatter key, so the next
	 *  type-change event compares against values read with the new key. */
	reseed(): void {
		this.lastSeenType.clear();
		const typeKey = this.plugin.settings.typeKey;
		for (const file of this.plugin.app.vault.getMarkdownFiles()) {
			const cache = this.plugin.app.metadataCache.getFileCache(file);
			const t = readTypeKey(cache?.frontmatter as Record<string, unknown> | undefined, typeKey);
			if (t) this.lastSeenType.set(file.path, t);
		}
	}

	private async onChanged(file: TFile): Promise<void> {
		if (!this.plugin.settings.autoReshelveOnTypeChange) return;
		if (this.inFlight.has(file.path)) return;

		const cache = this.plugin.app.metadataCache.getFileCache(file);
		const newType = readTypeKey(
			cache?.frontmatter as Record<string, unknown> | undefined,
			this.plugin.settings.typeKey
		);
		if (!newType) {
			this.lastSeenType.delete(file.path);
			return;
		}

		const prior = this.lastSeenType.get(file.path);
		this.lastSeenType.set(file.path, newType);

		// Skip if first time seeing this file (initial-index event). This guard is
		// also load-bearing for the disambiguated-rename case: if reshelve renames
		// to "Name 2.md" (a path never added to inFlight because we only predicted
		// "Name.md"), the changed event for that new path reaches here with
		// prior === undefined and is correctly ignored as a first sighting.
		if (prior === undefined) return;
		if (prior === newType) return;

		const schema = this.plugin.loader.getResolved(newType);
		if (!schema) {
			new Notice(`Schema: "${newType}" is not a known object type.`);
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
			// Stage 1: rename to the new folder. Failure here means the file
			// stays where it is; bail with a generic error.
			let moveResult: Awaited<ReturnType<typeof reshelveToSchema>> = null;
			try {
				moveResult = await reshelveToSchema(this.plugin.app, file, schema, fm);
			} catch (err) {
				console.error("[schema] reshelve failed:", err);
				// Roll back the lastSeenType update from line above. Otherwise the
				// cache now says this file already has `newType` at its old path, so
				// the next change event short-circuits at the `prior === newType`
				// guard and auto-reshelve never retries - the file is stuck in the
				// wrong folder until the user toggles the type away and back.
				if (prior === undefined) this.lastSeenType.delete(file.path);
				else this.lastSeenType.set(file.path, prior);
				new Notice(`Schema: reshelve failed. See console.`);
				return;
			}

			// After a rename, the TFile's path is updated in-place by Obsidian. Re-fetch.
			const movedFile = this.plugin.app.vault.getAbstractFileByPath(moveResult?.to ?? file.path);
			const target = movedFile instanceof TFile ? movedFile : file;

			// Stage 2: clean frontmatter + apply body template. Failure here is
			// recoverable - the file is in the right folder but with stale YAML.
			// Surface a Notice pointing at the manual recovery command.
			let cleanResult: { removed: string[]; added: string[] };
			try {
				cleanResult = await cleanFrontmatter(
					this.plugin.app,
					target,
					schema,
					getUniversalFields(this.plugin.settings.globalFields),
					this.plugin.settings.typeKey
				);
				await applyBodyTemplateOnRetype(this.plugin, target, schema);
			} catch (err) {
				console.error("[schema] post-reshelve cleanup failed:", err);
				if (moveResult && moveResult.from !== moveResult.to) {
					this.lastSeenType.delete(moveResult.from);
					this.lastSeenType.set(moveResult.to, newType);
				}
				const dest = moveResult?.to ?? target.path;
				new Notice(
					`Schema: reshelved to "${dest}" but cleanup failed. Run "Reshelve and clean active file" to retry. See console.`,
					8000
				);
				return;
			}

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
			new Notice(`Schema: re-classified as "${newType}"${moveSummary}${fieldsSummary}`);
		} catch (err) {
			console.error("[schema] type-change handling failed:", err);
			new Notice(`Schema: object-type-change error. See console.`);
		} finally {
			this.inFlight.delete(originalPath);
			if (predictedDifferent) this.inFlight.delete(predictedPath);
			// In case the actual destination path differs from the prediction
			// (rare - would mean reshelveToSchema disambiguated or the schema
			// folder template resolved differently), also clear file.path.
			if (file.path !== originalPath && file.path !== predictedPath) {
				this.inFlight.delete(file.path);
			}
		}
	}
}
