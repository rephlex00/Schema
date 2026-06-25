import { App, Modal, Setting } from "obsidian";

export interface PromptField {
	/** Frontmatter field name (also the key in the result dict). */
	key: string;
	/** Label shown to the user. */
	label: string;
	/** Optional default value. */
	defaultValue?: string;
	/** Optional placeholder text. */
	placeholder?: string;
}

/**
 * Modal that asks the user for one or more text values.
 *
 * Resolves with `null` if the user cancels (Escape or close), or a values dict
 * keyed by `key` if they confirm. Empty strings are kept as empty strings (the
 * caller decides if a field is required).
 */
export class PromptModal extends Modal {
	private readonly title: string;
	private readonly fields: PromptField[];
	private readonly resolver: (value: Record<string, string> | null) => void;
	private values: Record<string, string> = {};
	private confirmed = false;

	constructor(
		app: App,
		title: string,
		fields: PromptField[],
		resolver: (value: Record<string, string> | null) => void
	) {
		super(app);
		this.title = title;
		this.fields = fields;
		this.resolver = resolver;
		for (const f of fields) {
			this.values[f.key] = f.defaultValue ?? "";
		}
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h3", { text: this.title });

		const inputs: HTMLInputElement[] = [];

		for (const field of this.fields) {
			const setting = new Setting(contentEl).setName(field.label);
			setting.addText((text) => {
				text.setValue(this.values[field.key]);
				if (field.placeholder) text.setPlaceholder(field.placeholder);
				text.onChange((v) => {
					this.values[field.key] = v;
				});
				inputs.push(text.inputEl);
				text.inputEl.addEventListener("keydown", (ev) => {
					if (ev.key === "Enter") {
						ev.preventDefault();
						const idx = inputs.indexOf(text.inputEl);
						if (idx >= 0 && idx < inputs.length - 1) {
							inputs[idx + 1].focus();
						} else {
							this.confirm();
						}
					}
				});
			});
		}

		new Setting(contentEl)
			.addButton((btn) =>
				btn
					.setButtonText("Create")
					.setCta()
					.onClick(() => this.confirm())
			)
			.addButton((btn) => btn.setButtonText("Cancel").onClick(() => this.cancel()));

		// Focus first input when opened.
		window.setTimeout(() => inputs[0]?.focus(), 0);
	}

	onClose(): void {
		this.contentEl.empty();
		if (!this.confirmed) {
			this.resolver(null);
		}
	}

	private confirm(): void {
		this.confirmed = true;
		this.resolver({ ...this.values });
		this.close();
	}

	private cancel(): void {
		this.confirmed = false;
		this.close();
	}
}

/**
 * Convenience wrapper that returns a Promise.
 */
export function promptForValues(
	app: App,
	title: string,
	fields: PromptField[]
): Promise<Record<string, string> | null> {
	return new Promise((resolve) => {
		new PromptModal(app, title, fields, resolve).open();
	});
}

/**
 * Single-string prompt. Resolves to the trimmed string, or null on cancel.
 * Used in place of `window.prompt()` (which Electron disables).
 */
export async function promptForString(
	app: App,
	title: string,
	label: string,
	placeholder?: string
): Promise<string | null> {
	const result = await promptForValues(app, title, [
		{ key: "value", label, placeholder },
	]);
	if (result === null) return null;
	const v = (result.value ?? "").trim();
	return v.length === 0 ? null : v;
}

/**
 * Yes/no confirmation. Resolves to true if confirmed, false otherwise.
 * Used in place of `window.confirm()` (which Electron also disables).
 */
export class ConfirmModal extends Modal {
	private readonly message: string;
	private readonly resolver: (ok: boolean) => void;
	private resolved = false;

	constructor(app: App, message: string, resolver: (ok: boolean) => void) {
		super(app);
		this.message = message;
		this.resolver = resolver;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("p", { text: this.message });
		new Setting(contentEl)
			.addButton((btn) =>
				btn
					.setButtonText("OK")
					.setCta()
					.onClick(() => {
						this.resolved = true;
						this.resolver(true);
						this.close();
					})
			)
			.addButton((btn) =>
				btn.setButtonText("Cancel").onClick(() => {
					this.resolved = true;
					this.resolver(false);
					this.close();
				})
			);
	}

	onClose(): void {
		this.contentEl.empty();
		if (!this.resolved) this.resolver(false);
	}
}

export function confirmAction(app: App, message: string): Promise<boolean> {
	return new Promise((resolve) => {
		new ConfirmModal(app, message, resolve).open();
	});
}
