import type SchemaPlugin from "../../main";
import { CustomFiltersEditor } from "../custom-filters-editor";

export function renderPropertiesFiltersPane(
	plugin: SchemaPlugin,
	parent: HTMLElement,
	refresh: () => void,
): void {
	new CustomFiltersEditor(plugin, refresh).render(parent);
}
