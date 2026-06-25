import { Setting, TFile, setIcon } from "obsidian";
import type SchemaPlugin from "../main";
import { synthesizedInverseLookups } from "../schema/resolve";
import type { TypeSchema } from "../schema/types";
import { readTypeKey } from "../util/frontmatter";
import { renderSection } from "./section";

const SAMPLE_LIMIT = 5;

interface BacklinkInfo {
	name: string;
	sourceTypes: string[];
	fieldName: string;
}

/**
 * Render Backlinks cards for a type. Each card shows where the backlinks
 * list came from (which source object type and property), a sample of the
 * notes currently linking, and small controls for editing.
 *
 * Detection: a "backlink" is a synthesized inverse lookup, i.e. a lookup
 * present on the resolved schema but absent from the raw schema's lookups.
 */
export function renderBacklinksCards(
	plugin: SchemaPlugin,
	parent: HTMLElement,
	rawSchema: TypeSchema
): void {
	const synthesized = synthesizedInverseLookups(plugin.loader.rawMap(), rawSchema.name);
	const rawNames = new Set(rawSchema.lookups.map((l) => l.name));
	const cards = synthesized.filter((s) => !rawNames.has(s.name));

	const body = renderSection(parent, {
		title: "Backlinks",
		count: String(cards.length),
		description:
			cards.length === 0
				? "No backlinks yet. To create one: open a global property of type File or MultiFile that targets this object type, and set its Backlinks name."
				: "Auto-generated lists showing what links here. Each card corresponds to a Backlinks name set on a source property.",
	});

	for (const info of cards) {
		renderCard(plugin, body, rawSchema, info);
	}
}

function renderCard(
	plugin: SchemaPlugin,
	parent: HTMLElement,
	rawSchema: TypeSchema,
	info: BacklinkInfo
): void {
	const card = parent.createDiv({ cls: "schema-backlinks-card" });
	card.setAttr("data-schema-anchor", `backlink:${info.name}`);

	const header = card.createDiv({ cls: "schema-backlinks-card-header" });
	const iconEl = header.createSpan({ cls: "schema-backlinks-card-icon" });
	setIcon(iconEl, "arrow-left-to-line");
	header.createEl("strong", { cls: "schema-backlinks-card-name", text: info.name });

	const desc = card.createDiv({ cls: "schema-backlinks-card-desc" });
	desc.setText(describeBacklink(info));

	const sample = card.createDiv({ cls: "schema-backlinks-card-sample" });
	sample.setText("(loading…)");
	void renderSample(plugin, sample, rawSchema, info);

	const footer = card.createDiv({ cls: "schema-backlinks-card-footer" });

	// Edit-on-source button.
	new Setting(footer)
		.addButton((b) => {
			b.setButtonText(`Edit on \`${info.fieldName}\``).onClick(() => {
				plugin.navigateSettings?.(
					"properties-fields",
					`global-property:${info.fieldName}`
				);
			});
		})
		.addDropdown((d) => {
			d.addOption("frontmatter", "Show in frontmatter (default)");
			d.addOption("block", "Show as inline block");
			const current = rawSchema.backlinkOverrides?.[info.name]?.render ?? "frontmatter";
			d.setValue(current);
			d.onChange((v) => {
				const next: Record<string, { render?: "frontmatter" | "block" }> = {
					...(rawSchema.backlinkOverrides ?? {}),
				};
				if (v === "frontmatter") {
					delete next[info.name];
				} else {
					next[info.name] = { render: v as "frontmatter" | "block" };
				}
				plugin.loader.update(rawSchema.name, {
					backlinkOverrides: Object.keys(next).length > 0 ? next : undefined,
				});
			});
		});
}

function describeBacklink(info: BacklinkInfo): string {
	const sources =
		info.sourceTypes.length === 1
			? info.sourceTypes[0]
			: info.sourceTypes.slice(0, -1).join(", ") + ` and ${info.sourceTypes.slice(-1)}`;
	return `Backlinks from ${sources} notes via their \`${info.fieldName}\` property.`;
}

async function renderSample(
	plugin: SchemaPlugin,
	el: HTMLElement,
	rawSchema: TypeSchema,
	info: BacklinkInfo
): Promise<void> {
	el.empty();
	const exampleNote = pickExampleNote(plugin, rawSchema.name);
	if (!exampleNote) {
		el.setText(`(no notes of object type "${rawSchema.name}" yet)`);
		return;
	}

	const resolved = plugin.loader.getResolved(rawSchema.name);
	const lookup = resolved?.lookups.find((l) => l.name === info.name);
	if (!lookup) {
		el.setText("(unable to resolve query)");
		return;
	}

	try {
		const result = await plugin.lookups.run(lookup.query, exampleNote);
		// The settings pane may have re-rendered while the query ran, detaching
		// this element; don't write into orphaned DOM.
		if (!el.isConnected) return;
		if (result.files.length === 0) {
			el.setText(`No notes currently link to "${exampleNote.basename}" via this property.`);
			return;
		}

		const intro = el.createDiv({ cls: "schema-backlinks-card-sample-intro" });
		intro.setText(
			`${result.files.length} link${result.files.length === 1 ? "s" : "s"} to "${exampleNote.basename}":`
		);

		const list = el.createEl("ul", { cls: "schema-backlinks-card-sample-list" });
		for (const f of result.files.slice(0, SAMPLE_LIMIT)) {
			const li = list.createEl("li");
			const a = li.createEl("a", { text: f.basename, href: "#" });
			a.addEventListener("click", (e) => {
				e.preventDefault();
				void plugin.app.workspace.openLinkText(f.path, "", false);
			});
		}
		if (result.files.length > SAMPLE_LIMIT) {
			el.createDiv({
				cls: "schema-backlinks-card-sample-more",
				text: `+ ${result.files.length - SAMPLE_LIMIT} more`,
			});
		}
	} catch (err) {
		el.setText(`Error: ${err instanceof Error ? err.message : String(err)}`);
	}
}

/** Find a representative note of this object type to use as the `current`
 *  binding for the sample query. Returns the first match. */
function pickExampleNote(plugin: SchemaPlugin, typeName: string): TFile | null {
	const typeKey = plugin.settings.typeKey;
	for (const file of plugin.app.vault.getMarkdownFiles()) {
		const cache = plugin.app.metadataCache.getFileCache(file);
		const t = readTypeKey(cache?.frontmatter as Record<string, unknown> | undefined, typeKey);
		if (t === typeName) return file;
	}
	return null;
}
