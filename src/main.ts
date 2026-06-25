import { Notice, Plugin, TFile } from "obsidian";
import { exportSchemas, importSchemas } from "./lifecycle/backup";
import { applyBodyTemplateOnRetype } from "./lifecycle/body-template";
import { cleanFrontmatter } from "./lifecycle/clean";
import { CreateCommandRegistry } from "./lifecycle/commands";
import { readTypeKey } from "./util/frontmatter";
import { getUniversalFields } from "./util/universal";
import { FolderMappingWatcher } from "./lifecycle/folder-mapping-watcher";
import { syncGraphColors } from "./lifecycle/graph-colors";
import { syncNotebookNavigator } from "./lifecycle/notebook-navigator-sync";
import { resolveFolder, reshelveToSchema } from "./lifecycle/reshelve";
import { UNIVERSAL_VISUAL_GLOBALS } from "./lifecycle/starter-schemas";
import { TypeChangeWatcher } from "./lifecycle/watcher";
import { registerBlockRenderer } from "./lookup/block-renderer";
import { LookupEngine } from "./lookup/engine";
import { FrontmatterLookupRenderer } from "./lookup/frontmatter-renderer";
import { convertAllToGlobal } from "./schema/convert-all-to-global";
import { foldAutoRefreshedIntoGlobals } from "./schema/migrate-auto-refreshed";
import { SchemaLoader } from "./schema/loader";
import type { FieldSchema, TypeSchema } from "./schema/types";
import { FieldPickerModal } from "./ui/field-edit-modal";
import { confirmAction } from "./ui/prompt-modal";
import { FileExplorerIconsManager } from "./ui/file-explorer-icons";
import { TabTitleManager } from "./ui/tab-title";
import { HiddenPropertiesManager } from "./ui/hidden-properties";
import { QueryPlaygroundModal } from "./ui/query-playground";
import { SchemaSettingsTab } from "./ui/settings-tab";
import { TypeBannerManager } from "./ui/type-banner";
import { TypeChipPropertyManager } from "./ui/type-chip-property";
import { TypedWikilinkSuggest } from "./ui/typed-wikilink-suggest";
import { clearCustomFilters, registerCustomFilter } from "./util/liquid";

/** A folder-mapping entry. The string-form value `"person"` is still accepted
 *  on read and migrated to the object form on first save. */
export interface FolderMapping {
	/** Type to apply to files in this folder. */
	type: string;
	/** When true, applying overrides an existing `type:` on file create. Default
	 *  (false) preserves the type a file already carries - protects template /
	 *  copy-paste flows. On rename, an existing-but-mismatched type is always
	 *  re-classified regardless of this flag (moving a file in is an explicit
	 *  user action). */
	enforce?: boolean;
}

export interface SchemaSettings {
	/** All registered type schemas. The Settings tab is the canonical editor. */
	schemas: TypeSchema[];
	/** Global field library. Every field defined on a type is a reference into
	 *  this registry - the per-type `fields[]` entry carries the name and
	 *  per-usage `promptOnCreate`, and hydration overlays the rest from
	 *  globalFields[name]. There is no per-type field definition. Edits to a
	 *  global field propagate to every type that references it. Auto-promote
	 *  runs on every load to keep the invariant true. */
	globalFields: Record<string, FieldSchema>;
	/** Auto-reshelve a file when its `type:` frontmatter changes. */
	autoReshelveOnTypeChange: boolean;
	/** Folder → mapping. Files created in (or moved into) a mapped folder are
	 *  auto-classified. Most-specific (longest) folder match wins. */
	folderMappings: Record<string, FolderMapping>;
	/** Master toggle for the folder→type auto-classification behavior. */
	autoClassifyOnFolderMatch: boolean;
	/** Show the subtle horizontal type banner at the top of typed-note views. */
	showTypeBanner: boolean;
	/** Extend the banner's object-type color across the file tab and the view
	 *  header (the chrome above the banner) so they read as one colored block.
	 *  Only takes effect while the banner is shown. */
	tintTabAndHeader: boolean;
	/** Replace the `type:` property's plain-text value in the note's properties
	 *  pane with a colored chip mirroring the settings-tab styling. */
	replaceTypePropertyWithChip: boolean;
	/** Show each typed file's type icon next to its name in the file explorer. */
	showFileExplorerIcons: boolean;
	/** Frontmatter property whose value replaces the filename in the tab bar
	 *  (e.g. `title`). Empty means tabs keep showing the filename. Applies to
	 *  every note that carries the property, regardless of object type. */
	tabTitleProperty: string;
	/** Prefix the tab bar entry with the note's type icon, colored with the type
	 *  color. Requires the note to be typed. */
	showTabIcon: boolean;
	/** User-defined Liquid filters. Each entry's value is a JS body that takes a
	 *  `value` parameter and returns the transformed string. Compiled at startup
	 *  and on edit. WARNING: bodies execute as JS - only add code you trust. */
	customFilters: Record<string, string>;
	/** Vault-relative folder that body-template path suggestions search under.
	 *  Empty string means search the whole vault. Subfolders are included. */
	templatesFolder: string;
	/** When true and a type has no explicit bodyTemplate, look for a file
	 *  named "<typeName>.md" anywhere under `templatesFolder` and use it. The
	 *  explicit bodyTemplate always wins when set. */
	autoBodyTemplateByTypeName: boolean;
	/** Frontmatter key Schema reads to know a note's object type. Default
	 *  `"type"`. Changing this is forward-only: existing notes keep their old
	 *  key until manually edited. */
	typeKey: string;
	/** Insert a wikilink to a newly-created object at the cursor of the note the
	 *  create command was issued from (e.g. via the slash menu). */
	linkOnCreate: boolean;
	/** Where the new note opens when created from an editor with linkOnCreate on:
	 *  a new tab, a split pane, or not at all (focus stays in the source note). */
	linkOnCreateOpen: "tab" | "split" | "stay";
}

const DEFAULT_SETTINGS: SchemaSettings = {
	schemas: [],
	globalFields: { ...UNIVERSAL_VISUAL_GLOBALS },
	autoReshelveOnTypeChange: true,
	folderMappings: {},
	autoClassifyOnFolderMatch: true,
	showTypeBanner: true,
	tintTabAndHeader: false,
	replaceTypePropertyWithChip: true,
	showFileExplorerIcons: false,
	tabTitleProperty: "",
	showTabIcon: false,
	customFilters: {},
	templatesFolder: "",
	autoBodyTemplateByTypeName: false,
	typeKey: "type",
	linkOnCreate: true,
	linkOnCreateOpen: "tab",
};

export default class SchemaPlugin extends Plugin {
	settings: SchemaSettings = DEFAULT_SETTINGS;
	loader!: SchemaLoader;
	createCommands!: CreateCommandRegistry;
	typeWatcher!: TypeChangeWatcher;
	folderWatcher!: FolderMappingWatcher;
	lookups!: LookupEngine;
	fmLookupRenderer!: FrontmatterLookupRenderer;
	typeBanner!: TypeBannerManager;
	typeChipProperty!: TypeChipPropertyManager;
	fileExplorerIcons!: FileExplorerIconsManager;
	tabTitle!: TabTitleManager;
	hiddenProperties!: HiddenPropertiesManager;
	/** Set by SchemaSettingsTab when the user opens Settings → Schema. Call to
	 *  jump between sub-panes; `anchor` scrolls to / expands a row whose
	 *  `data-schema-anchor` attribute matches. No-op when settings are closed. */
	navigateSettings: ((paneId: string, anchor?: string) => void) | null = null;
	/** Shared "currently being mutated by a watcher" set. Both TypeChangeWatcher
	 *  and FolderMappingWatcher add the file path here while writing, so the
	 *  other watcher's listener no-ops on its own write. */
	readonly lifecycleInFlight = new Set<string>();

	async onload() {
		await this.loadSettings();
		this.applyCustomFilters();

		this.loader = new SchemaLoader();
		this.createCommands = new CreateCommandRegistry(this);
		this.typeWatcher = new TypeChangeWatcher(this);
		this.folderWatcher = new FolderMappingWatcher(this);
		this.lookups = new LookupEngine(this.app);
		this.fmLookupRenderer = new FrontmatterLookupRenderer(this);
		this.typeBanner = new TypeBannerManager(this);
		this.typeChipProperty = new TypeChipPropertyManager(this);
		this.fileExplorerIcons = new FileExplorerIconsManager(this);
		this.tabTitle = new TabTitleManager(this);
		this.hiddenProperties = new HiddenPropertiesManager(this);

		registerBlockRenderer(this);

		this.addSettingTab(new SchemaSettingsTab(this.app, this));
		this.registerEditorSuggest(new TypedWikilinkSuggest(this.app, this));

		this.app.workspace.onLayoutReady(() => {
			this.loader.start(this.settings.schemas, this.settings.globalFields, this.settings.typeKey);
			const count = this.loader.getAll().length;
			const errs = this.loader.getValidationErrors().filter((e) => e.level === "error");
			if (errs.length > 0) {
				new Notice(
					`Schema: ${count} object types loaded, ${errs.length} validation error(s). See console.`,
					5000
				);
				console.warn("[schema] validation errors:", errs);
			} else {
				console.log(`[schema] loaded ${count} object types from settings`);
			}
			this.createCommands.refresh(this.loader.getAll());
			this.typeWatcher.start();
			this.folderWatcher.start();
			this.fmLookupRenderer.start();
			if (this.settings.showTypeBanner) this.typeBanner.start();
			if (this.settings.replaceTypePropertyWithChip) this.typeChipProperty.start();
			if (this.settings.showFileExplorerIcons) this.fileExplorerIcons.start();
			if (this.settings.tabTitleProperty.trim() !== "" || this.settings.showTabIcon)
				this.tabTitle.start();
			this.hiddenProperties.start();
			console.log(
				`[schema] lookup runtime: ${this.lookups.usingDataview() ? "dataview" : "builtin"}`
			);
		});

		this.registerEvent(
			this.loader.on("schema-changed", ((schemas: TypeSchema[]) => {
				console.log(`[schema] schema-changed: ${schemas.length} types`);
				this.createCommands.refresh(schemas);
				// Persist schema changes to data.json as thin global-reference stubs
				// (not the hydrated full-shape fields), so the load-time auto-promote
				// pass stays a no-op and doesn't write a backup on every load.
				this.settings.schemas = this.loader.getAllForPersist();
				void this.saveSettings();
			}) as (...data: unknown[]) => unknown)
		);

		this.addCommand({
			id: "show-loaded-types",
			name: "Show loaded object types",
			callback: () => this.showLoadedTypes(),
		});

		this.addCommand({
			id: "query-playground",
			name: "Open query playground",
			callback: () => new QueryPlaygroundModal(this).open(),
		});

		this.addCommand({
			id: "export-types-json",
			name: "Export object types to JSON",
			callback: () => void exportSchemas(this),
		});

		this.addCommand({
			id: "import-types-json",
			name: "Import object types from JSON",
			callback: () => void importSchemas(this),
		});

		this.addCommand({
			id: "sync-graph-colors",
			name: "Sync graph colors to object-type colors",
			callback: () => void syncGraphColors(this),
		});

		this.addCommand({
			id: "sync-notebook-navigator-styles",
			name: "Sync Notebook Navigator colors and icons to object types",
			callback: () => void syncNotebookNavigator(this),
		});

		this.addCommand({
			id: "refresh-frontmatter-lookups",
			name: "Refresh frontmatter lookups (vault-wide)",
			callback: async () => {
				const result = await this.fmLookupRenderer.refreshAll();
				new Notice(
					`Schema: refreshed lookups. ${result.updated} files updated, ${result.errors} errors.`
				);
			},
		});

		this.addCommand({
			id: "edit-field",
			name: "Edit property",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || file.extension !== "md") return false;
				const cache = this.app.metadataCache.getFileCache(file);
				const t = readTypeKey(cache?.frontmatter as Record<string, unknown> | undefined, this.settings.typeKey);
				if (!t) return false;
				const schema = this.loader.getResolved(t);
				if (!schema) return false;
				if (checking) return true;
				new FieldPickerModal(this, file, schema).open();
				return true;
			},
		});

		this.addCommand({
			id: "convert-all-to-global",
			name: "Convert all local properties to global properties",
			callback: () => void this.runConvertAllToGlobal(),
		});

		this.addCommand({
			id: "reshelve-active",
			name: "Reshelve and clean active file",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || file.extension !== "md") return false;
				const cache = this.app.metadataCache.getFileCache(file);
				const t = readTypeKey(cache?.frontmatter as Record<string, unknown> | undefined, this.settings.typeKey);
				if (!t) return false;
				const schema = this.loader.getResolved(t);
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
		this.folderWatcher?.stop();
		this.typeBanner?.stop();
		this.typeChipProperty?.stop();
		this.fileExplorerIcons?.stop();
		this.tabTitle?.stop();
		this.hiddenProperties?.stop();
		this.loader?.stop();
		console.log("[schema] Plugin unloaded.");
	}

	private async runManualReshelve(file: TFile, schema: TypeSchema): Promise<void> {
		const resolved = this.loader.getResolved(schema.name) ?? schema;
		const cache = this.app.metadataCache.getFileCache(file);
		const fm = (cache?.frontmatter as Record<string, unknown> | undefined) ?? {};

		// Hold the shared lifecycle lock across the whole rename + clean + body-
		// template sequence so the type/folder watchers don't react to our own
		// writes. Lock the original and predicted paths before the move (the move
		// fires a rename event mid-flight), then the actual destination after.
		const originalPath = file.path;
		const targetFolder = resolveFolder(resolved, fm);
		const predictedPath = targetFolder ? `${targetFolder}/${file.name}` : originalPath;
		const locked = new Set<string>();
		const lock = (p: string | undefined | null) => {
			if (p && !locked.has(p)) {
				locked.add(p);
				this.lifecycleInFlight.add(p);
			}
		};
		lock(originalPath);
		lock(predictedPath);
		try {
			const moveResult = await reshelveToSchema(this.app, file, resolved, fm);
			lock(moveResult?.to);
			lock(file.path);
			const moved =
				moveResult && moveResult.from !== moveResult.to
					? this.app.vault.getAbstractFileByPath(moveResult.to)
					: file;
			const target = moved instanceof TFile ? moved : file;
			const result = await cleanFrontmatter(this.app, target, resolved, getUniversalFields(this.settings.globalFields), this.settings.typeKey);
			await applyBodyTemplateOnRetype(this, target, resolved);
			const moveSummary =
				moveResult && moveResult.from !== moveResult.to ? ` moved → ${moveResult.to}` : "";
			new Notice(
				`Schema: ${schema.name}${moveSummary} · removed ${result.removed.length}, added ${result.added.length}`
			);
		} finally {
			for (const p of locked) this.lifecycleInFlight.delete(p);
		}
	}

	private showLoadedTypes() {
		const schemas = this.loader.getAll();
		if (schemas.length === 0) {
			new Notice("Schema: no object types loaded. Add some via Settings → Schema.");
			return;
		}
		const lines = schemas.map((s) => {
			const folder = s.folder ?? "(no folder)";
			const fields = s.fields.length;
			const lookups = s.lookups.length;
			const ext = s.extends ? ` extends ${s.extends}` : "";
			return `${s.name}${ext} → ${folder} · ${fields} properties · ${lookups} lookups`;
		});
		const summary = `${schemas.length} object types loaded`;
		console.log(`[schema] ${summary}:\n  ${lines.join("\n  ")}`);
		const errs = this.loader.getValidationErrors();
		if (errs.length > 0) {
			console.log("[schema] validation issues:", errs);
		}
		new Notice(`Schema: ${summary}. See console for details.`);
	}

	async loadSettings() {
		const loaded = ((await this.loadData()) ?? {}) as Partial<typeof DEFAULT_SETTINGS>;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);

		// Snapshot the ORIGINAL data before any migration mutates it, so a single
		// pre-migration backup is faithful. (The previous per-migration backups
		// each re-read the on-disk file, capturing already-migrated state, and
		// raced un-awaited saves.) Migrations now mutate `this.settings` in memory
		// and report whether they changed anything; one backup + one save happen
		// here, only when something actually changed.
		const originalSnapshot = JSON.stringify(loaded, null, 2);
		let mutated = this.sanitizeTypeKey();
		mutated = this.migrateFolderMappings() || mutated;
		mutated = (await this.migrateAutoRefreshedToGlobal()) || mutated;
		mutated = (await this.ensureAllFieldsGlobal()) || mutated;

		if (mutated) {
			await this.writeTimestampedBackup("pre-migration", originalSnapshot);
			await this.saveSettings();
		}
	}

	/** Guard against a corrupted / hand-edited data.json that holds an empty
	 *  or non-string typeKey, which would silently make every note untyped.
	 *  Returns whether it changed the value. */
	private sanitizeTypeKey(): boolean {
		const raw = this.settings.typeKey as unknown;
		if (typeof raw !== "string" || raw.trim().length === 0) {
			this.settings.typeKey = "type";
			return true;
		}
		return false;
	}

	/** Load-time migration: enforce the "every field is global" invariant by
	 *  running convertAllToGlobal. Singletons promote, conflicts pick the
	 *  most-common shape and surface losers via the validator. Idempotent  - 
	 *  once every field has a matching global with matching shape, this is a
	 *  no-op. Writes a pre-migration backup the first time it mutates. */
	private async ensureAllFieldsGlobal(): Promise<boolean> {
		const result = convertAllToGlobal(this.settings.schemas, this.settings.globalFields);
		if (!result.changed) return false;
		this.settings.schemas = result.schemas;
		this.settings.globalFields = result.globalFields;
		if (result.conflicts.length > 0) {
			console.warn(
				`[schema] load-time auto-promote: ${result.promoted} promoted, ${result.linked} normalized, ${result.conflicts.length} shape conflict(s). See Settings → Schema validation.`,
				result.conflicts
			);
		} else {
			console.log(
				`[schema] load-time auto-promote: ${result.promoted} promoted, ${result.linked} normalized.`
			);
		}
		return true;
	}

	/** Manual command: convert every local field to a global field where shapes
	 *  permit. Reuses existing globals; the most-common shape per name wins on
	 *  conflict, with mismatches reported to the console. Writes a snapshot to
	 *  `data.json.pre-convert-all.<timestamp>.bak` before mutating. */
	private async runConvertAllToGlobal(): Promise<void> {
		const ok = await confirmAction(
			this.app,
			"Convert every local property to a global property where possible? Existing globals are reused. If two object types use the same name with different shapes, the most-common shape wins and the others stay local. A snapshot of data.json is written before changes."
		);
		if (!ok) return;

		const result = convertAllToGlobal(this.settings.schemas, this.settings.globalFields);
		if (!result.changed) {
			new Notice("Schema: nothing to convert. Every property is already global or already linked.");
			return;
		}

		await this.writeTimestampedBackup("convert-all");

		this.settings.schemas = result.schemas;
		this.settings.globalFields = result.globalFields;
		await this.saveSettings();
		this.loader.updateAll({
			schemas: result.schemas,
			globalFields: result.globalFields,
		});

		if (result.conflicts.length > 0) {
			console.log("[schema] convert-all-to-global shape conflicts:", result.conflicts);
		}
		const conflictTail =
			result.conflicts.length > 0
				? ` (${result.conflicts.length} shape conflict${result.conflicts.length === 1 ? "" : "s"} left local; see console)`
				: "";
		new Notice(
			`Schema: promoted ${result.promoted} global field${result.promoted === 1 ? "" : "s"}, linked ${result.linked} usage${result.linked === 1 ? "" : "s"}${conflictTail}.`
		);
	}

	/** Generic backup: write a snapshot to data.json.<reason>.<isoStamp>.bak in the
	 *  plugin's config dir. Pass `content` to snapshot an explicit value (e.g. the
	 *  in-memory pre-migration state); omit it to copy the current on-disk
	 *  data.json. Each invocation produces a distinct snapshot. */
	private async writeTimestampedBackup(reason: string, content?: string): Promise<void> {
		try {
			const path = `${this.app.vault.configDir}/plugins/${this.manifest.id}/data.json`;
			const adapter = this.app.vault.adapter;
			let data: string;
			if (content !== undefined) {
				data = content;
			} else {
				if (!(await adapter.exists(path))) return;
				data = await adapter.read(path);
			}
			const stamp = new Date().toISOString().replace(/[:.]/g, "-");
			const bakPath = `${path}.${reason}.${stamp}.bak`;
			await adapter.write(bakPath, data);
			console.log(`[schema] wrote backup to ${bakPath}`);
		} catch (e) {
			console.error(`[schema] failed to write ${reason} backup:`, e);
		}
	}

	/** Normalize the legacy `folderMappings: Record<string, string>` shape to the
	 *  object form `{ type, enforce? }`. Idempotent. Returns whether it changed
	 *  anything (persistence is handled once by loadSettings). */
	private migrateFolderMappings(): boolean {
		const mappings = this.settings.folderMappings as unknown;
		if (!mappings || typeof mappings !== "object") {
			const had = mappings !== undefined && JSON.stringify(mappings) !== "{}";
			this.settings.folderMappings = {};
			return had;
		}
		let changed = false;
		const next: Record<string, FolderMapping> = {};
		for (const [k, v] of Object.entries(mappings as Record<string, unknown>)) {
			// Drop empty keys: an empty mapping folder would match the vault root
			// (and via prefix the whole vault), auto-classifying everything.
			if (k.trim().replace(/\/+$/, "") === "") {
				changed = true;
				continue;
			}
			if (typeof v === "string") {
				next[k] = { type: v };
				changed = true;
			} else if (v && typeof v === "object" && typeof (v as { type?: unknown }).type === "string") {
				next[k] = v as FolderMapping;
			} else {
				changed = true;
			}
		}
		this.settings.folderMappings = next;
		return changed;
	}

	/** Load-time migration: fold the legacy `autoRefreshedFields` list into
	 *  `globalFields` as universal Icon/Color (or Input) properties, then drop
	 *  the stray setting. Per-type values stay in each schema's `defaults`.
	 *  Idempotent; writes a backup once when it actually promotes a property. */
	private async migrateAutoRefreshedToGlobal(): Promise<boolean> {
		const bag = this.settings as unknown as { autoRefreshedFields?: unknown };
		const legacy = bag.autoRefreshedFields;
		if (legacy === undefined) return false;
		const { globalFields, changed } = foldAutoRefreshedIntoGlobals(
			this.settings.globalFields,
			legacy
		);
		if (changed) {
			this.settings.globalFields = globalFields;
			console.log(
				"[schema] migrated auto-refreshed properties (icon/color) into global properties as universal."
			);
		}
		// Drop the stray legacy key even when nothing folded - that itself is a
		// change worth persisting.
		delete bag.autoRefreshedFields;
		return true;
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	/** Re-register every entry in `customFilters` against the Liquid renderer.
	 *  Called on startup and whenever the custom-filter editor commits. Bad
	 *  bodies log a console error and are skipped; the renderer falls back to
	 *  the built-in filter set for that name (or passes the value through). */
	applyCustomFilters(): void {
		clearCustomFilters();
		for (const [name, body] of Object.entries(this.settings.customFilters ?? {})) {
			if (!name || !body.trim()) continue;
			const result = registerCustomFilter(name, body);
			if (!result.ok) {
				console.error(`[schema] failed to register custom filter "${name}":`, result.error);
			}
		}
	}
}
