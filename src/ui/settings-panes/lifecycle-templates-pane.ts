import { Setting } from "obsidian";
import { TemplaterBridge } from "../../lifecycle/templater-bridge";
import type SchemaPlugin from "../../main";
import { FolderSuggest } from "../file-suggest";

export function renderLifecycleTemplatesPane(plugin: SchemaPlugin, parent: HTMLElement): void {
	const templaterInstalled = new TemplaterBridge(plugin.app).isInstalled();

	new Setting(parent).setName("Body templates").setHeading();

	new Setting(parent)
		.setName("Templates folder")
		.setDesc("Where body-template lookups search. Leave blank to search the whole vault.")
		.addText((t) => {
			t.setValue(plugin.settings.templatesFolder)
				.setPlaceholder("Templates")
				.onChange(async (v) => {
					plugin.settings.templatesFolder = v.trim();
					await plugin.saveSettings();
				});
			new FolderSuggest(plugin.app, t.inputEl).onSelect(async (folder) => {
				t.setValue(folder.path);
				plugin.settings.templatesFolder = folder.path;
				await plugin.saveSettings();
			});
		});

	const autoPick = new Setting(parent)
		.setName("Auto-pick body template")
		.setDesc(
			templaterInstalled
				? "Falls back to `<object-type>.md` under the templates folder when an object type has no explicit template."
				: "Falls back to `<object-type>.md` under the templates folder when an object type has no explicit template. Requires Templater."
		)
		.addToggle((toggle) => {
			toggle
				.setValue(plugin.settings.autoBodyTemplateByTypeName)
				.setDisabled(!templaterInstalled)
				.onChange(async (value) => {
					plugin.settings.autoBodyTemplateByTypeName = value;
					await plugin.saveSettings();
				});
		});
	if (!templaterInstalled) {
		autoPick.settingEl.addClass("schema-setting-disabled");
	}
}
