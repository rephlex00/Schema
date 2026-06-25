import { describe, expect, it } from "vitest";
import type { TFile } from "obsidian";
import { allowedKeys, cleanFrontmatter } from "../../src/lifecycle/clean";
import type { FieldSchema, TypeSchema } from "../../src/schema/types";
import { createMockApp } from "../__helpers__/mock-app";

// Universal global properties (icon/color) - included in every object type.
const UNIVERSAL: FieldSchema[] = [
	{ name: "icon", type: "Icon", universal: true },
	{ name: "color", type: "Color", universal: true },
];

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

describe("allowedKeys", () => {
	it("includes universal keys, field names, and auto-refreshed fields", () => {
		const keys = allowedKeys(
			schema({ fields: [{ name: "firstname", type: "Input" }] }),
			UNIVERSAL
		);
		expect(keys.has("type")).toBe(true);
		expect(keys.has("title")).toBe(true);
		expect(keys.has("summary")).toBe(true);
		expect(keys.has("aliases")).toBe(true);
		expect(keys.has("firstname")).toBe(true);
		expect(keys.has("icon")).toBe(true);
		expect(keys.has("color")).toBe(true);
	});

	it("includes frontmatter-mode lookups but excludes block-mode ones", () => {
		const keys = allowedKeys(
			schema({
				lookups: [
					{ name: "fm_links", query: "x", render: "frontmatter", output: "list" },
					{ name: "block_links", query: "x", render: "block", output: "list" },
				],
			}),
			UNIVERSAL
		);
		expect(keys.has("fm_links")).toBe(true);
		expect(keys.has("block_links")).toBe(false);
	});
});

describe("cleanFrontmatter", () => {
	it("strips keys not allowed by the schema", async () => {
		const h = createMockApp();
		const file = h.addFile("Facts/People/Alice.md", {
			type: "person",
			firstname: "Alice",
			stale_legacy_key: "drop me",
			another_orphan: 42,
		});
		const result = await cleanFrontmatter(
			h.app as never,
			file as unknown as TFile,
			schema({ fields: [{ name: "firstname", type: "Input" }] }),
			UNIVERSAL
		);
		expect(result.removed.sort()).toEqual(["another_orphan", "stale_legacy_key"]);
		expect("stale_legacy_key" in file.fm).toBe(false);
		expect("another_orphan" in file.fm).toBe(false);
		expect(file.fm.firstname).toBe("Alice");
	});

	it("adds missing fields with type-appropriate defaults", async () => {
		const h = createMockApp();
		const file = h.addFile("Facts/People/Bob.md", { type: "person" });
		const result = await cleanFrontmatter(
			h.app as never,
			file as unknown as TFile,
			schema({
				fields: [
					{ name: "firstname", type: "Input" },
					{ name: "age", type: "Number" },
					{ name: "active", type: "Boolean" },
					{ name: "friends", type: "MultiFile" },
				],
			}),
			UNIVERSAL
		);
		// icon/color are universal, with no default on this schema, so they're
		// added as empty placeholders alongside the declared fields.
		expect(result.added.sort()).toEqual([
			"active",
			"age",
			"color",
			"firstname",
			"friends",
			"icon",
		]);
		expect(file.fm.firstname).toBe("");
		expect(file.fm.age).toBe(null);
		expect(file.fm.active).toBe(false);
		expect(file.fm.friends).toEqual([]);
		expect(file.fm.icon).toBe("");
		expect(file.fm.color).toBe("");
	});

	it("preserves universal keys (title/summary/aliases) even when not declared", async () => {
		const h = createMockApp();
		const file = h.addFile("Facts/People/Carol.md", {
			type: "person",
			title: "Dr. Carol",
			summary: "a friend",
			aliases: ["C"],
		});
		await cleanFrontmatter(h.app as never, file as unknown as TFile, schema({}), UNIVERSAL);
		expect(file.fm.title).toBe("Dr. Carol");
		expect(file.fm.summary).toBe("a friend");
		expect(file.fm.aliases).toEqual(["C"]);
	});

	it("rewrites type to the schema name and refreshes auto-refreshed fields from defaults", async () => {
		const h = createMockApp();
		const file = h.addFile("Facts/People/Dave.md", {
			type: "OLD_TYPE",
			icon: "stale-icon",
			color: "#000000",
		});
		await cleanFrontmatter(
			h.app as never,
			file as unknown as TFile,
			schema({ defaults: { icon: "user", color: "#4A90E2" } }),
			UNIVERSAL
		);
		expect(file.fm.type).toBe("person");
		expect(file.fm.icon).toBe("user");
		expect(file.fm.color).toBe("#4A90E2");
	});

	it("re-applies a declared field's per-type default on retype (overwrites existing)", async () => {
		const h = createMockApp();
		const file = h.addFile("Facts/Tasks/T.md", { type: "OLD", stage: "done" });
		await cleanFrontmatter(
			h.app as never,
			file as unknown as TFile,
			schema({ fields: [{ name: "stage", type: "Input" }], defaults: { stage: "todo" } }),
			UNIVERSAL
		);
		// the new type defines a default for `stage`, so it's applied even though
		// the note already had a value.
		expect(file.fm.stage).toBe("todo");
	});

	it("leaves a declared field untouched on retype when the new type has no default for it", async () => {
		const h = createMockApp();
		const file = h.addFile("Facts/Tasks/T.md", { type: "OLD", stage: "done" });
		await cleanFrontmatter(
			h.app as never,
			file as unknown as TFile,
			schema({ fields: [{ name: "stage", type: "Input" }], defaults: {} }),
			UNIVERSAL
		);
		expect(file.fm.stage).toBe("done");
	});

	it("does not clobber an auto-refreshed field when the schema default is empty/undefined", async () => {
		const h = createMockApp();
		const file = h.addFile("Facts/People/Erin.md", {
			type: "person",
			icon: "keep-me",
			color: "#abcdef",
		});
		await cleanFrontmatter(
			h.app as never,
			file as unknown as TFile,
			schema({ defaults: { icon: "", /* color absent */ } }),
			UNIVERSAL
		);
		// icon default is "" → skipped; color default undefined → skipped.
		expect(file.fm.icon).toBe("keep-me");
		expect(file.fm.color).toBe("#abcdef");
	});

	it("keeps frontmatter-mode lookup values but strips block-mode lookup keys", async () => {
		const h = createMockApp();
		const file = h.addFile("Facts/People/Fred.md", {
			type: "person",
			fm_links: ["[[X]]"],
			block_links: ["should be dropped"],
		});
		const result = await cleanFrontmatter(
			h.app as never,
			file as unknown as TFile,
			schema({
				lookups: [
					{ name: "fm_links", query: "x", render: "frontmatter", output: "list" },
					{ name: "block_links", query: "x", render: "block", output: "list" },
				],
			}),
			UNIVERSAL
		);
		expect(file.fm.fm_links).toEqual(["[[X]]"]);
		expect("block_links" in file.fm).toBe(false);
		expect(result.removed).toContain("block_links");
	});
});

describe("cleanFrontmatter dynamic defaults and tags", () => {
	const daily = (over: Partial<TypeSchema> = {}) =>
		schema({
			name: "moment",
			fields: [
				{ name: "datetime", type: "DateTime" },
				{ name: "dailynote", type: "File" },
			],
			defaults: { dailynote: "[[{{date:YYYYMMDD}}]]", icon: "clock" },
			...over,
		});

	it("fills a missing dailynote from the note's datetime day", async () => {
		const h = createMockApp();
		const file = h.addFile("Moments/2025/x.md", { type: "moment", datetime: "2025-03-04 12:30" });
		await cleanFrontmatter(h.app as never, file as unknown as TFile, daily(), UNIVERSAL);
		expect(file.fm.dailynote).toBe("[[20250304]]");
	});

	it("falls back to file ctime when datetime is missing or invalid", async () => {
		const h = createMockApp();
		const file = h.addFile("Moments/x.md", { type: "moment", datetime: "not a date" });
		// MOCK_CTIME is 2026-01-15 local.
		await cleanFrontmatter(h.app as never, file as unknown as TFile, daily(), UNIVERSAL);
		expect(file.fm.dailynote).toBe("[[20260115]]");
	});

	it("never overwrites an existing non-empty dailynote", async () => {
		const h = createMockApp();
		const file = h.addFile("Moments/x.md", {
			type: "moment",
			datetime: "2025-03-04 12:30",
			dailynote: "[[20240101]]",
		});
		await cleanFrontmatter(h.app as never, file as unknown as TFile, daily(), UNIVERSAL);
		expect(file.fm.dailynote).toBe("[[20240101]]");
	});

	it("fills an empty-string dailynote", async () => {
		const h = createMockApp();
		const file = h.addFile("Moments/x.md", {
			type: "moment",
			datetime: "2025-03-04 12:30",
			dailynote: "",
		});
		await cleanFrontmatter(h.app as never, file as unknown as TFile, daily(), UNIVERSAL);
		expect(file.fm.dailynote).toBe("[[20250304]]");
	});

	it("static defaults still overwrite (icon on type change)", async () => {
		const h = createMockApp();
		const file = h.addFile("Moments/x.md", { type: "moment", icon: "old-icon" });
		await cleanFrontmatter(h.app as never, file as unknown as TFile, daily(), UNIVERSAL);
		expect(file.fm.icon).toBe("clock");
	});

	it("preserves a frontmatter tags key even when the type declares no tags field", async () => {
		const h = createMockApp();
		const file = h.addFile("Moments/20260612.md", { type: "daily", tags: ["daily"] });
		await cleanFrontmatter(
			h.app as never,
			file as unknown as TFile,
			schema({ name: "daily", fields: [{ name: "datetime", type: "DateTime" }] }),
			UNIVERSAL
		);
		expect(file.fm.tags).toEqual(["daily"]);
	});
});
