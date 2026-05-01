import { App, Notice, TFile } from "obsidian";
import type SchemaPlugin from "../main";
import type { TypeSchema } from "../schema/types";
import { askMergeChoice, type MergeChoice } from "../ui/template-merge-modal";
import { TemplaterBridge } from "./templater-bridge";

const SEPARATOR = "\n\n---\n\n";
const FRONTMATTER_RE = /^---\n[\s\S]*?\n---\n?/;

/**
 * Helpers for applying body templates to typed notes. Body templates are
 * Templater files referenced via `schema.bodyTemplate`. When set, the plugin
 * renders the template through Templater's API and writes the result to the
 * note's body (preserving frontmatter).
 *
 * Behavior on type change:
 * - existing body empty → apply template silently
 * - existing body non-empty → ask user (replace / merge / cancel)
 */

/** Read a file's full contents and split into [frontmatter-block, body]. */
async function splitFile(app: App, file: TFile): Promise<[string, string]> {
	const content = await app.vault.read(file);
	const m = FRONTMATTER_RE.exec(content);
	if (!m) return ["", content];
	return [m[0], content.slice(m[0].length)];
}

/** Strip the frontmatter from a Templater-rendered output (it sometimes
 *  includes a `---` block from the template file itself). We want only the
 *  body portion to attach below the note's own frontmatter. */
function stripFrontmatter(rendered: string): string {
	return rendered.replace(FRONTMATTER_RE, "");
}

/** Apply a body template to a freshly-created file (body assumed empty). */
export async function applyBodyTemplateOnCreate(
	plugin: SchemaPlugin,
	file: TFile,
	schema: TypeSchema
): Promise<void> {
	if (!schema.bodyTemplate) return;
	const bridge = new TemplaterBridge(plugin.app);
	if (!bridge.isInstalled()) {
		new Notice(
			`Schema: type "${schema.name}" has a body template but Templater is not installed.`
		);
		return;
	}
	const rendered = await bridge.renderFile(schema.bodyTemplate, file);
	if (rendered == null) return;
	await appendBody(plugin.app, file, stripFrontmatter(rendered));
}

/**
 * Apply a body template during a type change. Decides empty/replace/merge.
 * Returns the choice taken (or 'noop' if no template was set / Templater
 * unavailable).
 */
export async function applyBodyTemplateOnRetype(
	plugin: SchemaPlugin,
	file: TFile,
	schema: TypeSchema
): Promise<MergeChoice | "noop"> {
	if (!schema.bodyTemplate) return "noop";
	const bridge = new TemplaterBridge(plugin.app);
	if (!bridge.isInstalled()) return "noop";

	const [fmBlock, body] = await splitFile(plugin.app, file);
	const trimmed = body.trim();

	const rendered = await bridge.renderFile(schema.bodyTemplate, file);
	if (rendered == null) return "noop";
	const renderedBody = stripFrontmatter(rendered).trim();

	if (trimmed.length === 0) {
		// Body was empty — apply silently.
		await plugin.app.vault.modify(file, fmBlock + renderedBody + "\n");
		return "replace";
	}

	const choice = await askMergeChoice(plugin.app, schema.name);
	if (choice === "cancel") return "cancel";

	let newBody: string;
	if (choice === "replace") {
		newBody = renderedBody;
	} else {
		newBody = renderedBody + SEPARATOR + trimmed;
	}
	await plugin.app.vault.modify(file, fmBlock + newBody + "\n");
	return choice;
}

/** Append rendered body to a file that has only frontmatter so far. */
async function appendBody(app: App, file: TFile, body: string): Promise<void> {
	const content = await app.vault.read(file);
	const m = FRONTMATTER_RE.exec(content);
	if (!m) {
		// No frontmatter — just write the body.
		await app.vault.modify(file, body);
		return;
	}
	const fmBlock = m[0];
	const trailing = content.slice(fmBlock.length).trim();
	const next = trailing.length === 0 ? fmBlock + body + "\n" : fmBlock + body + SEPARATOR + trailing;
	await app.vault.modify(file, next);
}
