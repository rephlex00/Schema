import { Setting } from "obsidian";
import { importStarterSchemas } from "../../lifecycle/starter-schemas";
import type SchemaPlugin from "../../main";
import { AddTypeModal } from "../add-type-modal";
import { TypeEditor } from "../type-editor";

export interface TypesPaneState {
	getFilterText(): string;
	setFilterText(value: string): void;
}

const YAML_KEY_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/;

export function renderStructureTypesPane(
	plugin: SchemaPlugin,
	parent: HTMLElement,
	refresh: () => void,
	state: TypesPaneState,
): void {
	renderObjectTypePropertySetting(plugin, parent, refresh);
	renderValidation(plugin, parent);

	const allTypes = plugin.loader.getAll().slice().sort((a, b) => a.name.localeCompare(b.name));

	const toolbar = parent.createDiv({ cls: "schema-types-toolbar" });
	const search = toolbar.createEl("input", {
		cls: "schema-types-filter",
		attr: {
			type: "search",
			placeholder: `Filter ${allTypes.length} object type${allTypes.length === 1 ? "" : "s"}…`,
			"aria-label": "Filter object types",
		},
	});
	search.value = state.getFilterText();
	search.addEventListener("input", () => {
		state.setFilterText(search.value);
		populateTypeList(plugin, list, state.getFilterText());
	});

	const addBtn = toolbar.createEl("button", {
		cls: "mod-cta schema-types-add",
		text: "+ Add object type",
		attr: { type: "button" },
	});
	addBtn.addEventListener("click", () => {
		new AddTypeModal(plugin, refresh).open();
	});

	if (allTypes.length === 0) {
		renderFirstTypeWalkthrough(plugin, parent, refresh);
		return;
	}

	const list = parent.createEl("div", { cls: "schema-types-list" });
	populateTypeList(plugin, list, state.getFilterText());
}

function renderObjectTypePropertySetting(
	plugin: SchemaPlugin,
	parent: HTMLElement,
	refresh: () => void,
): void {
	let warnEl: HTMLElement | null = null;
	const setting = new Setting(parent)
		.setName("Object-type property")
		.setDesc(
			"Frontmatter key Schema reads to know a note's object type. Default: `type`. Changing this does not migrate existing notes."
		)
		.addText((t) => {
			t.setValue(plugin.settings.typeKey)
				.setPlaceholder("type")
				.onChange(async (v) => {
					const trimmed = v.trim();
					if (trimmed.length === 0) {
						if (warnEl) {
							warnEl.setText("Object-type property cannot be empty.");
							warnEl.addClass("visible");
						}
						return;
					}
					if (!YAML_KEY_RE.test(trimmed)) {
						if (warnEl) {
							warnEl.setText("Must start with a letter or underscore, then letters, digits, dashes, or underscores.");
							warnEl.addClass("visible");
						}
						return;
					}
					if (warnEl) warnEl.removeClass("visible");
					if (plugin.settings.typeKey === trimmed) return;
					plugin.settings.typeKey = trimmed;
					// The schema-changed trigger below persists settings (incl. the
					// new typeKey) via its handler, so no separate save is needed.
					// Reseed the watcher's lastSeenType cache so the next
					// type-change event compares against values under the new
					// key; inform the loader so inverse-lookup queries
					// regenerate against the new key; trigger schema-changed so
					// banner / chip / file-explorer icons refresh.
					plugin.typeWatcher?.reseed();
					plugin.loader.setTypeKey(trimmed);
					plugin.loader.trigger("schema-changed", plugin.loader.getAll());
					refresh();
				});
		});
	warnEl = setting.descEl.createDiv({ cls: "schema-inline-warning" });
}

function renderValidation(plugin: SchemaPlugin, parent: HTMLElement): void {
	const errs = plugin.loader.getValidationErrors();
	const errors = errs.filter((e) => e.level === "error");
	const warnings = errs.filter((e) => e.level === "warning");
	if (errors.length === 0 && warnings.length === 0) return;

	const wrap = parent.createDiv({ cls: "schema-validation-banner" });
	wrap.createEl("strong", {
		text: `Validation: ${errors.length} error${errors.length === 1 ? "" : "s"}, ${warnings.length} warning${warnings.length === 1 ? "" : "s"}`,
	});
	const ul = wrap.createEl("ul", { cls: "schema-validation-list" });
	for (const e of [...errors, ...warnings]) {
		ul.createEl("li", { text: `[${e.level}] ${e.type}: ${e.message}` });
	}
}

function populateTypeList(plugin: SchemaPlugin, list: HTMLElement, filterText: string): void {
	list.empty();
	const allTypes = plugin.loader.getAll().slice();
	const byName = new Map(allTypes.map((t) => [t.name, t] as const));
	const q = filterText.trim().toLowerCase();

	const matches = (s: { name: string; extends?: string; folder?: string }): boolean => {
		if (q.length === 0) return true;
		const hay = `${s.name} ${s.extends ?? ""} ${s.folder ?? ""}`.toLowerCase();
		return hay.includes(q);
	};

	const visible = new Set<string>();
	for (const t of allTypes) {
		if (!matches(t)) continue;
		let cur: string | undefined = t.name;
		const seen = new Set<string>();
		while (cur && !seen.has(cur)) {
			seen.add(cur);
			visible.add(cur);
			cur = byName.get(cur)?.extends;
		}
	}

	if (visible.size === 0) {
		list.createEl("div", {
			cls: "schema-empty",
			text: `No types match "${filterText}".`,
		});
		return;
	}

	const childrenOf = new Map<string, string[]>();
	const roots: string[] = [];
	for (const t of allTypes) {
		if (!visible.has(t.name)) continue;
		const parent = t.extends && visible.has(t.extends) ? t.extends : null;
		if (parent) {
			if (!childrenOf.has(parent)) childrenOf.set(parent, []);
			childrenOf.get(parent)!.push(t.name);
		} else {
			roots.push(t.name);
		}
	}
	const cmp = (a: string, b: string) => a.localeCompare(b);
	roots.sort(cmp);
	for (const arr of childrenOf.values()) arr.sort(cmp);

	const renderTree = (name: string, parentEl: HTMLElement) => {
		new TypeEditor(plugin, name).render(parentEl);
		const kids = childrenOf.get(name) ?? [];
		if (kids.length === 0) return;
		const childrenEl = parentEl.createDiv({ cls: "schema-type-children" });
		for (const k of kids) renderTree(k, childrenEl);
	};
	for (const r of roots) renderTree(r, list);
}

function renderFirstTypeWalkthrough(
	plugin: SchemaPlugin,
	parent: HTMLElement,
	refresh: () => void,
): void {
	const wrap = parent.createDiv({ cls: "schema-walkthrough" });
	wrap.createEl("h3", { text: "Welcome to Schema" });
	wrap.createEl("p", {
		cls: "schema-walkthrough-intro",
		text: "Define an object type once and every note of that object type gets the same folder, filename, properties, and visual identity.",
	});

	const steps = wrap.createEl("ol", { cls: "schema-walkthrough-steps" });
	[
		{
			title: "Define an object type",
			body: "Click \"+ Add object type\". Pick a name, folder, and filename pattern.",
		},
		{
			title: "Give it properties",
			body: "Expand the object type and add properties: text, link, date, formula, etc.",
		},
		{
			title: "Create notes",
			body: "Run \"Schema: New <object-type>\" from the command palette. Schema does the rest.",
		},
	].forEach((step) => {
		const li = steps.createEl("li");
		li.createEl("strong", { text: step.title });
		li.createEl("div", { cls: "schema-walkthrough-body", text: step.body });
	});

	const actions = wrap.createDiv({ cls: "schema-walkthrough-actions" });
	const addBtn = actions.createEl("button", {
		cls: "mod-cta",
		text: "+ Add an object type",
		attr: { type: "button" },
	});
	addBtn.addEventListener("click", () => {
		new AddTypeModal(plugin, refresh).open();
	});
	const importBtn = actions.createEl("button", {
		text: "Import starter schemas",
		attr: { type: "button" },
	});
	importBtn.addEventListener("click", () => {
		importStarterSchemas(plugin);
	});
}

