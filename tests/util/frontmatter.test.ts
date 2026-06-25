import { describe, expect, it } from "vitest";
import type { FieldSchema, TypeSchema } from "../../src/schema/types";
import { buildFrontmatter, defaultForField, renderFrontmatter } from "../../src/util/frontmatter";

function field(overrides: Partial<FieldSchema> & Pick<FieldSchema, "type">): FieldSchema {
	return { name: "f", ...overrides };
}

function schema(overrides: Partial<TypeSchema>): TypeSchema {
	return {
		name: "person",
		tags: [],
		fields: [],
		lookups: [],
		defaults: {},
		...overrides,
	};
}

describe("defaultForField", () => {
	it("returns [] for array-like types (Multi, MultiFile, MultiMedia, YAML, Lookup)", () => {
		for (const type of ["Multi", "MultiFile", "MultiMedia", "YAML", "Lookup"] as const) {
			expect(defaultForField(field({ type }))).toEqual([]);
		}
	});

	it("returns false for Boolean, null for Number, '' for plain text", () => {
		expect(defaultForField(field({ type: "Boolean" }))).toBe(false);
		expect(defaultForField(field({ type: "Number" }))).toBeNull();
		expect(defaultForField(field({ type: "Input" }))).toBe("");
	});

	it("returns '' for a date field without defaultNow", () => {
		expect(defaultForField(field({ type: "Date" }))).toBe("");
	});

	it("returns a formatted timestamp for a date field with defaultNow", () => {
		const v = defaultForField(field({ type: "Date", options: { defaultNow: true } }));
		expect(typeof v).toBe("string");
		expect(v).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});
});

describe("buildFrontmatter", () => {
	it("starts with type and includes schema fields with sensible defaults", () => {
		const fm = buildFrontmatter(
			schema({
				fields: [
					{ name: "firstname", type: "Input" },
					{ name: "tags", type: "Multi" },
					{ name: "active", type: "Boolean" },
				],
			}),
			{}
		);
		expect(fm.type).toBe("person");
		expect(fm.firstname).toBe("");
		expect(fm.tags).toEqual([]);
		expect(fm.active).toBe(false);
		expect(fm.aliases).toEqual([]);
	});

	it("applies per-type defaults, with prompted values winning over them", () => {
		const fm = buildFrontmatter(
			schema({
				fields: [
					{ name: "status", type: "Input" },
					{ name: "stage", type: "Input" },
				],
				defaults: { status: "active", stage: "draft" },
			}),
			{ stage: "published" }
		);
		// per-type default applied when not prompted
		expect(fm.status).toBe("active");
		// prompted value beats the per-type default
		expect(fm.stage).toBe("published");
	});

	it("includes universal properties with their per-type default", () => {
		const universal = [
			{ name: "icon", type: "Icon" as const, universal: true },
			{ name: "color", type: "Color" as const, universal: true },
		];
		const fm = buildFrontmatter(
			schema({ fields: [{ name: "firstname", type: "Input" }], defaults: { icon: "user" } }),
			{},
			"type",
			universal
		);
		expect(fm.firstname).toBe("");
		expect(fm.icon).toBe("user"); // universal + per-type default
		expect(fm.color).toBe(""); // universal, no default → placeholder
	});

	it("overlays prompted values onto defaults", () => {
		const fm = buildFrontmatter(
			schema({
				fields: [
					{ name: "firstname", type: "Input" },
					{ name: "lastname", type: "Input" },
				],
			}),
			{ firstname: "Ada", lastname: "Lovelace" }
		);
		expect(fm.firstname).toBe("Ada");
		expect(fm.lastname).toBe("Lovelace");
	});

	it("respects field declaration order", () => {
		const fm = buildFrontmatter(
			schema({
				fields: [
					{ name: "c", type: "Input" },
					{ name: "a", type: "Input" },
					{ name: "b", type: "Input" },
				],
			}),
			{}
		);
		const keys = Object.keys(fm);
		expect(keys.indexOf("c")).toBeLessThan(keys.indexOf("a"));
		expect(keys.indexOf("a")).toBeLessThan(keys.indexOf("b"));
	});

	it("includes frontmatter-mode lookups with empty array default", () => {
		const fm = buildFrontmatter(
			schema({
				lookups: [{ name: "events", query: "x", render: "frontmatter", output: "list" }],
			}),
			{}
		);
		expect(fm.events).toEqual([]);
	});

	it("excludes block-mode lookups from frontmatter", () => {
		const fm = buildFrontmatter(
			schema({
				lookups: [{ name: "events", query: "x", render: "block", output: "list" }],
			}),
			{}
		);
		expect("events" in fm).toBe(false);
	});

	it("applies defaults map (icon, color) when not already in fm", () => {
		const fm = buildFrontmatter(
			schema({ defaults: { icon: "user", color: "#4A90E2" } }),
			{}
		);
		expect(fm.icon).toBe("user");
		expect(fm.color).toBe("#4A90E2");
	});

	it("fills DateTime/Date/Time fields with current time when options.defaultNow is set", () => {
		const fm = buildFrontmatter(
			schema({
				fields: [
					{ name: "datetime", type: "DateTime", options: { defaultNow: true } },
					{ name: "day", type: "Date", options: { defaultNow: true } },
					{ name: "clock", type: "Time", options: { defaultNow: true } },
					{ name: "datetime_plain", type: "DateTime" },
				],
			}),
			{}
		);
		expect(typeof fm.datetime).toBe("string");
		expect(fm.datetime).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
		expect(fm.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(fm.clock).toMatch(/^\d{2}:\d{2}$/);
		expect(fm.datetime_plain).toBe("");
	});

	it("prompted value still wins over defaultNow", () => {
		const fm = buildFrontmatter(
			schema({
				fields: [{ name: "datetime", type: "DateTime", options: { defaultNow: true } }],
			}),
			{ datetime: "2020-01-01 00:00" }
		);
		expect(fm.datetime).toBe("2020-01-01 00:00");
	});

	it("does not overwrite a prompted value with a defaults entry", () => {
		const fm = buildFrontmatter(
			schema({
				fields: [{ name: "icon", type: "Input" }],
				defaults: { icon: "from-defaults" },
			}),
			{ icon: "from-prompt" }
		);
		expect(fm.icon).toBe("from-prompt");
	});
});

describe("renderFrontmatter", () => {
	it("wraps in --- markers and ends with newline", () => {
		const out = renderFrontmatter({ type: "x", title: "hello" });
		expect(out.startsWith("---\n")).toBe(true);
		expect(out.endsWith("---\n")).toBe(true);
		expect(out).toContain("type: x");
		expect(out).toContain("title: hello");
	});
});

describe("dynamic (Liquid) defaults", () => {
	const NOW = new Date(2026, 5, 12, 15, 30); // 2026-06-12 local

	it("renders a {{date:...}} default with the provided __now", () => {
		const fm = buildFrontmatter(
			schema({
				fields: [{ name: "dailynote", type: "File" }],
				defaults: { dailynote: "[[{{date:YYYYMMDD}}]]" },
			}),
			{},
			"type",
			[],
			{ __now: NOW }
		);
		expect(fm.dailynote).toBe("[[20260612]]");
	});

	it("leaves static string defaults untouched", () => {
		const fm = buildFrontmatter(
			schema({
				fields: [{ name: "icon", type: "Icon" }],
				defaults: { icon: "calendar" },
			}),
			{},
			"type",
			[],
			{ __now: NOW }
		);
		expect(fm.icon).toBe("calendar");
	});

	it("a prompted value wins over a dynamic default", () => {
		const fm = buildFrontmatter(
			schema({
				fields: [{ name: "dailynote", type: "File" }],
				defaults: { dailynote: "[[{{date:YYYYMMDD}}]]" },
			}),
			{ dailynote: "[[19991231]]" },
			"type",
			[],
			{ __now: NOW }
		);
		expect(fm.dailynote).toBe("[[19991231]]");
	});

	it("renders dynamic defaults in the safety-net loop (no backing field)", () => {
		const fm = buildFrontmatter(
			schema({ defaults: { orphan: "{{date:YYYY}}" } }),
			{},
			"type",
			[],
			{ __now: NOW }
		);
		expect(fm.orphan).toBe("2026");
	});

	it("can interpolate prompted values from the render context", () => {
		const fm = buildFrontmatter(
			schema({
				fields: [{ name: "greeting", type: "Input" }],
				defaults: { greeting: "Hello {{firstname}}" },
			}),
			{ firstname: "Jane" },
			"type",
			[],
			{ firstname: "Jane", __now: NOW }
		);
		expect(fm.greeting).toBe("Hello {{firstname}}".replace("{{firstname}}", "Jane"));
	});
});
