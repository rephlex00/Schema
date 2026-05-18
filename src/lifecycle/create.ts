import { App, Notice, TFile } from "obsidian";
import type SchemaPlugin from "../main";
import type { TypeSchema } from "../schema/types";
import { promptForValues, type PromptField } from "../ui/prompt-modal";
import { buildFrontmatter, renderFrontmatter } from "../util/frontmatter";
import { renderTemplate } from "../util/liquid";
import { applyBodyTemplateOnCreate } from "./body-template";

const TIMESTAMP_DEFAULT_FILENAME = "{{date:YYYYMMDD-HHmm}}";

/**
 * A type is "instantiable" if a user can create instances of it. Heuristic: it
 * has a `folder` set. Abstract parents (fact, thing, moment, periodic) do not.
 */
export function isInstantiable(schema: TypeSchema): boolean {
	return typeof schema.folder === "string" && schema.folder.length > 0;
}

/**
 * Drives the user-facing "New <type>" command. Resolves with the created
 * TFile, or null if the user canceled or creation failed.
 */
export async function createInstance(plugin: SchemaPlugin, schema: TypeSchema): Promise<TFile | null> {
	// Resolve inheritance — children inherit fields/lookups/defaults from parents.
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
	const folder = renderTemplate(resolved.folder!, renderContext);
	let targetPath: string;
	try {
		targetPath = await ensureUniquePath(plugin.app, `${folder.replace(/\/$/, "")}/${filename}.md`);
	} catch (err) {
		console.error("[schema] could not find unique path:", err);
		new Notice(`Schema: too many similar filenames; aborting create.`);
		return null;
	}

	const fm = buildFrontmatter(resolved, promptedValues);
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

	const leaf = plugin.app.workspace.getLeaf();
	await leaf.openFile(file);
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
	return {
		...prompted,
		datetime: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`,
	};
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
		// Ignore "Folder already exists" — race with another listener.
	});
}

async function ensureUniquePath(app: App, basePath: string): Promise<string> {
	if (!app.vault.getAbstractFileByPath(basePath)) return basePath;
	const dot = basePath.lastIndexOf(".");
	const base = dot >= 0 ? basePath.slice(0, dot) : basePath;
	const ext = dot >= 0 ? basePath.slice(dot) : "";
	for (let i = 2; i < 1000; i++) {
		const candidate = `${base} ${i}${ext}`;
		if (!app.vault.getAbstractFileByPath(candidate)) return candidate;
	}
	throw new Error(`could not find unique path for ${basePath}`);
}
