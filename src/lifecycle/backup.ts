import { App, Notice, TFile } from "obsidian";
import type SchemaPlugin from "../main";
import { foldAutoRefreshedIntoGlobals } from "../schema/migrate-auto-refreshed";
import type { TypeSchema } from "../schema/types";
import { confirmAction } from "../ui/prompt-modal";

const EXPORT_FILE = "schema-export.json";

interface ExportPayload {
	version: 1;
	exportedAt: string;
	globalFields: SchemaPlugin["settings"]["globalFields"];
	folderMappings: SchemaPlugin["settings"]["folderMappings"];
	schemas: TypeSchema[];
	/** Legacy field on pre-merge exports; folded into globalFields on import. */
	autoRefreshedFields?: unknown;
}

/**
 * Export the entire schema configuration (schemas + global settings) to a
 * JSON file at the vault root. Overwrites if it already exists.
 */
export async function exportSchemas(plugin: SchemaPlugin): Promise<void> {
	const payload: ExportPayload = {
		version: 1,
		exportedAt: new Date().toISOString(),
		globalFields: plugin.settings.globalFields,
		folderMappings: plugin.settings.folderMappings,
		schemas: plugin.loader.getAllForPersist(),
	};
	const text = JSON.stringify(payload, null, 2);
	const existing = plugin.app.vault.getAbstractFileByPath(EXPORT_FILE);
	if (existing instanceof TFile) {
		await plugin.app.vault.modify(existing, text);
	} else {
		await plugin.app.vault.create(EXPORT_FILE, text);
	}
	new Notice(`Schema: exported ${payload.schemas.length} types → ${EXPORT_FILE}`);
}

/**
 * Import schemas from `schema-export.json` at the vault root. Replaces the
 * current schema set after a confirmation dialog.
 */
export async function importSchemas(plugin: SchemaPlugin): Promise<void> {
	const existing = plugin.app.vault.getAbstractFileByPath(EXPORT_FILE);
	if (!(existing instanceof TFile)) {
		new Notice(`Schema: ${EXPORT_FILE} not found at vault root.`);
		return;
	}
	let payload: ExportPayload;
	try {
		const text = await plugin.app.vault.read(existing);
		payload = JSON.parse(text) as ExportPayload;
	} catch (err) {
		console.error("[schema] failed to parse import:", err);
		new Notice(`Schema: failed to parse ${EXPORT_FILE}; see console.`);
		return;
	}
	if (
		!payload ||
		!Array.isArray(payload.schemas) ||
		typeof payload.version !== "number"
	) {
		new Notice(`Schema: ${EXPORT_FILE} is not a valid export.`);
		return;
	}
	const ok = await confirmAction(
		plugin.app,
		`Replace current configuration with ${payload.schemas.length} types from ${EXPORT_FILE}? Existing schemas + folder mappings will be overwritten.`
	);
	if (!ok) return;

	const baseGlobals =
		payload.globalFields && typeof payload.globalFields === "object"
			? { ...payload.globalFields }
			: { ...plugin.settings.globalFields };
	// Back-compat: pre-merge exports carried `autoRefreshedFields` instead of
	// universal Icon/Color globals - fold them in.
	const { globalFields } = foldAutoRefreshedIntoGlobals(baseGlobals, payload.autoRefreshedFields);
	plugin.settings.globalFields = globalFields;
	plugin.loader.updateAll({ schemas: payload.schemas, globalFields });
	if (payload.folderMappings) {
		plugin.settings.folderMappings = payload.folderMappings;
	}
	await plugin.saveSettings();
	new Notice(`Schema: imported ${payload.schemas.length} types from ${EXPORT_FILE}.`);
}

export async function ensureNoBackupConflict(_app: App): Promise<void> {
	// Reserved for future preflight check.
}
