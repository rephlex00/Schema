import { Notice, Setting } from "obsidian";
import type { FolderMapping } from "../main";
import type SchemaPlugin from "../main";
import { FolderSuggest } from "./file-suggest";
import { promptForString } from "./prompt-modal";

/**
 * Renders the global "Folder mappings" editor: each row is one
 * (folder → object type) entry. New files in (or moves into) a mapped folder
 * auto-set the file's object-type frontmatter to the configured object type.
 *
 * One mapping per folder. Most-specific (longest prefix) wins at runtime.
 */
export class FolderMappingsEditor {
	private readonly plugin: SchemaPlugin;
	private readonly onChange: () => void;

	constructor(plugin: SchemaPlugin, onChange: () => void) {
		this.plugin = plugin;
		this.onChange = onChange;
	}

	render(parent: HTMLElement): void {
		const wrap = parent.createDiv({ cls: "schema-folder-mappings-editor" });

		const list = wrap.createDiv({ cls: "schema-fm-list" });
		const entries = Object.entries(this.plugin.settings.folderMappings).sort((a, b) =>
			a[0].localeCompare(b[0])
		);
		for (const [folder, mapping] of entries) {
			this.renderRow(list, folder, mapping);
		}

		new Setting(wrap).addButton((btn) => {
			btn.setButtonText("+ Add mapping")
				.setCta()
				.onClick(() => void this.addMapping());
		});
	}

	private renderRow(parent: HTMLElement, folder: string, mapping: FolderMapping): void {
		const row = parent.createDiv({ cls: "schema-fm-row" });

		const folderInput = row.createEl("input", {
			type: "text",
			cls: "schema-fm-folder",
			attr: { value: folder, placeholder: "Facts/People" },
		});
		// Mutable ref to the current folder name. Captured by closures below
		// so a folder rename followed by a type change (in either order)
		// targets the right key, even before the next display() refresh.
		const ref = { current: folder };

		const commitFolderChange = (raw: string) => {
			const newFolder = raw.trim().replace(/\/+$/, "");
			if (!newFolder) {
				new Notice("Schema: folder cannot be empty.");
				folderInput.value = ref.current;
				return;
			}
			if (newFolder !== ref.current && newFolder in this.plugin.settings.folderMappings) {
				new Notice(`Schema: folder "${newFolder}" is already mapped.`);
				folderInput.value = ref.current;
				return;
			}
			if (newFolder === ref.current) return;
			const value = this.plugin.settings.folderMappings[ref.current];
			delete this.plugin.settings.folderMappings[ref.current];
			this.plugin.settings.folderMappings[newFolder] = value;
			ref.current = newFolder;
			void this.commit();
		};
		folderInput.addEventListener("change", () => commitFolderChange(folderInput.value));
		new FolderSuggest(this.plugin.app, folderInput).onSelect((folder) => {
			folderInput.value = folder.path;
			commitFolderChange(folder.path);
		});

		const select = row.createEl("select", { cls: "schema-fm-type" });
		const types = this.plugin.loader.getAll().slice().sort((a, b) => a.name.localeCompare(b.name));
		for (const s of types) {
			const opt = select.createEl("option", { text: s.name, attr: { value: s.name } });
			if (s.name === mapping.type) opt.selected = true;
		}
		select.addEventListener("change", () => {
			const cur = this.plugin.settings.folderMappings[ref.current];
			this.plugin.settings.folderMappings[ref.current] = { ...cur, type: select.value };
			void this.commit();
		});

		const enforceWrap = row.createEl("label", { cls: "schema-fm-enforce" });
		const enforceBox = enforceWrap.createEl("input", { type: "checkbox" });
		enforceBox.checked = !!mapping.enforce;
		enforceWrap.createSpan({ text: "force" });
		const typeKey = this.plugin.settings.typeKey;
		enforceWrap.setAttr(
			"title",
			`Off (default): if the file is created with an existing \`${typeKey}:\` already set, leave it alone.\nOn: overwrite the existing \`${typeKey}:\` to match this folder.\n(Either way, dragging the file into this folder re-classifies it.)`
		);
		enforceBox.addEventListener("change", () => {
			const cur = this.plugin.settings.folderMappings[ref.current];
			this.plugin.settings.folderMappings[ref.current] = {
				...cur,
				enforce: enforceBox.checked || undefined,
			};
			void this.commit();
		});

		const delBtn = row.createEl("button", { text: "×", cls: "schema-arf-btn schema-arf-del" });
		delBtn.addEventListener("click", () => {
			delete this.plugin.settings.folderMappings[ref.current];
			void this.commit();
		});
	}

	private async addMapping(): Promise<void> {
		const folder = await promptForString(
			this.plugin.app,
			"Add folder mapping",
			"Folder path",
			"e.g. Facts/People"
		);
		if (!folder) return;
		const norm = folder.trim().replace(/\/+$/, "");
		if (!norm) return;
		if (norm in this.plugin.settings.folderMappings) {
			new Notice(`Schema: folder "${norm}" is already mapped.`);
			return;
		}
		const types = this.plugin.loader.getAll();
		if (types.length === 0) {
			new Notice("Schema: no object types defined yet. Add an object type first.");
			return;
		}
		this.plugin.settings.folderMappings[norm] = { type: types[0].name };
		await this.commit();
	}

	private async commit(): Promise<void> {
		await this.plugin.saveSettings();
		this.onChange();
	}
}
