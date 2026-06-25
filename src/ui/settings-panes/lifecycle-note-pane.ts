import { Setting } from "obsidian";
import type SchemaPlugin from "../../main";

export function renderLifecycleNotePane(plugin: SchemaPlugin, parent: HTMLElement): void {
	const typeKey = plugin.settings.typeKey;

	new Setting(parent).setName("Automation").setHeading();

	new Setting(parent)
		.setName("Reshelve on object-type change")
		.setDesc(`When \`${typeKey}:\` changes, move the file to the new object type's folder and refresh its defaults.`)
		.addToggle((toggle) => {
			toggle
				.setValue(plugin.settings.autoReshelveOnTypeChange)
				.onChange(async (value) => {
					plugin.settings.autoReshelveOnTypeChange = value;
					await plugin.saveSettings();
				});
		});

	new Setting(parent)
		.setName("Auto-type by folder")
		.setDesc(`Files dropped into a mapped folder get the matching \`${typeKey}:\` property.`)
		.addToggle((toggle) => {
			toggle
				.setValue(plugin.settings.autoClassifyOnFolderMatch)
				.onChange(async (value) => {
					plugin.settings.autoClassifyOnFolderMatch = value;
					await plugin.saveSettings();
				});
		});

	new Setting(parent)
		.setName("Link on create")
		.setDesc(
			"When you create an object from inside a note (e.g. via the slash menu), insert a wikilink to it at the cursor."
		)
		.addToggle((toggle) => {
			toggle
				.setValue(plugin.settings.linkOnCreate)
				.onChange(async (value) => {
					plugin.settings.linkOnCreate = value;
					await plugin.saveSettings();
				});
		});

	new Setting(parent)
		.setName("Open new note")
		.setDesc("Where the new note opens when a link is inserted on create.")
		.addDropdown((dropdown) => {
			dropdown
				.addOption("tab", "New tab")
				.addOption("split", "Split pane")
				.addOption("stay", "Don't open")
				.setValue(plugin.settings.linkOnCreateOpen)
				.onChange(async (value) => {
					plugin.settings.linkOnCreateOpen = value as "tab" | "split" | "stay";
					await plugin.saveSettings();
				});
		});
}
