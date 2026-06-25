import { setIcon } from "obsidian";

/** True when `s` is a `#RRGGBB` hex color. */
export function isHex(s: string): boolean {
	return /^#[0-9A-Fa-f]{6}$/.test(s.trim());
}

/**
 * Color editor: a native `<input type="color">` swatch paired with a hex text
 * input. Appends its controls into `parent`. Calls `onChange` with the hex (or
 * raw text) value whenever either control changes.
 */
export function renderColorControl(
	parent: HTMLElement,
	current: string,
	onChange: (v: string) => void
): void {
	const wrap = parent.createDiv({ cls: "schema-color-control" });

	const swatch = wrap.createEl("input", { type: "color", cls: "schema-color-swatch" });
	swatch.value = isHex(current) ? current : "#888888";

	const text = wrap.createEl("input", { type: "text", cls: "schema-color-text" });
	text.value = current;
	text.placeholder = "#RRGGBB";

	swatch.addEventListener("input", () => {
		text.value = swatch.value;
		onChange(swatch.value);
	});
	text.addEventListener("change", () => {
		const v = text.value.trim();
		if (isHex(v)) swatch.value = v;
		onChange(v);
	});
}

/**
 * Icon editor: a text input for a lucide icon name plus a live preview. Appends
 * its controls into `parent`. Calls `onChange` with the trimmed name on commit.
 */
export function renderIconControl(
	parent: HTMLElement,
	current: string,
	onChange: (v: string) => void
): void {
	const wrap = parent.createDiv({ cls: "schema-icon-control" });
	const preview = wrap.createSpan({ cls: "schema-icon-preview" });
	if (current) setIcon(preview, current);

	const input = wrap.createEl("input", { type: "text", cls: "schema-icon-text" });
	input.value = current;
	input.placeholder = "lucide icon name (e.g. user)";

	input.addEventListener("input", () => {
		preview.empty();
		if (input.value) setIcon(preview, input.value);
	});
	input.addEventListener("change", () => onChange(input.value.trim()));
}
