import type SchemaPlugin from "../../main";
import { GlobalFieldsEditor } from "../global-fields-editor";

export function renderPropertiesFieldsPane(
	plugin: SchemaPlugin,
	parent: HTMLElement,
	refresh: () => void,
): void {
	new GlobalFieldsEditor(plugin, refresh).render(parent);
}
