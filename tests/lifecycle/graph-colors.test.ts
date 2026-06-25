import { describe, expect, it } from "vitest";
import {
	buildColorGroups,
	hexToRgbInt,
	typeColorQuery,
	type GraphColorGroup,
} from "../../src/lifecycle/graph-colors";
import type { TypeSchema } from "../../src/schema/types";

/** Minimal TypeSchema fixture - only the fields graph-colors reads. */
function type(name: string, color?: string): TypeSchema {
	return {
		name,
		tags: [],
		fields: [],
		lookups: [],
		defaults: color === undefined ? {} : { color },
	};
}

describe("hexToRgbInt", () => {
	it("converts 6-digit hex to the packed integer Obsidian stores", () => {
		// values cross-checked against a real graph.json
		expect(hexToRgbInt("#3b82f6")).toBe(3900150);
		expect(hexToRgbInt("#f59e0b")).toBe(16096779);
		expect(hexToRgbInt("#02cc16")).toBe(183318);
	});

	it("handles black, white, and a leading-zero red channel", () => {
		expect(hexToRgbInt("#000000")).toBe(0);
		expect(hexToRgbInt("#ffffff")).toBe(0xffffff);
		expect(hexToRgbInt("#02cc16")).toBe(0x02cc16);
	});

	it("expands 3-digit shorthand", () => {
		expect(hexToRgbInt("#abc")).toBe(0xaabbcc);
		expect(hexToRgbInt("#fff")).toBe(0xffffff);
	});

	it("tolerates a missing hash, surrounding whitespace, and mixed case", () => {
		expect(hexToRgbInt("3B82F6")).toBe(3900150);
		expect(hexToRgbInt("  #3b82f6  ")).toBe(3900150);
	});

	it("returns null for non-hex / named / malformed colors", () => {
		expect(hexToRgbInt("")).toBeNull();
		expect(hexToRgbInt("red")).toBeNull();
		expect(hexToRgbInt("#12")).toBeNull();
		expect(hexToRgbInt("#1234")).toBeNull();
		expect(hexToRgbInt("#gggggg")).toBeNull();
		expect(hexToRgbInt("rgb(1,2,3)")).toBeNull();
	});
});

describe("typeColorQuery", () => {
	it("uses the bare bracket form for plain names", () => {
		expect(typeColorQuery("person")).toBe("[type:person]");
		expect(typeColorQuery("daily-note")).toBe("[type:daily-note]");
		expect(typeColorQuery("Type_2")).toBe("[type:Type_2]");
	});

	it("quotes names with spaces or other non-word characters", () => {
		expect(typeColorQuery("Daily Note")).toBe('["type":"Daily Note"]');
		expect(typeColorQuery("book/review")).toBe('["type":"book/review"]');
	});
});

describe("buildColorGroups", () => {
	it("creates one group per type with a valid color", () => {
		const groups = buildColorGroups([type("person", "#3b82f6"), type("place", "#f59e0b")], []);
		expect(groups).toEqual([
			{ query: "[type:person]", color: { a: 1, rgb: 3900150 } },
			{ query: "[type:place]", color: { a: 1, rgb: 16096779 } },
		]);
	});

	it("skips types with no color or an unrecognized (non-hex, no DOM) color", () => {
		const groups = buildColorGroups(
			[type("person", "#3b82f6"), type("abstract"), type("named", "rebeccapurple")],
			[]
		);
		expect(groups).toEqual([{ query: "[type:person]", color: { a: 1, rgb: 3900150 } }]);
	});

	it("preserves manual (non-schema) color groups untouched", () => {
		const manual: GraphColorGroup[] = [
			{ query: "tag:#favorite", color: { a: 1, rgb: 111 } },
			{ query: "[subtype:event]", color: { a: 1, rgb: 222 } },
		];
		const groups = buildColorGroups([type("person", "#3b82f6")], manual);
		expect(groups).toEqual([
			...manual,
			{ query: "[type:person]", color: { a: 1, rgb: 3900150 } },
		]);
	});

	it("updates an existing schema group in place rather than duplicating it", () => {
		const existing: GraphColorGroup[] = [
			{ query: "[type:person]", color: { a: 1, rgb: 0 } },
		];
		const groups = buildColorGroups([type("person", "#3b82f6")], existing);
		expect(groups).toEqual([{ query: "[type:person]", color: { a: 1, rgb: 3900150 } }]);
	});

	it("removes a managed group when its type's color is cleared", () => {
		const existing: GraphColorGroup[] = [
			{ query: "[type:person]", color: { a: 1, rgb: 3900150 } },
			{ query: "tag:#keep", color: { a: 1, rgb: 999 } },
		];
		const groups = buildColorGroups([type("person")], existing);
		expect(groups).toEqual([{ query: "tag:#keep", color: { a: 1, rgb: 999 } }]);
	});

	it("is idempotent - re-running on its own output is a no-op", () => {
		const schemas = [type("person", "#3b82f6"), type("place", "#f59e0b")];
		const manual: GraphColorGroup[] = [{ query: "path:Inbox", color: { a: 1, rgb: 42 } }];
		const once = buildColorGroups(schemas, manual);
		const twice = buildColorGroups(schemas, once);
		expect(twice).toEqual(once);
	});
});
