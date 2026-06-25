import type SchemaPlugin from "../../main";
import { FolderMappingsEditor } from "../folder-mappings-editor";

export function renderLifecycleMappingsPane(
	plugin: SchemaPlugin,
	parent: HTMLElement,
	refresh: () => void,
): void {
	new FolderMappingsEditor(plugin, refresh).render(parent);
}
