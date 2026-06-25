import { App, Modal, Setting } from "obsidian";

export type RemovePropertyChoice = "future-only" | "all-notes" | "cancel";

export interface RemovePropertyOptions {
	propertyName: string;
	objectTypeName: string;
	/** Number of existing notes of this object type that currently carry the
	 *  property as a frontmatter key. */
	affectedCount: number;
}

/**
 * Confirmation modal for removing a property from an object type. Lets the
 * user choose whether to leave existing notes alone or also strip the
 * property from every affected note.
 */
class RemovePropertyModal extends Modal {
	private readonly options: RemovePropertyOptions;
	private readonly resolver: (choice: RemovePropertyChoice) => void;
	private choice: RemovePropertyChoice = "future-only";
	private resolved = false;

	constructor(app: App, options: RemovePropertyOptions, resolver: (c: RemovePropertyChoice) => void) {
		super(app);
		this.options = options;
		this.resolver = resolver;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h3", {
			text: `Remove "${this.options.propertyName}" from "${this.options.objectTypeName}"`,
		});

		const count = this.options.affectedCount;
		const intro = contentEl.createEl("p");
		intro.setText(
			count === 0
				? `No existing notes of this object type have this property set.`
				: `${count} existing note${count === 1 ? "" : "s"} of this object type currently ${count === 1 ? "has" : "have"} this property.`
		);

		const futureLabel = contentEl.createEl("label", { cls: "schema-remove-property-option" });
		const futureRadio = futureLabel.createEl("input", { type: "radio", attr: { name: "scope" } });
		futureRadio.checked = true;
		futureLabel.createSpan({ text: "Apply only to new notes of this object type" });
		futureRadio.addEventListener("change", () => {
			if (futureRadio.checked) this.choice = "future-only";
		});

		const allLabel = contentEl.createEl("label", { cls: "schema-remove-property-option" });
		const allRadio = allLabel.createEl("input", { type: "radio", attr: { name: "scope" } });
		allLabel.createSpan({
			text:
				count === 0
					? "Also remove from all existing notes (none affected)"
					: `Also remove from all ${count} existing note${count === 1 ? "" : "s"} of this object type`,
		});
		if (count === 0) allRadio.disabled = true;
		allRadio.addEventListener("change", () => {
			if (allRadio.checked) this.choice = "all-notes";
		});

		new Setting(contentEl)
			.addButton((b) =>
				b
					.setButtonText("Remove")
					.setWarning()
					.onClick(() => this.commit())
			)
			.addButton((b) =>
				b.setButtonText("Cancel").onClick(() => {
					this.resolve("cancel");
					this.close();
				})
			);
	}

	private commit(): void {
		this.resolve(this.choice);
		this.close();
	}

	private resolve(choice: RemovePropertyChoice): void {
		if (this.resolved) return;
		this.resolved = true;
		this.resolver(choice);
	}

	onClose(): void {
		this.contentEl.empty();
		this.resolve("cancel");
	}
}

export function openRemovePropertyModal(
	app: App,
	options: RemovePropertyOptions
): Promise<RemovePropertyChoice> {
	return new Promise((resolve) => {
		new RemovePropertyModal(app, options, resolve).open();
	});
}
