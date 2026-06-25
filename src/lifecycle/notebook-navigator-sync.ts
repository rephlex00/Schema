import { Notice } from "obsidian";
import type { App } from "obsidian";
import type SchemaPlugin from "../main";
import type { TypeSchema } from "../schema/types";

/**
 * One-way sync: schema type colors and icons -> Notebook Navigator's per-value
 * property styling.
 *
 * Each type contributes a color and icon to its object-type property value
 * (e.g. `type: person` becomes the node `key:type=person`), so notes of
 * different object types render with a matching color and icon in Notebook
 * Navigator's sidebar and file list, mirroring the banner/chip Schema already
 * draws on the note. We push through Notebook Navigator's public metadata API
 * (`app.plugins.plugins["notebook-navigator"].api.metadata.setPropertyMeta`),
 * which updates and persists its own settings, so we never write its data file
 * behind its back. Schema owns the object-type value nodes only: folders, tags,
 * the key-level `key:<typeKey>` node, and every other property are left
 * untouched. Idempotent, and triggered explicitly by the user (command /
 * settings button).
 *
 * Notebook Navigator decides *which* property appears in its navigation (the
 * `propertyKeys` vault-profile setting). That is not part of its API, so we
 * only read it to hint the user when their object-type property isn't enabled
 * there yet.
 */

/** The styling we push for one object-type value node. `null` clears the
 *  attribute in Notebook Navigator; a string sets it; both null leaves the
 *  node present but unstyled (so removing a type's color/icon clears it). */
export interface PropertyMeta {
	/** Notebook Navigator property node id, e.g. `key:type=person`. */
	nodeId: string;
	color: string | null;
	icon: string | null;
}

/** Notebook Navigator's property node id for a single object-type value. The
 *  type name is passed verbatim; Notebook Navigator normalizes case internally. */
export function propertyNodeId(typeKey: string, name: string): string {
	return `key:${typeKey}=${name}`;
}

function readString(v: unknown): string {
	return typeof v === "string" ? v.trim() : "";
}

/**
 * Build the per-type styling to push. One entry per type, always emitted: a
 * type that has lost its color/icon yields `null` for that attribute so the
 * next sync clears it in Notebook Navigator. Pure - safe in tests. Pass
 * resolved schemas so inherited color/icon count (a child with no color of its
 * own shows its ancestor's, matching the note's banner/chip).
 */
export function buildPropertyMeta(schemas: TypeSchema[], typeKey: string): PropertyMeta[] {
	return schemas.map((s) => {
		const color = readString(s.defaults?.color);
		const icon = readString(s.defaults?.icon);
		return {
			nodeId: propertyNodeId(typeKey, s.name),
			color: color === "" ? null : color,
			icon: icon === "" ? null : icon,
		};
	});
}

/**
 * Object-type property nodes Notebook Navigator still holds whose value no
 * longer matches any current type (a renamed or deleted type). These get
 * cleared on the next sync so styling doesn't linger. The key-level
 * `key:<typeKey>` node (no `=value`) and every other property are ignored.
 * Comparison is case-insensitive because Notebook Navigator stores node ids
 * lowercased. Pure.
 */
export function findStalePropertyNodes(
	existingNodeIds: string[],
	typeKey: string,
	currentNames: string[]
): string[] {
	const prefix = `key:${typeKey.toLowerCase()}=`;
	const current = new Set(currentNames.map((n) => n.toLowerCase()));
	const stale = new Set<string>();
	for (const id of existingNodeIds) {
		const lower = id.toLowerCase();
		if (!lower.startsWith(prefix)) continue;
		const value = lower.slice(prefix.length);
		if (value === "") continue;
		if (!current.has(value)) stale.add(id);
	}
	return [...stale];
}

/** Whether the object-type property is enabled as a navigation source in
 *  Notebook Navigator's active vault profile. When we can't introspect the
 *  profiles (older builds), assume it is so we don't nag. Pure. */
export function isTypePropertyInNavigation(
	settings: NotebookNavigatorSettings | undefined,
	typeKey: string
): boolean {
	const profiles = settings?.vaultProfiles;
	if (!Array.isArray(profiles) || profiles.length === 0) return true;
	const active = profiles.find((p) => p.id === settings?.vaultProfile) ?? profiles[0];
	const entry = active?.propertyKeys?.find((k) => k.key === typeKey);
	return Boolean(entry && (entry.showInNavigation || entry.showInList));
}

/**
 * Push every object type's color and icon into Notebook Navigator, clear any
 * stale renamed/deleted type nodes, and report the result via a Notice. No-ops
 * gracefully (with a Notice) when Notebook Navigator isn't installed/enabled.
 */
export async function syncNotebookNavigator(plugin: SchemaPlugin): Promise<void> {
	const { app } = plugin;
	const nn = getNotebookNavigator(app);
	const meta = nn?.api?.metadata;
	if (!nn || !meta || typeof meta.setPropertyMeta !== "function") {
		new Notice(
			"Schema: Notebook Navigator isn't installed or enabled, so there's nothing to sync."
		);
		return;
	}

	try {
		await nn.api?.whenReady?.();
	} catch (e) {
		console.warn("[schema] Notebook Navigator whenReady() rejected; syncing anyway", e);
	}

	// Resolved (not raw) so inherited colors/icons count, matching the banner/chip.
	const typeKey = plugin.settings.typeKey;
	const schemas = plugin.loader.getAllResolved();
	const desired = buildPropertyMeta(schemas, typeKey);
	const stale = findStalePropertyNodes(
		collectPropertyNodeIds(nn.settings),
		typeKey,
		schemas.map((s) => s.name)
	);

	let failures = 0;
	for (const node of desired) {
		try {
			await meta.setPropertyMeta(node.nodeId, { color: node.color, icon: node.icon });
		} catch (e) {
			failures++;
			console.warn(`[schema] couldn't set Notebook Navigator meta for ${node.nodeId}`, e);
		}
	}
	for (const id of stale) {
		try {
			await meta.setPropertyMeta(id, { color: null, icon: null });
		} catch (e) {
			failures++;
			console.warn(`[schema] couldn't clear stale Notebook Navigator meta for ${id}`, e);
		}
	}

	const styled = desired.filter((n) => n.color !== null || n.icon !== null).length;
	let tail = "";
	if (!isTypePropertyInNavigation(nn.settings, typeKey)) {
		tail = `. Add "${typeKey}" as a property in Notebook Navigator's navigation to see them`;
	}
	if (failures > 0) {
		tail += `. ${failures} update${failures === 1 ? "" : "s"} failed (see console)`;
	}
	new Notice(
		`Schema: synced ${styled} object-type style${styled === 1 ? "" : "s"} to Notebook Navigator${tail}.`
	);
}

/** Existing object-type-eligible property node ids Notebook Navigator stores,
 *  unioned across its color and icon maps. */
function collectPropertyNodeIds(settings: NotebookNavigatorSettings | undefined): string[] {
	const ids = new Set<string>();
	for (const key of Object.keys(settings?.propertyColors ?? {})) ids.add(key);
	for (const key of Object.keys(settings?.propertyIcons ?? {})) ids.add(key);
	return [...ids];
}

function getNotebookNavigator(app: App): NotebookNavigatorPlugin | null {
	const plugins = (app as unknown as { plugins?: PluginsApi }).plugins;
	const nn = plugins?.plugins?.["notebook-navigator"] as NotebookNavigatorPlugin | undefined;
	return nn ?? null;
}

// --- Minimal structural view of the slice of Notebook Navigator we touch.
//     Guarded everywhere; no hard dependency on its types. -----------------

interface NotebookNavigatorMetadataApi {
	setPropertyMeta(
		nodeId: string,
		meta: { color?: string | null; icon?: string | null; backgroundColor?: string | null }
	): Promise<void>;
}

interface NotebookNavigatorApi {
	metadata?: NotebookNavigatorMetadataApi;
	whenReady?: () => Promise<void>;
}

interface NotebookNavigatorPropertyKey {
	key: string;
	showInNavigation?: boolean;
	showInList?: boolean;
	showInFileMenu?: boolean;
}

interface NotebookNavigatorVaultProfile {
	id: string;
	propertyKeys?: NotebookNavigatorPropertyKey[];
}

export interface NotebookNavigatorSettings {
	propertyColors?: Record<string, unknown>;
	propertyIcons?: Record<string, unknown>;
	vaultProfile?: string;
	vaultProfiles?: NotebookNavigatorVaultProfile[];
}

interface NotebookNavigatorPlugin {
	api?: NotebookNavigatorApi;
	settings?: NotebookNavigatorSettings;
}

interface PluginsApi {
	plugins?: Record<string, unknown>;
}
