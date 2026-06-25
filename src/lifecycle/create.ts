import { App, Editor, Notice, TFile } from "obsidian";
import type SchemaPlugin from "../main";
import type { TypeSchema } from "../schema/types";
import { promptForValues, type PromptField } from "../ui/prompt-modal";
import { buildFrontmatter, renderFrontmatter } from "../util/frontmatter";
import { getUniversalFields } from "../util/universal";
import { renderTemplate } from "../util/liquid";
import { ensureUniquePath } from "../util/path";
import { applyBodyTemplateOnCreate } from "./body-template";
import { resolveFolder } from "./reshelve";

const TIMESTAMP_DEFAULT_FILENAME = "{{date:YYYYMMDD-HHmm}}";

/**
 * A type is "instantiable" if a user can create instances of it. Heuristic: it
 * has a `folder` set. Abstract parents (fact, thing, moment, periodic) do not.
 */
export function isInstantiable(schema: TypeSchema): boolean {
	return typeof schema.folder === "string" && schema.folder.length > 0;
}

export interface CreateOptions {
	/** The editor the create command was issued from. When present and
	 *  `linkOnCreate` is enabled, a wikilink to the new note is inserted at its
	 *  cursor (where the slash command was typed). */
	source?: { editor: Editor; file: TFile | null };
}

/**
 * Drives the user-facing "New <type>" command. Resolves with the created
 * TFile, or null if the user canceled or creation failed.
 */
export async function createInstance(
	plugin: SchemaPlugin,
	schema: TypeSchema,
	opts: CreateOptions = {}
): Promise<TFile | null> {
	// Resolve inheritance - children inherit fields/lookups/defaults from parents.
	const resolved = plugin.loader.getResolved(schema.name) ?? schema;

	if (!isInstantiable(resolved)) {
		new Notice(`Schema: type "${schema.name}" has no folder set; cannot create.`);
		return null;
	}

	const prompts = collectPrompts(resolved);
	let promptedValues: Record<string, string> = {};
	if (prompts.length > 0) {
		const result = await promptForValues(plugin.app, `New ${schema.name}`, prompts);
		if (result === null) return null; // user canceled
		promptedValues = result;
	}

	const renderContext = buildRenderContext(promptedValues);
	const filename = pickFilename(resolved, renderContext);
	if (!filename) {
		new Notice(`Schema: filename for "${schema.name}" rendered empty; aborting.`);
		return null;
	}
	// Resolve (and validate) the destination folder the same way reshelve does:
	// a folder template that renders empty would otherwise drop the note at the
	// vault root ("/<name>.md").
	const folder = resolveFolder(resolved, renderContext);
	if (!folder) {
		new Notice(`Schema: folder for "${schema.name}" rendered empty; aborting.`);
		return null;
	}
	let targetPath: string;
	try {
		targetPath = await ensureUniquePath(plugin.app, `${folder}/${filename}.md`);
	} catch (err) {
		console.error("[schema] could not find unique path:", err);
		new Notice(`Schema: too many similar filenames; aborting create.`);
		return null;
	}

	const fm = buildFrontmatter(
		resolved,
		promptedValues,
		plugin.settings.typeKey,
		getUniversalFields(plugin.settings.globalFields),
		renderContext
	);
	const body = renderFrontmatter(fm);

	await ensureFolderExists(plugin.app, folder);

	let file: TFile;
	try {
		file = await plugin.app.vault.create(targetPath, body);
	} catch (err) {
		console.error("[schema] create failed:", err);
		new Notice(`Schema: failed to create ${targetPath}. See console.`);
		return null;
	}

	// Apply body template if the schema declares one.
	await applyBodyTemplateOnCreate(plugin, file, resolved);

	const source = opts.source;
	if (plugin.settings.linkOnCreate && source) {
		// Drop a wikilink at the cursor of the note the command was issued from.
		// Obsidian has already removed the typed `/query`, so the cursor sits
		// where the slash was. generateMarkdownLink honors the vault's link
		// format and path preferences.
		const sourcePath = source.file?.path ?? "";
		const link = plugin.app.fileManager.generateMarkdownLink(file, sourcePath);
		source.editor.replaceSelection(link);

		const open = plugin.settings.linkOnCreateOpen;
		if (open === "tab") {
			await plugin.app.workspace.getLeaf("tab").openFile(file);
		} else if (open === "split") {
			await plugin.app.workspace.getLeaf("split").openFile(file);
		}
		// "stay": leave focus in the source note; don't open the new file.
	} else {
		// Feature off, or no editor (e.g. palette with no note open): open as before.
		await plugin.app.workspace.getLeaf().openFile(file);
	}
	new Notice(`Schema: created ${targetPath}`);
	return file;
}

function collectPrompts(schema: TypeSchema): PromptField[] {
	const prompts: PromptField[] = [];
	for (const field of schema.fields) {
		if (typeof field.promptOnCreate === "string" && field.promptOnCreate.length > 0) {
			prompts.push({
				key: field.name,
				label: field.promptOnCreate,
			});
		}
	}
	return prompts;
}

function buildRenderContext(prompted: Record<string, string>): Record<string, unknown> {
	const now = new Date();
	const pad = (n: number) => String(n).padStart(2, "0");
	const ctx: Record<string, unknown> = {
		...prompted,
		datetime: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`,
	};
	// When the user supplied a datetime at the prompt, anchor `{{date:...}}`
	// tokens (dynamic defaults like dailynote) to that moment instead of now.
	if (typeof prompted.datetime === "string" && prompted.datetime.trim().length > 0) {
		const d = new Date(prompted.datetime);
		if (!Number.isNaN(d.valueOf())) ctx.__now = d;
	}
	return ctx;
}

function pickFilename(schema: TypeSchema, ctx: Record<string, unknown>): string {
	const tpl = schema.filename && schema.filename.trim().length > 0 ? schema.filename : TIMESTAMP_DEFAULT_FILENAME;
	const rendered = renderTemplate(tpl, ctx).trim();
	return sanitizeFilename(rendered);
}

function sanitizeFilename(name: string): string {
	// Remove characters illegal in macOS / Windows filenames.
	return name.replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, " ").trim();
}

async function ensureFolderExists(app: App, folder: string): Promise<void> {
	const path = folder.replace(/\/$/, "");
	if (!path) return;
	const existing = app.vault.getAbstractFileByPath(path);
	if (existing) return;
	await app.vault.createFolder(path).catch(() => {
		// Ignore "Folder already exists" - race with another listener.
	});
}

