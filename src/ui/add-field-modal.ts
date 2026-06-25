import { App, Modal, Setting } from "obsidian";
import { type FieldSchema, type FieldType } from "../schema/types";
import { renderTypeSelector, type TypeSelectorHandle } from "./type-selector";

export interface AddFieldResult {
	field: FieldSchema;
	/** Kept on the result for backward-compat with the field-list-editor's
	 *  add-field flow. Always `true` - every field is global; see
	 *  memory/fields-default-global.md. */
	makeGlobal: true;
}

/**
 * Modal for adding a new property to an object type. Captures name + data
 * type (+ optional promptOnCreate label) in a single step.
 *
 * Every property is global. There is no "local" alternative. When the typed
 * name matches an existing global, the modal locks the data-type input onto
 * the global's definition (you can only add the link + per-usage
 * promptOnCreate); when the name is new, it creates a new global with the
 * chosen data type.
 */
export class AddFieldModal extends Modal {
	private readonly existingNames: Set<string>;
	private readonly resolver: (result: AddFieldResult | null) => void;
	private readonly existingGlobals: Record<string, FieldSchema>;
	private resolved = false;

	private name = "";
	private type: FieldType = "Input";
	private promptOnCreate = "";

	constructor(
		app: App,
		existingNames: string[],
		existingGlobals: Record<string, FieldSchema>,
		resolver: (result: AddFieldResult | null) => void
	) {
		super(app);
		this.existingNames = new Set(existingNames);
		this.existingGlobals = existingGlobals;
		this.resolver = resolver;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h3", { text: "Add property" });

		const errorEl = contentEl.createEl("div", { cls: "schema-modal-error" });
		errorEl.hide();

		// Hint shown when the typed name matches an existing global field.
		const linkHint = contentEl.createEl("div", {
			cls: "schema-inline-warning schema-field-name-hint",
		});

		let typeSelector: TypeSelectorHandle | null = null;

		const updateLinkHint = () => {
			const global = this.existingGlobals[this.name];
			linkHint.empty();
			linkHint.removeClass("visible");
			if (global) {
				linkHint.setText(
					`"${this.name}" already exists as a ${global.type} property. This object type will share that definition. Change the data type from Settings → Schema → Global properties.`
				);
				linkHint.addClass("visible");
				// Snap data type to the global's so the preview matches what'll be saved.
				this.type = global.type;
				typeSelector?.setValue(global.type);
			}
		};

		new Setting(contentEl)
			.setName("Name")
			.setDesc("The name as it appears in the note's YAML. Must be unique within this object type. If a property with this name already exists anywhere, this object type will share that definition.")
			.addText((t) => {
				t.setPlaceholder("e.g. firstname").onChange((v) => {
					this.name = v.trim();
					errorEl.hide();
					updateLinkHint();
				});
				t.inputEl.addEventListener("keydown", (ev) => {
					if (ev.key === "Enter") {
						ev.preventDefault();
						this.confirm(errorEl);
					}
				});
				window.setTimeout(() => t.inputEl.focus(), 0);
			});

		contentEl.append(linkHint);

		const typeSetting = new Setting(contentEl)
			.setName("Data type")
			.setDesc("What sort of value this property holds. Decides which editor shows up in the note and how the value is stored.");
		typeSelector = renderTypeSelector(typeSetting.controlEl, this.type, (next) => {
			this.type = next;
		});

		new Setting(contentEl)
			.setName("Ask for this value on create")
			.setDesc("Optional. If filled in, you'll be prompted for this value (using this label) when you create a new note of this object type.")
			.addText((t) => {
				t.setPlaceholder("e.g. First name").onChange((v) => {
					this.promptOnCreate = v.trim();
				});
			});

		new Setting(contentEl)
			.addButton((btn) =>
				btn
					.setButtonText("Add property")
					.setCta()
					.onClick(() => this.confirm(errorEl))
			)
			.addButton((btn) => btn.setButtonText("Cancel").onClick(() => this.close()));
	}

	private confirm(errorEl: HTMLElement): void {
		if (this.name.length === 0) {
			this.showError(errorEl, "Name is required.");
			return;
		}
		if (this.existingNames.has(this.name)) {
			this.showError(errorEl, `This object type already has a "${this.name}" property.`);
			return;
		}
		if (this.existingGlobals[this.name]?.universal) {
			this.showError(
				errorEl,
				`"${this.name}" is a universal property and is already on every object type.`
			);
			return;
		}
		const field: FieldSchema = { name: this.name, type: this.type };
		if (this.promptOnCreate.length > 0) field.promptOnCreate = this.promptOnCreate;
		this.resolved = true;
		this.resolver({ field, makeGlobal: true });
		this.close();
	}

	private showError(errorEl: HTMLElement, message: string): void {
		errorEl.setText(message);
		errorEl.show();
	}

	onClose(): void {
		this.contentEl.empty();
		if (!this.resolved) this.resolver(null);
	}
}

/** Promise wrapper around AddFieldModal. Resolves to `{ field, makeGlobal }` or null. */
export function promptForNewField(
	app: App,
	existingNames: string[],
	existingGlobals: Record<string, FieldSchema> = {}
): Promise<AddFieldResult | null> {
	return new Promise((resolve) => {
		new AddFieldModal(app, existingNames, existingGlobals, resolve).open();
	});
}
