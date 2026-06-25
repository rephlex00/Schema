import { AbstractInputSuggest, App, TFile, TFolder } from "obsidian";

const MAX_SUGGESTIONS = 25;

/**
 * Autocomplete dropdown for path inputs that should point at a template file.
 * Suggests `.md` files whose path starts with `rootFolder` (empty string =
 * whole vault). Matching is a case-insensitive substring of the full vault
 * path; an empty query lists everything under the root.
 */
export class TemplateFileSuggest extends AbstractInputSuggest<TFile> {
	private readonly rootFolder: string;

	constructor(app: App, inputEl: HTMLInputElement, rootFolder: string) {
		super(app, inputEl);
		this.rootFolder = normalizeFolder(rootFolder);
	}

	protected getSuggestions(query: string): TFile[] {
		const q = query.trim().toLowerCase();
		const prefix = this.rootFolder.length > 0 ? this.rootFolder + "/" : "";
		const out: TFile[] = [];
		for (const f of this.app.vault.getMarkdownFiles()) {
			if (prefix.length > 0 && !f.path.startsWith(prefix)) continue;
			if (q.length === 0 || f.path.toLowerCase().includes(q)) {
				out.push(f);
				if (out.length >= MAX_SUGGESTIONS) break;
			}
		}
		out.sort((a, b) => a.path.localeCompare(b.path));
		return out;
	}

	renderSuggestion(file: TFile, el: HTMLElement): void {
		el.addClass("schema-file-suggest-row");
		el.createDiv({ cls: "schema-file-suggest-name", text: file.basename });
		const sub = file.parent?.path ?? "";
		if (sub) el.createDiv({ cls: "schema-file-suggest-path", text: sub });
	}

	selectSuggestion(file: TFile, evt: MouseEvent | KeyboardEvent): void {
		this.setValue(file.path);
		// AbstractInputSuggest only fires onSelect when this is invoked; the
		// onChange hook on the underlying <input> doesn't fire from setValue,
		// so callers should also use .onSelect() to commit the picked value.
		super.selectSuggestion(file, evt);
		this.close();
	}
}

/**
 * Autocomplete dropdown for the "templates folder" picker - suggests existing
 * vault folders whose path matches the query.
 */
export class FolderSuggest extends AbstractInputSuggest<TFolder> {
	constructor(app: App, inputEl: HTMLInputElement) {
		super(app, inputEl);
	}

	protected getSuggestions(query: string): TFolder[] {
		const q = query.trim().toLowerCase();
		const out: TFolder[] = [];
		const visit = (folder: TFolder) => {
			if (folder.path && (q.length === 0 || folder.path.toLowerCase().includes(q))) {
				out.push(folder);
			}
			for (const child of folder.children) {
				if (child instanceof TFolder) visit(child);
			}
		};
		visit(this.app.vault.getRoot());
		out.sort((a, b) => a.path.localeCompare(b.path));
		return out.slice(0, MAX_SUGGESTIONS);
	}

	renderSuggestion(folder: TFolder, el: HTMLElement): void {
		el.addClass("schema-file-suggest-row");
		el.createDiv({ cls: "schema-file-suggest-name", text: folder.path });
	}

	selectSuggestion(folder: TFolder, evt: MouseEvent | KeyboardEvent): void {
		this.setValue(folder.path);
		super.selectSuggestion(folder, evt);
		this.close();
	}
}

function normalizeFolder(path: string): string {
	return path.trim().replace(/^\/+|\/+$/g, "");
}
