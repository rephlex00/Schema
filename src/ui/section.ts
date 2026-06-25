import { setIcon } from "obsidian";

export interface SectionOptions {
	title: string;
	count?: string;
	description?: string;
	/** Whether the section starts expanded. Defaults to collapsed. */
	defaultOpen?: boolean;
}

/**
 * Render a collapsible section card: a `<summary>` header strip (chevron +
 * title + optional count chip + short description) over a `<details>` body that
 * the caller fills with rows. Collapsed by default so the editor opens as a
 * scannable list of section headers; click the header to expand.
 *
 * The per-object-type editor (and the global-fields editor) uses this to give
 * every section a single bordered card. Rows inside the section are flat
 * (no per-row card backgrounds) - see `.schema-section .setting-item` in
 * styles.css.
 */
export function renderSection(parent: HTMLElement, opts: SectionOptions): HTMLElement {
	const section = parent.createEl("details", { cls: "schema-section" });
	section.open = opts.defaultOpen ?? false;

	const header = section.createEl("summary", { cls: "schema-section-header" });
	const chevron = header.createSpan({ cls: "schema-section-chevron" });
	setIcon(chevron, "chevron-right");

	const heading = header.createDiv({ cls: "schema-section-heading" });
	const titleRow = heading.createDiv({ cls: "schema-section-title-row" });
	titleRow.createSpan({ cls: "schema-section-title", text: opts.title });
	if (opts.count) {
		titleRow.createSpan({ cls: "schema-section-count", text: opts.count });
	}
	if (opts.description) {
		heading.createDiv({ cls: "schema-section-desc", text: opts.description });
	}

	return section.createDiv({ cls: "schema-section-body" });
}
