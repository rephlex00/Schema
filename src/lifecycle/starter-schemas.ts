import { Notice } from "obsidian";
import type SchemaPlugin from "../main";
import type { FieldSchema, TypeSchema } from "../schema/types";

/**
 * Universal visual-identity globals. Seeded on fresh installs (via
 * DEFAULT_SETTINGS) and ensured on starter import so every object type carries
 * an icon and color, each editable with the dedicated picker widgets.
 */
export const UNIVERSAL_VISUAL_GLOBALS: Record<string, FieldSchema> = {
	icon: { name: "icon", type: "Icon", universal: true },
	color: { name: "color", type: "Color", universal: true },
};

/**
 * A small bundled set of starter types that demonstrate the plugin's main
 * features: folder + filename templating, promptOnCreate, File/MultiFile
 * targets, and inverse links (person ↔ moment).
 *
 * Shown in the empty-state walkthrough as "Import starter schemas." Imported
 * types are merged with existing schemas; same-name collisions are skipped so
 * the import is non-destructive.
 */
export const STARTER_SCHEMAS: TypeSchema[] = [
	{
		name: "person",
		tags: ["type/person"],
		folder: "People",
		filename: "{{firstname}} {{lastname}}",
		fields: [
			{ name: "firstname", type: "Input", promptOnCreate: "First name" },
			{ name: "lastname", type: "Input", promptOnCreate: "Last name" },
			{ name: "email", type: "Input" },
			{ name: "notes", type: "Input" },
		],
		lookups: [],
		defaults: { icon: "user", color: "#3b82f6" },
	},
	{
		name: "moment",
		tags: ["type/moment"],
		folder: "Moments/{{date:YYYY}}",
		filename: "{{date:YYYYMMDD-HHmm}}",
		fields: [
			{ name: "summary", type: "Input", promptOnCreate: "What happened?" },
			{ name: "people", type: "MultiFile", target: "person", inverse: "moments_with_me" },
		],
		lookups: [],
		defaults: { icon: "calendar", color: "#f59e0b" },
	},
	{
		name: "book",
		tags: ["type/book"],
		folder: "Books",
		filename: "{{title}}",
		fields: [
			{ name: "title", type: "Input", promptOnCreate: "Book title" },
			{ name: "author", type: "File", target: "person" },
			{ name: "rating", type: "Number" },
			{ name: "finished", type: "Boolean" },
		],
		lookups: [],
		defaults: { icon: "book", color: "#02cc16" },
	},
];

/**
 * Merge starter schemas into the loader. Same-name types already in the
 * registry are skipped (non-destructive). Reports the import via Notice.
 */
export function importStarterSchemas(plugin: SchemaPlugin): void {
	// Ensure the universal visual globals exist so the starter `defaults`
	// (icon/color) are applied to new notes of these types. Done before the
	// "nothing to import" check so a user who deleted icon/color can restore
	// them by re-importing even when every starter type already exists.
	const globals = { ...plugin.settings.globalFields };
	let globalsChanged = false;
	for (const [name, f] of Object.entries(UNIVERSAL_VISUAL_GLOBALS)) {
		if (!globals[name]) {
			globals[name] = { ...f };
			globalsChanged = true;
		}
	}

	const existing = new Set(plugin.loader.getAll().map((s) => s.name));
	const additions = STARTER_SCHEMAS.filter((s) => !existing.has(s.name));
	if (additions.length === 0 && !globalsChanged) {
		new Notice("Schema: all starter object types and visual properties already exist. Nothing to import.");
		return;
	}

	plugin.settings.globalFields = globals;
	const next = [...plugin.loader.getAll(), ...additions];
	// updateAll fires schema-changed, whose handler persists settings.
	plugin.loader.updateAll({ schemas: next, globalFields: globals });
	new Notice(
		additions.length > 0
			? `Schema: imported ${additions.length} starter object type${additions.length === 1 ? "" : "s"}.`
			: "Schema: restored the universal visual properties (icon/color)."
	);
}
