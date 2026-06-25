import { App, TFile, normalizePath } from "obsidian";
import type { TypeSchema } from "../schema/types";
import { renderTemplate } from "../util/liquid";
import { ensureUniquePath } from "../util/path";

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
 * Move a file into the folder dictated by `targetSchema`. Idempotent - if the
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
	// normalizePath collapses double slashes, trims, and unifies separators so
	// the idempotency check and existence lookups below compare apples to apples
	// with Obsidian's own internal path form.
	const targetPath = normalizePath(`${folder}/${filename}`);
	if (file.path === targetPath) return { from: file.path, to: file.path };

	await ensureFolderExists(app, folder);
	const from = file.path;
	// Never clobber an existing note that happens to share this basename in the
	// destination folder; disambiguate to "Name 2.md" instead. The returned `to`
	// reflects the actual path so callers report the real destination.
	const dest = await ensureUniquePath(app, targetPath);
	await app.fileManager.renameFile(file, dest);
	return { from, to: dest };
}

async function ensureFolderExists(app: App, folder: string): Promise<void> {
	if (!folder) return;
	const existing = app.vault.getAbstractFileByPath(folder);
	if (existing) return;
	await app.vault.createFolder(folder).catch(() => {
		/* race or already exists */
	});
}
