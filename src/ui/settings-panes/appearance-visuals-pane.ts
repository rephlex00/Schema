import { Setting, setIcon } from "obsidian";
import type SchemaPlugin from "../../main";

const SAMPLE_TYPE = "person";
const SAMPLE_ICON = "user";
const SAMPLE_COLOR = "#4A90E2";
const SAMPLE_FILENAME = "Jane Smith.md";
const SAMPLE_FOLDER = "Facts/People";

export function renderAppearanceVisualsPane(plugin: SchemaPlugin, parent: HTMLElement): void {
	const banner = new Setting(parent)
		.setName("Object-type banner")
		.setDesc("Colored strip across the top of typed notes showing icon, object type, and ancestry breadcrumb.")
		.addToggle((toggle) => {
			toggle
				.setValue(plugin.settings.showTypeBanner)
				.onChange(async (value) => {
					plugin.settings.showTypeBanner = value;
					await plugin.saveSettings();
					if (value) plugin.typeBanner.start();
					else plugin.typeBanner.stop();
				});
		});
	renderBannerPreview(banner.descEl);

	const chrome = new Setting(parent)
		.setName("Tint tab and header")
		.setDesc("Extends the object-type color across the file tab and the view header so they read as one colored block with the banner. Requires the object-type banner.")
		.addToggle((toggle) => {
			toggle
				.setValue(plugin.settings.tintTabAndHeader)
				.onChange(async (value) => {
					plugin.settings.tintTabAndHeader = value;
					await plugin.saveSettings();
					plugin.typeBanner.refresh();
				});
		});
	renderChromeTintPreview(chrome.descEl);

	const chip = new Setting(parent)
		.setName("Object-type chip")
		.setDesc(`Replaces the plain object-type property value with a colored pill showing the object type's icon and name.`)
		.addToggle((toggle) => {
			toggle
				.setValue(plugin.settings.replaceTypePropertyWithChip)
				.onChange(async (value) => {
					plugin.settings.replaceTypePropertyWithChip = value;
					await plugin.saveSettings();
					if (value) plugin.typeChipProperty.start();
					else plugin.typeChipProperty.stop();
				});
		});
	renderChipPreview(chip.descEl, plugin.settings.typeKey);

	const explorer = new Setting(parent)
		.setName("File-list icons")
		.setDesc("Prepends each typed file's icon next to its name in the file list.")
		.addToggle((toggle) => {
			toggle
				.setValue(plugin.settings.showFileExplorerIcons)
				.onChange(async (value) => {
					plugin.settings.showFileExplorerIcons = value;
					await plugin.saveSettings();
					if (value) plugin.fileExplorerIcons.start();
					else plugin.fileExplorerIcons.stop();
				});
		});
	renderFileExplorerPreview(explorer.descEl);

	const syncTabTitle = () => {
		const shouldRun =
			plugin.settings.tabTitleProperty.trim() !== "" || plugin.settings.showTabIcon;
		const running = plugin.tabTitle.isRunning();
		if (shouldRun && !running) plugin.tabTitle.start();
		else if (!shouldRun && running) plugin.tabTitle.stop();
		else if (shouldRun && running) plugin.tabTitle.refresh();
	};

	new Setting(parent)
		.setName("Tab title from property")
		.setDesc("Frontmatter property whose value replaces the filename in the tab bar (e.g. title). Tabs fall back to the filename when the property is missing. Leave empty to keep filenames.")
		.addText((text) => {
			text.setPlaceholder("e.g. title")
				.setValue(plugin.settings.tabTitleProperty)
				.onChange(async (value) => {
					plugin.settings.tabTitleProperty = value;
					await plugin.saveSettings();
					syncTabTitle();
				});
		});

	const tabIcon = new Setting(parent)
		.setName("Tab icon")
		.setDesc("Prefixes each typed note's tab with its object-type icon, colored with the type color.")
		.addToggle((toggle) => {
			toggle
				.setValue(plugin.settings.showTabIcon)
				.onChange(async (value) => {
					plugin.settings.showTabIcon = value;
					await plugin.saveSettings();
					syncTabTitle();
				});
		});
	renderTabPreview(tabIcon.descEl);
}

function renderTabPreview(parent: HTMLElement): void {
	const wrap = parent.createDiv({ cls: "schema-appearance-preview schema-tab-preview" });
	const tab = wrap.createDiv({ cls: "schema-tab-preview-tab" });
	const icon = tab.createSpan({ cls: "schema-tab-icon" });
	icon.style.setProperty("--type-color", SAMPLE_COLOR);
	setIcon(icon, SAMPLE_ICON);
	tab.createSpan({ text: SAMPLE_FILENAME.replace(/\.md$/, "") });
}

function renderBannerPreview(parent: HTMLElement): void {
	const wrap = parent.createDiv({ cls: "schema-appearance-preview" });
	const bannerEl = wrap.createDiv({ cls: "schema-type-banner" });
	bannerEl.style.setProperty("--type-color", SAMPLE_COLOR);
	const iconEl = bannerEl.createSpan({ cls: "schema-type-banner-icon" });
	setIcon(iconEl, SAMPLE_ICON);
	const nameEl = bannerEl.createSpan({ cls: "schema-type-banner-name" });
	nameEl.createSpan({ cls: "schema-type-banner-leaf", text: SAMPLE_TYPE });
	bannerEl.createSpan({ cls: "schema-type-banner-label", text: "Schema" });
}

function renderChromeTintPreview(parent: HTMLElement): void {
	const wrap = parent.createDiv({ cls: "schema-appearance-preview schema-chrome-preview" });
	wrap.style.setProperty("--type-color", SAMPLE_COLOR);

	// Tab bar with a single tinted tab.
	const tabbar = wrap.createDiv({ cls: "schema-chrome-preview-tabbar" });
	const tab = tabbar.createDiv({ cls: "schema-chrome-preview-tab schema-chrome-tinted" });
	tab.createSpan({ text: SAMPLE_FILENAME.replace(/\.md$/, "") });

	// View header (the space between tab and banner).
	wrap.createDiv({ cls: "schema-chrome-preview-header schema-chrome-tinted" });

	// The banner itself.
	const bannerEl = wrap.createDiv({ cls: "schema-type-banner" });
	const iconEl = bannerEl.createSpan({ cls: "schema-type-banner-icon" });
	setIcon(iconEl, SAMPLE_ICON);
	const nameEl = bannerEl.createSpan({ cls: "schema-type-banner-name" });
	nameEl.createSpan({ cls: "schema-type-banner-leaf", text: SAMPLE_TYPE });
	bannerEl.createSpan({ cls: "schema-type-banner-label", text: "Schema" });
}

function renderChipPreview(parent: HTMLElement, typeKey: string): void {
	const wrap = parent.createDiv({ cls: "schema-appearance-preview schema-appearance-preview-chip" });

	const offRow = wrap.createDiv({ cls: "schema-appearance-preview-row" });
	offRow.createSpan({ cls: "schema-appearance-preview-key", text: typeKey });
	offRow.createSpan({ cls: "schema-appearance-preview-value", text: SAMPLE_TYPE });

	const onRow = wrap.createDiv({ cls: "schema-appearance-preview-row" });
	onRow.createSpan({ cls: "schema-appearance-preview-key", text: typeKey });
	// Mirror the production DOM: the chip is absolutely positioned within a
	// `position: relative` value cell (`.schema-has-type-chip`), which also hides
	// the underlying value text. Without this positioned host the chip would
	// escape to the nearest positioned ancestor (the settings modal).
	const valueCell = onRow.createSpan({
		cls: "schema-appearance-preview-value schema-has-type-chip",
	});
	valueCell.createSpan({ text: SAMPLE_TYPE });
	const chip = valueCell.createSpan({ cls: "schema-type-property-chip" });
	chip.style.setProperty("--type-color", SAMPLE_COLOR);
	const chipIcon = chip.createSpan({ cls: "schema-type-icon" });
	setIcon(chipIcon, SAMPLE_ICON);
	chip.createSpan({ cls: "schema-type-name", text: SAMPLE_TYPE });
}

function renderFileExplorerPreview(parent: HTMLElement): void {
	const wrap = parent.createDiv({ cls: "schema-appearance-preview" });
	const row = wrap.createDiv({ cls: "schema-appearance-preview-explorer" });
	const icon = row.createSpan({ cls: "schema-file-explorer-icon" });
	icon.style.setProperty("--type-color", SAMPLE_COLOR);
	setIcon(icon, SAMPLE_ICON);
	row.createSpan({ text: SAMPLE_FILENAME });
}
