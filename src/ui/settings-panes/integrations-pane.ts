import { Setting } from "obsidian";
import { syncGraphColors } from "../../lifecycle/graph-colors";
import { syncNotebookNavigator } from "../../lifecycle/notebook-navigator-sync";
import { TemplaterBridge } from "../../lifecycle/templater-bridge";
import type SchemaPlugin from "../../main";

/**
 * Integrations pane. Consolidates the three former one-button panes (Query and
 * templating engines, Graph view, Notebook Navigator) into a single place for
 * everything that talks to another plugin or Obsidian core surface.
 */
export function renderIntegrationsPane(plugin: SchemaPlugin, parent: HTMLElement): void {
	const typeKey = plugin.settings.typeKey;

	new Setting(parent).setName("Engines").setHeading();

	const dataviewDesc = plugin.lookups.usingDataview()
		? "Dataview is installed and powering lookups."
		: "Built-in fallback. Supports `dv.pages(...).filter(...)` only. Install Dataview for full power.";
	new Setting(parent).setName("Query engine").setDesc(dataviewDesc).setDisabled(true);

	const templaterInstalled = new TemplaterBridge(plugin.app).isInstalled();
	const templaterDesc = templaterInstalled
		? "Templater is installed. Body templates can render."
		: "Templater is not installed. Body templates are disabled until you install it.";
	new Setting(parent).setName("Templating engine").setDesc(templaterDesc).setDisabled(true);

	new Setting(parent).setName("Sync").setHeading();

	new Setting(parent)
		.setName("Sync graph colors")
		.setDesc(
			"Writes each object type's color into Graph view's color groups. Re-run after changing an object type's color. Manual color groups are preserved."
		)
		.addButton((btn) => {
			btn.setButtonText("Sync now")
				.setCta()
				.onClick(() => void syncGraphColors(plugin));
		});

	new Setting(parent)
		.setName("Sync Notebook Navigator")
		.setDesc(
			`Writes each object type's color and icon onto its \`${typeKey}\` value in Notebook Navigator, so its sidebar and file list match the note's banner. First add \`${typeKey}\` as a property in Notebook Navigator's navigation. Re-run after changing a type's color or icon.`
		)
		.addButton((btn) => {
			btn.setButtonText("Sync now")
				.setCta()
				.onClick(() => void syncNotebookNavigator(plugin));
		});
}
