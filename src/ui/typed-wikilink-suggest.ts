import {
	App,
	Editor,
	EditorPosition,
	EditorSuggest,
	EditorSuggestContext,
	EditorSuggestTriggerInfo,
	prepareFuzzySearch,
	setIcon,
	TFile,
} from "obsidian";
import type SchemaPlugin from "../main";
import { stripTemplateSegments } from "../util/folder";

interface TypedSuggestContext {
	target: string; // type name (e.g. "person")
	query: string;
}

const KEY_RE = /^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:/;

/**
 * Type-aware wikilink autocomplete inside frontmatter fields whose `target`
 * is set. When the cursor is between `[[` and `]]` (or end-of-line) inside
 * such a field, this suggester takes over and filters completions to
 * instances of the target type only.
 *
 * Returns null from onTrigger for any other context — Obsidian's default
 * link suggester handles those normally.
 */
export class TypedWikilinkSuggest extends EditorSuggest<TFile> {
	private readonly plugin: SchemaPlugin;
	private suggestionContext: TypedSuggestContext | null = null;

	constructor(app: App, plugin: SchemaPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onTrigger(
		cursor: EditorPosition,
		editor: Editor,
		file: TFile | null
	): EditorSuggestTriggerInfo | null {
		if (!file) return null;

		// 1. Are we inside `[[...` on the current line?
		const line = editor.getLine(cursor.line);
		const beforeCursor = line.slice(0, cursor.ch);
		const openIdx = beforeCursor.lastIndexOf("[[");
		if (openIdx < 0) return null;
		// Bail if there's a `]]` between the most-recent `[[` and the cursor.
		if (beforeCursor.lastIndexOf("]]") > openIdx) return null;
		// Bail if there's a pipe after `[[` (already an alias) — let default suggester handle.
		const afterOpen = beforeCursor.slice(openIdx + 2);
		if (afterOpen.includes("|")) return null;

		// 2. Is the cursor inside the file's frontmatter block?
		if (!isInsideFrontmatter(editor, cursor)) return null;

		// 3. What's the active YAML key on this line (or the most-recent above)?
		const activeKey = detectActiveKey(editor, cursor);
		if (!activeKey) return null;

		// 4. Look up the file's `type:` and resolve.
		const cache = this.plugin.app.metadataCache.getFileCache(file);
		const typeName = cache?.frontmatter?.type;
		if (typeof typeName !== "string") return null;
		const schema = this.plugin.loader.getResolved(typeName);
		if (!schema) return null;

		// 5. Find the field with this key. Must have a target.
		const field = schema.fields.find((f) => f.name === activeKey);
		if (!field || !field.target) return null;

		const query = afterOpen;
		this.suggestionContext = { target: field.target, query };

		return {
			start: { line: cursor.line, ch: openIdx + 2 },
			end: cursor,
			query,
		};
	}

	getSuggestions(context: EditorSuggestContext): TFile[] {
		const ctx = this.suggestionContext;
		if (!ctx) return [];
		const targetSchema = this.plugin.loader.getResolved(ctx.target);
		if (!targetSchema) return [];
		const folder = stripTemplateSegments(targetSchema.folder);

		const candidates = this.plugin.app.vault.getMarkdownFiles().filter((f) => {
			if (!folder) return true;
			return f.path === folder || f.path.startsWith(folder + "/");
		});

		const query = (context.query ?? ctx.query ?? "").trim();
		if (query.length === 0) return candidates.slice(0, 20);

		const fuzzy = prepareFuzzySearch(query);
		const scored: Array<{ file: TFile; score: number }> = [];
		for (const f of candidates) {
			const m = fuzzy(f.basename);
			if (m) scored.push({ file: f, score: m.score });
		}
		scored.sort((a, b) => b.score - a.score);
		return scored.slice(0, 20).map((s) => s.file);
	}

	renderSuggestion(file: TFile, el: HTMLElement): void {
		el.empty();
		el.addClass("schema-suggest-row");
		const main = el.createDiv({ cls: "schema-suggest-main" });
		main.createEl("strong", { text: file.basename });
		const path = file.parent?.path ?? "";
		if (path && path !== "/") {
			el.createEl("small", { cls: "schema-suggest-path", text: path });
		}
		const ctx = this.suggestionContext;
		if (ctx) {
			const targetSchema = this.plugin.loader.getResolved(ctx.target);
			const iconName =
				typeof targetSchema?.defaults?.icon === "string" ? targetSchema.defaults.icon : "";
			if (iconName) {
				const iconEl = el.createSpan({ cls: "schema-suggest-icon" });
				setIcon(iconEl, iconName);
			}
		}
	}

	selectSuggestion(file: TFile, _evt: MouseEvent | KeyboardEvent): void {
		if (!this.context) return;
		const editor = this.context.editor;
		const start = this.context.start;
		// We replace from after `[[` to current cursor, leaving the existing `[[` intact
		// and adding `]]` after the basename.
		editor.replaceRange(`${file.basename}]]`, start, this.context.end);
		// Move cursor past the closing `]]`
		const newCh = start.ch + file.basename.length + 2;
		editor.setCursor({ line: start.line, ch: newCh });
		this.suggestionContext = null;
		this.close();
	}
}

/**
 * Returns true if the cursor is between the first `---` line and its closing
 * `---` (i.e., inside the YAML frontmatter block).
 */
function isInsideFrontmatter(editor: Editor, cursor: EditorPosition): boolean {
	if (editor.getLine(0).trim() !== "---") return false;
	for (let i = 1; i <= editor.lastLine(); i++) {
		if (editor.getLine(i).trim() === "---") {
			return cursor.line > 0 && cursor.line < i;
		}
	}
	return false;
}

/**
 * Walk backward from cursor to find the most-recently-declared YAML key.
 * Handles list-form values (the parent key is on a previous line at lower
 * indent than the bullet).
 */
function detectActiveKey(editor: Editor, cursor: EditorPosition): string | null {
	for (let i = cursor.line; i >= 0; i--) {
		const line = editor.getLine(i);
		// Skip top frontmatter delimiter
		if (i === 0 && line.trim() === "---") return null;
		const trimmed = line.trimStart();
		// A key declaration starts at column 0 (no leading spaces) followed by `key:`.
		const indent = line.length - trimmed.length;
		if (indent === 0) {
			const m = trimmed.match(KEY_RE);
			if (m) return m[1];
			// Hit a non-key line at column 0 — give up.
			if (i !== cursor.line && trimmed.length > 0) return null;
		}
	}
	return null;
}
