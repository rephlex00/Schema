import { Notice, Plugin } from "obsidian";

interface SchemaSettings {
	autoReshelveOnTypeChange: boolean;
}

const DEFAULT_SETTINGS: SchemaSettings = {
	autoReshelveOnTypeChange: true,
};

export default class SchemaPlugin extends Plugin {
	settings: SchemaSettings = DEFAULT_SETTINGS;

	async onload() {
		await this.loadSettings();

		this.addCommand({
			id: "hello",
			name: "Hello",
			callback: () => {
				new Notice("Schema plugin loaded.");
				console.log("[schema] Hello from the Schema plugin.");
			},
		});

		console.log("[schema] Plugin loaded.");
	}

	onunload() {
		console.log("[schema] Plugin unloaded.");
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
