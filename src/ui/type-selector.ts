import { ALL_FIELD_TYPES, type FieldType } from "../schema/types";

/** Short one-line description of what each field type does. Shown as the
 *  secondary line in the type selector popup, and (as a fallback) in tooltips
 *  or under read-only Type displays elsewhere in the UI. */
export const TYPE_DESCRIPTIONS: Record<FieldType, string> = {
	Input: "Single-line text. The default for free-form string values.",
	Number: "Numeric value. YAML stores as a number.",
	Boolean: "True / false toggle.",
	Select: "Single choice from a fixed list (inline values or sourced from a markdown file).",
	Cycle: "Single choice that advances through a fixed list on each click. No popup.",
	Multi: "Multiple free-form values stored as a YAML list.",
	File: "Wikilink to one note. Optionally constrained to instances of a target type.",
	MultiFile:
		"Wikilinks to many notes. Pairs with `inverse:` to auto-synthesize back-references on the target type.",
	Date: "Date only (YYYY-MM-DD).",
	DateTime: "Date and time (ISO 8601).",
	Time: "Time only (HH:mm).",
	Media: "Wikilink to one media file (image, PDF, etc.).",
	MultiMedia: "Wikilinks to many media files.",
	JSON: "Raw JSON value stored as a multi-line string.",
	YAML: "Raw YAML value stored as a multi-line string.",
	Icon: "A lucide icon name, edited with an icon picker. Used for visual identity.",
	Color: "A hex color, edited with a color swatch. Used for visual identity.",
	Formula:
		"Computed value. JS expression evaluated against the note's frontmatter on read.",
	Lookup: "Synthesized by the lookup runtime. Not user-editable.",
};

export interface TypeSelectorHandle {
	setValue(t: FieldType): void;
}

/**
 * Renders a custom dropdown for `FieldType` selection. Unlike the native
 * `<select>`, the popup row carries a secondary description line under the
 * name so the user can see what each type does without leaving the row.
 *
 * Positioning is relative to the trigger button (no body portal) so it scrolls
 * with the surrounding settings pane. Closes on outside click or Escape.
 */
export function renderTypeSelector(
	parent: HTMLElement,
	currentValue: FieldType,
	onChange: (next: FieldType) => void,
	disabled = false
): TypeSelectorHandle {
	let value = currentValue;
	const wrap = parent.createDiv({ cls: "schema-type-selector" });

	const button = wrap.createEl("button", {
		cls: "schema-type-selector-trigger",
		attr: { type: "button" },
	});
	const buttonLabel = button.createSpan({
		cls: "schema-type-selector-current",
		text: value,
	});
	button.createSpan({ cls: "schema-type-selector-chevron", text: "▾" });
	if (disabled) button.disabled = true;

	let popup: HTMLElement | null = null;
	let outsideHandler: ((e: MouseEvent) => void) | null = null;
	let escHandler: ((e: KeyboardEvent) => void) | null = null;

	const closePopup = () => {
		if (popup) {
			popup.remove();
			popup = null;
		}
		if (outsideHandler) {
			window.removeEventListener("click", outsideHandler, true);
			outsideHandler = null;
		}
		if (escHandler) {
			window.removeEventListener("keydown", escHandler);
			escHandler = null;
		}
	};

	const openPopup = () => {
		if (popup) {
			closePopup();
			return;
		}
		popup = wrap.createDiv({ cls: "schema-type-selector-popup" });
		for (const ft of ALL_FIELD_TYPES) {
			const row = popup.createDiv({ cls: "schema-type-selector-row" });
			if (ft === value) row.addClass("active");
			row.createDiv({ cls: "schema-type-selector-name", text: ft });
			row.createDiv({
				cls: "schema-type-selector-desc",
				text: TYPE_DESCRIPTIONS[ft] ?? "",
			});
			row.addEventListener("click", (e) => {
				e.stopPropagation();
				e.preventDefault();
				if (ft === value) {
					closePopup();
					return;
				}
				value = ft;
				buttonLabel.setText(ft);
				closePopup();
				onChange(ft);
			});
		}

		// Defer the outside-click binding so the open-click itself doesn't fire it.
		window.setTimeout(() => {
			outsideHandler = (e: MouseEvent) => {
				if (!popup) return;
				// The settings pane may have re-rendered the trigger away while the
				// popup was open; clean up the window listeners rather than leak them.
				if (!button.isConnected) return closePopup();
				const t = e.target as Node;
				if (popup.contains(t) || button.contains(t)) return;
				closePopup();
			};
			window.addEventListener("click", outsideHandler, true);
		}, 0);

		escHandler = (e: KeyboardEvent) => {
			if (!button.isConnected) return closePopup();
			if (e.key === "Escape") {
				e.preventDefault();
				closePopup();
			}
		};
		window.addEventListener("keydown", escHandler);
	};

	button.addEventListener("click", (e) => {
		if (disabled) return;
		e.stopPropagation();
		e.preventDefault();
		openPopup();
	});

	return {
		setValue: (t) => {
			value = t;
			buttonLabel.setText(t);
		},
	};
}
