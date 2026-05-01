import { App, TFile } from "obsidian";
import type { TypeSchema } from "../schema/types";
import { renderTemplate } from "../util/liquid";

/**
 * Resolve the destination folder for a file given a target schema.
 *
 * The schema's `folder` value can include liquid expressions that reference
 * frontmatter fields (e.g. `Moments/{{datetime|year}}` for year-folder routing).
 * The `frontmatter` arg supplies the values; missing fields render as empty
 * strings.
 */
export function resolveFolder(schema: TypeSchema, frontmatter: Record<string, unknown>): string | null {
	if (!schema.folder) return null;
	const ctx: Record<string, unknown> = { ...frontmatter };
	const rendered = renderTemplate(schema.folder, ctx).trim().replace(/\/+$/, "");
	return rendered || null;
}

/**
 * Move a file into the folder dictated by `targetSchema`. Idempotent — if the
 * file is already in the right folder, this is a no-op. Returns the new path
 * (whether or not a move actually happened) or null if the schema has no
 * folder.
 */
export async function reshelveToSchema(
	app: App,
	file: TFile,
	targetSchema: TypeSchema,
	frontmatter: Record<string, unknown>
): Promise<{ from: string; to: string } | null> {
	const folder = resolveFolder(targetSchema, frontmatter);
	if (!folder) return null;

	const filename = file.name; // includes .md extension
	const targetPath = `${folder}/${filename}`;
	if (file.path === targetPath) return { from: file.path, to: file.path };

	await ensureFolderExists(app, folder);
	const from = file.path;
	await app.fileManager.renameFile(file, targetPath);
	return { from, to: targetPath };
}

async function ensureFolderExists(app: App, folder: string): Promise<void> {
	if (!folder) return;
	const existing = app.vault.getAbstractFileByPath(folder);
	if (existing) return;
	await app.vault.createFolder(folder).catch(() => {
		/* race or already exists */
	});
}
