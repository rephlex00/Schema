import { MarkdownView, type Command } from "obsidian";
import type SchemaPlugin from "../main";
import type { TypeSchema } from "../schema/types";
import { createInstance, isInstantiable } from "./create";

const COMMAND_PREFIX = "new-";

/**
 * Register or refresh `Schema: New <object-type>` commands so there's exactly
 * one per instantiable object type. Removes commands for object types that no
 * longer exist.
 *
 * Obsidian doesn't expose a public API to remove commands once registered, so
 * we work around it by storing references and overwriting via re-registration.
 * The plugin handles obsolete-command cleanup at the next reload.
 */
export class CreateCommandRegistry {
	private readonly plugin: SchemaPlugin;
	private registered = new Set<string>();

	constructor(plugin: SchemaPlugin) {
		this.plugin = plugin;
	}

	refresh(schemas: TypeSchema[]): void {
		const next = new Set<string>();
		for (const schema of schemas) {
			if (!isInstantiable(schema)) continue;
			// Default exposeCreateCommand to true (backwards compat).
			if (schema.exposeCreateCommand === false) continue;
			const id = COMMAND_PREFIX + schema.name;
			next.add(id);
			if (this.registered.has(id)) continue;

			const command: Command = {
				id,
				name: `New ${schema.name}`,
				callback: async () => {
					const fresh = this.plugin.loader.get(schema.name);
					if (!fresh) {
						console.warn(`[schema] type "${schema.name}" no longer loaded`);
						return;
					}
					// Capture the editor the command was issued from (slash menu or
					// palette) so createInstance can drop a wikilink at the cursor.
					const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
					const source = view?.editor
						? { editor: view.editor, file: view.file }
						: undefined;
					await createInstance(this.plugin, fresh, { source });
				},
			};
			this.plugin.addCommand(command);
			this.registered.add(id);
		}

		// We can't unregister stale commands at runtime; warn once if any disappeared.
		for (const id of this.registered) {
			if (!next.has(id)) {
				console.warn(
					`[schema] command "${id}" no longer maps to a type; will disappear on next plugin reload.`
				);
			}
		}
	}
}
