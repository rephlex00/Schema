import { App, Notice, TFile } from "obsidian";
import type SchemaPlugin from "../main";
import type { FieldType, TypeSchema } from "../schema/types";
import { askMergeChoice, type MergeChoice } from "../ui/template-merge-modal";
import { effectiveFields, getUniversalFields } from "../util/universal";
import { dumpFrontmatterYaml, parseFrontmatterYaml } from "../util/yaml";
import { TemplaterBridge } from "./templater-bridge";

const SEPARATOR = "\n\n---\n\n";
const FRONTMATTER_RE = /^---\n[\s\S]*?\n---\n?/;

/**
 * Return the body-template path that should be applied for `schema`, or null
 * if there is none. Order of preference:
 * 1. `schema.bodyTemplate` if explicitly set
 * 2. If `autoBodyTemplateByTypeName` is on, the first `<typeName>.md` found
 *    under `templatesFolder` (recursive). Match is case-insensitive on basename.
 */
export function resolveBodyTemplatePath(
	plugin: SchemaPlugin,
	schema: TypeSchema
): string | null {
	if (schema.bodyTemplate && schema.bodyTemplate.trim().length > 0) {
		return schema.bodyTemplate.trim();
	}
	if (!plugin.settings.autoBodyTemplateByTypeName) return null;
	const root = plugin.settings.templatesFolder.trim().replace(/^\/+|\/+$/g, "");
	const prefix = root.length > 0 ? root + "/" : "";
	const target = schema.name.toLowerCase();
	for (const f of plugin.app.vault.getMarkdownFiles()) {
		if (prefix.length > 0 && !f.path.startsWith(prefix)) continue;
		if (f.basename.toLowerCase() === target) return f.path;
	}
	return null;
}

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
	const templatePath = resolveBodyTemplatePath(plugin, schema);
	if (!templatePath) return;
	const bridge = new TemplaterBridge(plugin.app);
	if (!bridge.isInstalled()) {
		new Notice(
			`Schema: type "${schema.name}" has a body template but Templater is not installed.`
		);
		return;
	}
	const rendered = await bridge.renderFile(templatePath, file);
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
	const templatePath = resolveBodyTemplatePath(plugin, schema);
	if (!templatePath) return "noop";
	const bridge = new TemplaterBridge(plugin.app);
	if (!bridge.isInstalled()) return "noop";

	const [fmBlock, body] = await splitFile(plugin.app, file);
	const trimmed = body.trim();

	const rendered = await bridge.renderFile(templatePath, file);
	if (rendered == null) return "noop";
	const renderedBody = stripFrontmatter(rendered).trim();

	if (trimmed.length === 0) {
		// Body was empty - apply silently.
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

/**
 * Obsidian's rough property types. YAML value shape maps to one of these.
 * Anything else (File, Lookup, JSON, Formula, …) round-trips as `text`.
 */
export type ObsidianRoughType = "text" | "number" | "checkbox" | "date" | "datetime" | "list";

const ARRAY_FIELD_TYPES: FieldType[] = ["MultiFile", "Multi", "MultiMedia"];
const DATE_FIELD_TYPES: FieldType[] = ["Date"];
const DATETIME_FIELD_TYPES: FieldType[] = ["DateTime", "Time"];

export function obsidianTypeFromFieldType(ft: FieldType): ObsidianRoughType {
	if (ft === "Number") return "number";
	if (ft === "Boolean") return "checkbox";
	if (DATE_FIELD_TYPES.includes(ft)) return "date";
	if (DATETIME_FIELD_TYPES.includes(ft)) return "datetime";
	if (ARRAY_FIELD_TYPES.includes(ft)) return "list";
	return "text";
}

export function fieldTypeFromObsidianType(ot: ObsidianRoughType): FieldType {
	switch (ot) {
		case "number":
			return "Number";
		case "checkbox":
			return "Boolean";
		case "date":
			return "Date";
		case "datetime":
			return "DateTime";
		case "list":
			return "Multi";
		default:
			return "Input";
	}
}

function seedValueForFieldType(ft: FieldType): unknown {
	const ot = obsidianTypeFromFieldType(ft);
	switch (ot) {
		case "number":
			return 0;
		case "checkbox":
			return false;
		case "list":
			return [];
		default:
			return "";
	}
}

export interface TemplatePropertyEntry {
	name: string;
	obsidianType: ObsidianRoughType;
	default: unknown;
}

/**
 * Parse a template file's frontmatter and return its declared properties in
 * order. Returns null when the file doesn't exist or isn't a markdown file.
 * Frontmatter keys that match the configured object-type key or any auto-
 * refreshed property are excluded from the returned list.
 */
export async function extractTemplatePropertyList(
	plugin: SchemaPlugin,
	templatePath: string,
	schema?: TypeSchema
): Promise<TemplatePropertyEntry[] | null> {
	const file = plugin.app.vault.getAbstractFileByPath(templatePath);
	if (!(file instanceof TFile)) return null;
	const content = await plugin.app.vault.read(file);
	const m = FRONTMATTER_RE.exec(content);
	if (!m) return [];
	const yamlText = m[0].replace(/^---\n/, "").replace(/---\n?$/, "");
	let parsed: unknown;
	try {
		parsed = parseFrontmatterYaml(yamlText);
	} catch {
		return [];
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
	// Ambient keys (the type key, universal globals, Obsidian's reserved
	// properties) aren't part of a type's own property list, so they're dropped
	// from the comparison. EXCEPT when the type actually declares a field of that
	// name - the starter types declare `title` and `summary`. A declared field
	// always counts; otherwise Save writes it and this read strips it back out,
	// pinning the type "out of sync" no matter how many times you save.
	const declared = new Set((schema?.fields ?? []).map((f) => f.name));
	const ambient = new Set<string>([
		plugin.settings.typeKey,
		...getUniversalFields(plugin.settings.globalFields).map((f) => f.name),
		"title",
		"summary",
		"aliases",
	]);
	const entries: TemplatePropertyEntry[] = [];
	for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
		if (ambient.has(key) && !declared.has(key)) continue;
		entries.push({ name: key, obsidianType: inferObsidianType(value), default: value });
	}
	return entries;
}

function inferObsidianType(v: unknown): ObsidianRoughType {
	if (typeof v === "boolean") return "checkbox";
	if (typeof v === "number") return "number";
	if (Array.isArray(v)) return "list";
	// The YAML 1.1 parser turns unquoted ISO dates into Date instances. Treat as
	// date (no time component preserved, which matches Obsidian's coarse date type).
	if (v instanceof Date) return "date";
	return "text";
}

/** A frontmatter value carrying no usable type information: null/undefined or
 *  an empty string. A freshly-seeded date or text property is written as "",
 *  which YAML round-trips as text - Obsidian itself can't tell an empty date
 *  from empty text. Empty arrays, 0, and false DO carry type info, so they are
 *  not considered blank. */
function isBlankValue(v: unknown): boolean {
	return v == null || v === "";
}

/**
 * Whether a template entry's value is type-compatible with a schema field.
 * Looser than strict equality on purpose: frontmatter can't faithfully encode
 * every distinction the schema makes, so demanding an exact match leaves
 * perfectly-synced templates reading "out of sync" forever.
 * - date vs datetime: YAML collapses both to a timestamp that loads back as a
 *   Date, so the value alone can't distinguish them - treat as compatible.
 * - an empty scalar (a seeded date/text property written as "") has no type -
 *   treat it as compatible with any scalar-ish field rather than forcing "text".
 */
function templateTypeMatches(fieldType: FieldType, entry: TemplatePropertyEntry): boolean {
	const want = obsidianTypeFromFieldType(fieldType);
	const got = entry.obsidianType;
	if (want === got) return true;
	const isDateLike = (t: ObsidianRoughType) => t === "date" || t === "datetime";
	if (isDateLike(want) && isDateLike(got)) return true;
	if (got === "text" && isBlankValue(entry.default)) {
		return want === "text" || isDateLike(want);
	}
	return false;
}

/**
 * Rewrite the template file's frontmatter block to mirror the schema's
 * property list (in order). Keys outside the schema (e.g. Templater-set
 * `created: <% tp.date.now() %>`) are preserved. The body is untouched.
 *
 * Each schema property is written with its per-type default if set,
 * otherwise an empty value shaped by its data type (text "", number 0,
 * checkbox false, list []). The object-type key is written too.
 */
export async function writeTemplatePropertyList(
	plugin: SchemaPlugin,
	templatePath: string,
	schema: TypeSchema
): Promise<void> {
	const file = plugin.app.vault.getAbstractFileByPath(templatePath);
	if (!(file instanceof TFile)) {
		throw new Error(`Template not found: ${templatePath}`);
	}
	const content = await plugin.app.vault.read(file);
	const m = FRONTMATTER_RE.exec(content);
	const existingBody = m ? content.slice(m[0].length) : content;
	const existingBlock = m?.[0] ?? "";

	const typeKey = plugin.settings.typeKey;
	const universal = getUniversalFields(plugin.settings.globalFields);
	const next: Record<string, unknown> = {};
	next[typeKey] = schema.name;
	for (const f of effectiveFields(schema, universal)) {
		const dflt = schema.defaults?.[f.name];
		next[f.name] = dflt !== undefined && dflt !== "" ? dflt : seedValueForFieldType(f.type);
	}
	const schemaKeys = new Set(Object.keys(next));

	// Preserve keys the user added by hand. Two strategies:
	// - If the existing frontmatter parses as plain YAML, dump the merged dict.
	// - If parse fails (Templater syntax like `<% tp.date.now() %>` is invalid
	//   YAML), splice into the raw text: replace any lines for schema-owned
	//   keys, leave every other line untouched. This preserves Templater tags,
	//   block scalars, comments, and any other syntax a YAML dump would mangle.
	const parsed = tryParseFrontmatter(existingBlock);
	let yamlText: string;
	if (parsed !== null) {
		for (const [k, v] of Object.entries(parsed)) {
			if (!schemaKeys.has(k)) next[k] = v;
		}
		yamlText = dumpFrontmatterYaml(next);
	} else {
		yamlText = spliceSchemaKeysIntoRawFrontmatter(existingBlock, next, schemaKeys);
	}

	const newContent = `---\n${yamlText}---\n${existingBody.replace(/^\n/, "")}`;
	await plugin.app.vault.modify(file, newContent);
}

/** Parse a frontmatter block. Returns null on any error (Templater syntax,
 *  comments, malformed YAML) so callers can fall back to a text-splice. */
function tryParseFrontmatter(block: string): Record<string, unknown> | null {
	if (!block) return {};
	const yamlText = block.replace(/^---\n/, "").replace(/---\n?$/, "");
	try {
		const parsed = parseFrontmatterYaml(yamlText);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
		if (parsed === null || parsed === undefined) return {};
	} catch {
		// fall through
	}
	return null;
}

/** Splice schema-owned keys into a raw frontmatter block without parsing it.
 *  Each schema key gets a single YAML line (dumped as a scalar);
 *  every existing line whose top-level key is in schemaKeys is replaced, and
 *  other lines (including Templater tags, block scalars, comments) survive
 *  verbatim. Schema keys not yet in the block are appended. */
function spliceSchemaKeysIntoRawFrontmatter(
	block: string,
	schemaValues: Record<string, unknown>,
	schemaKeys: Set<string>
): string {
	const inner = block.replace(/^---\n/, "").replace(/---\n?$/, "");
	const lines = inner.split("\n");
	const written = new Set<string>();
	const out: string[] = [];

	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		const keyMatch = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:/);
		if (keyMatch && schemaKeys.has(keyMatch[1])) {
			// Replace this line (and any continuation: indented lines, list bullets).
			const key = keyMatch[1];
			out.push(dumpKeyValueLine(key, schemaValues[key]));
			written.add(key);
			i++;
			while (i < lines.length && /^(\s+|-)/.test(lines[i])) i++;
			continue;
		}
		out.push(line);
		i++;
	}

	for (const key of Object.keys(schemaValues)) {
		if (!written.has(key)) out.push(dumpKeyValueLine(key, schemaValues[key]));
	}

	let result = out.join("\n");
	if (!result.endsWith("\n")) result += "\n";
	return result;
}

function dumpKeyValueLine(key: string, value: unknown): string {
	const dumped = dumpFrontmatterYaml({ [key]: value });
	return dumped.replace(/\n$/, "");
}

export interface TemplateSchemaDiff {
	settingsAhead: string[];
	templateAhead: string[];
	order: "same" | "different";
}

/**
 * Compare an object type's property list against a template's frontmatter.
 * Returns the symmetric diff plus an order flag. Used to enable / disable
 * the Save-to-template and Load-from-template buttons.
 */
export function diffTemplateVsSchema(
	template: TemplatePropertyEntry[],
	schema: TypeSchema
): TemplateSchemaDiff {
	const tmplNames = template.map((e) => e.name);
	const schemaNames = schema.fields.map((f) => f.name);
	const tmplSet = new Set(tmplNames);
	const schemaSet = new Set(schemaNames);
	const settingsAhead = schemaNames.filter((n) => !tmplSet.has(n));
	const templateAhead = tmplNames.filter((n) => !schemaSet.has(n));
	const sharedOrderMatches =
		tmplNames.filter((n) => schemaSet.has(n)).join("|") ===
		schemaNames.filter((n) => tmplSet.has(n)).join("|");
	return {
		settingsAhead,
		templateAhead,
		order: sharedOrderMatches ? "same" : "different",
	};
}

export function diffIsEmpty(diff: TemplateSchemaDiff): boolean {
	return diff.settingsAhead.length === 0 && diff.templateAhead.length === 0 && diff.order === "same";
}

export type TemplateCompareStatus =
	| "match"
	| "missing-in-template"
	| "extra-in-template"
	| "type-mismatch";

export interface TemplateCompareRow {
	name: string;
	/** Present iff the property is in the object type's property list. */
	settingsType?: FieldType;
	/** Present iff the property is in the template's frontmatter. */
	templateType?: ObsidianRoughType;
	status: TemplateCompareStatus;
}

export interface TemplateComparison {
	/** Object-type properties first (in schema order), then template-only ones. */
	rows: TemplateCompareRow[];
	order: "same" | "different";
	counts: { missing: number; extra: number; typeMismatch: number };
	inSync: boolean;
}

/**
 * Row-by-row comparison of an object type's property list against a template's
 * frontmatter, for the side-by-side sync view. Shared properties also compare
 * data types (the schema's `FieldType` mapped through `obsidianTypeFromFieldType`
 * vs the template value's inferred `ObsidianRoughType`). "In sync" requires no
 * missing, extra, or type-mismatched properties and matching order.
 */
export function compareTemplateToSchema(
	template: TemplatePropertyEntry[],
	schema: TypeSchema
): TemplateComparison {
	const tmplByName = new Map(template.map((e) => [e.name, e]));
	const schemaByName = new Map(schema.fields.map((f) => [f.name, f]));

	const rows: TemplateCompareRow[] = [];
	let missing = 0;
	let extra = 0;
	let typeMismatch = 0;

	// Schema properties first, in declaration order.
	for (const f of schema.fields) {
		const entry = tmplByName.get(f.name);
		if (!entry) {
			missing++;
			rows.push({ name: f.name, settingsType: f.type, status: "missing-in-template" });
			continue;
		}
		const mismatch = !templateTypeMatches(f.type, entry);
		if (mismatch) typeMismatch++;
		rows.push({
			name: f.name,
			settingsType: f.type,
			templateType: entry.obsidianType,
			status: mismatch ? "type-mismatch" : "match",
		});
	}

	// Then template-only properties, in template order.
	for (const e of template) {
		if (schemaByName.has(e.name)) continue;
		extra++;
		rows.push({ name: e.name, templateType: e.obsidianType, status: "extra-in-template" });
	}

	const order = diffTemplateVsSchema(template, schema).order;
	const inSync = missing === 0 && extra === 0 && typeMismatch === 0 && order === "same";
	return { rows, order, counts: { missing, extra, typeMismatch }, inSync };
}

/** Append rendered body to a file that has only frontmatter so far. */
async function appendBody(app: App, file: TFile, body: string): Promise<void> {
	const content = await app.vault.read(file);
	const m = FRONTMATTER_RE.exec(content);
	if (!m) {
		// No frontmatter - just write the body.
		await app.vault.modify(file, body);
		return;
	}
	const fmBlock = m[0];
	const trailing = content.slice(fmBlock.length).trim();
	const next = trailing.length === 0 ? fmBlock + body + "\n" : fmBlock + body + SEPARATOR + trailing;
	await app.vault.modify(file, next);
}
