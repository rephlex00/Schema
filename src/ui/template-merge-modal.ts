import { App, Modal, Setting } from "obsidian";

export type MergeChoice = "replace" | "merge" | "cancel";

/**
 * Asks the user what to do when applying a body template to a note that
 * already has body content.
 *
 * - replace: drop existing body, use new template
 * - merge: new template at top, separator, old body below
 * - cancel: do nothing
 */
export class TemplateMergeModal extends Modal {
	private readonly typeName: string;
	private readonly resolver: (choice: MergeChoice) => void;
	private resolved = false;

	constructor(app: App, typeName: string, resolver: (choice: MergeChoice) => void) {
		super(app);
		this.typeName = typeName;
		this.resolver = resolver;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h3", { text: "Apply body template?" });
		contentEl.createEl("p", {
			text: `This note has existing body content and the new object type "${this.typeName}" has a body template. How should it be applied?`,
		});

		const list = contentEl.createEl("ul");
		const li1 = list.createEl("li");
		li1.createEl("strong", { text: "Replace" });
		li1.appendText(": drop existing body, use the new template only.");
		const li2 = list.createEl("li");
		li2.createEl("strong", { text: "Merge" });
		li2.appendText(": new template at top, then a separator, then existing body.");
		const li3 = list.createEl("li");
		li3.createEl("strong", { text: "Cancel" });
		li3.appendText(": leave the body untouched.");

		new Setting(contentEl)
			.addButton((btn) =>
				btn
					.setButtonText("Replace")
					.setWarning()
					.onClick(() => this.choose("replace"))
			)
			.addButton((btn) =>
				btn
					.setButtonText("Merge")
					.setCta()
					.onClick(() => this.choose("merge"))
			)
			.addButton((btn) =>
				btn.setButtonText("Cancel").onClick(() => this.choose("cancel"))
			);
	}

	private choose(c: MergeChoice): void {
		this.resolved = true;
		this.resolver(c);
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
		if (!this.resolved) this.resolver("cancel");
	}
}

export function askMergeChoice(app: App, typeName: string): Promise<MergeChoice> {
	return new Promise((resolve) => {
		new TemplateMergeModal(app, typeName, resolve).open();
	});
}
