import { TFile } from "obsidian";
import { describe, expect, it } from "vitest";
import {
	compareTemplateToSchema,
	diffIsEmpty,
	diffTemplateVsSchema,
	extractTemplatePropertyList,
	fieldTypeFromObsidianType,
	obsidianTypeFromFieldType,
	writeTemplatePropertyList,
	type TemplatePropertyEntry,
} from "../../src/lifecycle/body-template";
import { resolveSchema } from "../../src/schema/resolve";
import type { FieldType, TypeSchema } from "../../src/schema/types";

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

describe("obsidianTypeFromFieldType", () => {
	it("maps known FieldTypes to Obsidian rough types", () => {
		expect(obsidianTypeFromFieldType("Number")).toBe("number");
		expect(obsidianTypeFromFieldType("Boolean")).toBe("checkbox");
		expect(obsidianTypeFromFieldType("Date")).toBe("date");
		expect(obsidianTypeFromFieldType("DateTime")).toBe("datetime");
		expect(obsidianTypeFromFieldType("Time")).toBe("datetime");
		expect(obsidianTypeFromFieldType("Multi")).toBe("list");
		expect(obsidianTypeFromFieldType("MultiFile")).toBe("list");
		expect(obsidianTypeFromFieldType("Input")).toBe("text");
		expect(obsidianTypeFromFieldType("Select")).toBe("text");
		expect(obsidianTypeFromFieldType("Formula")).toBe("text");
		expect(obsidianTypeFromFieldType("File")).toBe("text");
	});
});

describe("fieldTypeFromObsidianType", () => {
	it("maps Obsidian rough types back to canonical FieldTypes", () => {
		const cases: Array<["number" | "checkbox" | "date" | "datetime" | "list" | "text", FieldType]> = [
			["number", "Number"],
			["checkbox", "Boolean"],
			["date", "Date"],
			["datetime", "DateTime"],
			["list", "Multi"],
			["text", "Input"],
		];
		for (const [ot, expected] of cases) {
			expect(fieldTypeFromObsidianType(ot)).toBe(expected);
		}
	});
});

describe("compareTemplateToSchema", () => {
	const entry = (
		name: string,
		obsidianType: TemplatePropertyEntry["obsidianType"] = "text"
	): TemplatePropertyEntry => ({ name, obsidianType, default: "" });

	it("is in sync when names, order, and types all match", () => {
		const s = schema({
			fields: [
				{ name: "firstname", type: "Input" },
				{ name: "rating", type: "Number" },
			],
		});
		const c = compareTemplateToSchema([entry("firstname"), entry("rating", "number")], s);
		expect(c.inSync).toBe(true);
		expect(c.rows.map((r) => r.status)).toEqual(["match", "match"]);
		expect(c.counts).toEqual({ missing: 0, extra: 0, typeMismatch: 0 });
	});

	it("flags properties missing from the template (schema order first)", () => {
		const s = schema({
			fields: [
				{ name: "firstname", type: "Input" },
				{ name: "email", type: "Input" },
			],
		});
		const c = compareTemplateToSchema([entry("firstname")], s);
		expect(c.inSync).toBe(false);
		expect(c.counts.missing).toBe(1);
		const email = c.rows.find((r) => r.name === "email");
		expect(email?.status).toBe("missing-in-template");
		expect(email?.settingsType).toBe("Input");
		expect(email?.templateType).toBeUndefined();
	});

	it("flags properties only present in the template", () => {
		const s = schema({ fields: [{ name: "firstname", type: "Input" }] });
		const c = compareTemplateToSchema([entry("firstname"), entry("hometown")], s);
		expect(c.counts.extra).toBe(1);
		const hometown = c.rows.find((r) => r.name === "hometown");
		expect(hometown?.status).toBe("extra-in-template");
		expect(hometown?.settingsType).toBeUndefined();
		expect(hometown?.templateType).toBe("text");
	});

	it("flags a type mismatch on a shared property", () => {
		const s = schema({ fields: [{ name: "rating", type: "Number" }] });
		// template stores rating as text ("") rather than a number
		const c = compareTemplateToSchema([entry("rating", "text")], s);
		expect(c.inSync).toBe(false);
		expect(c.counts.typeMismatch).toBe(1);
		const rating = c.rows.find((r) => r.name === "rating");
		expect(rating?.status).toBe("type-mismatch");
		expect(rating?.settingsType).toBe("Number");
		expect(rating?.templateType).toBe("text");
	});

	it("detects order differences on otherwise-matching property sets", () => {
		const s = schema({
			fields: [
				{ name: "a", type: "Input" },
				{ name: "b", type: "Input" },
			],
		});
		const c = compareTemplateToSchema([entry("b"), entry("a")], s);
		expect(c.order).toBe("different");
		expect(c.inSync).toBe(false);
	});

	// Regression: a Date field with no default is seeded into the template as ""
	// (an empty scalar), which reads back as "text". Insisting on date===text
	// flagged a freshly-saved date property as out of sync forever.
	it("treats an empty (text) value as in sync with a Date field", () => {
		const s = schema({ fields: [{ name: "founded", type: "Date" }] });
		const c = compareTemplateToSchema([{ name: "founded", obsidianType: "text", default: "" }], s);
		expect(c.inSync).toBe(true);
		expect(c.counts.typeMismatch).toBe(0);
	});

	it("treats an empty value as in sync with a DateTime/Time field", () => {
		const s = schema({
			fields: [
				{ name: "startsAt", type: "DateTime" },
				{ name: "alarm", type: "Time" },
			],
		});
		const c = compareTemplateToSchema(
			[
				{ name: "startsAt", obsidianType: "text", default: "" },
				{ name: "alarm", obsidianType: "text", default: "" },
			],
			s
		);
		expect(c.inSync).toBe(true);
	});

	// YAML collapses dates and datetimes to a timestamp that loads back as a
	// Date ("date"), so a DateTime field can never match "datetime" by value.
	// Treat date and datetime as compatible.
	it("treats a date-valued template entry as in sync with a DateTime field", () => {
		const s = schema({ fields: [{ name: "startsAt", type: "DateTime" }] });
		const c = compareTemplateToSchema(
			[{ name: "startsAt", obsidianType: "date", default: new Date(0) }],
			s
		);
		expect(c.inSync).toBe(true);
	});

	// A genuinely wrong type is still flagged: a non-empty number stored where a
	// Date field is declared is not "blank", so the tolerance doesn't apply.
	it("still flags a non-empty value of the wrong type", () => {
		const s = schema({ fields: [{ name: "founded", type: "Date" }] });
		const c = compareTemplateToSchema([{ name: "founded", obsidianType: "number", default: 5 }], s);
		expect(c.inSync).toBe(false);
		expect(c.counts.typeMismatch).toBe(1);
	});
});

describe("diffTemplateVsSchema", () => {
	const entries = (names: string[]): TemplatePropertyEntry[] =>
		names.map((n) => ({ name: n, obsidianType: "text", default: "" }));

	it("returns empty diff when names and order match", () => {
		const s = schema({
			fields: [
				{ name: "firstname", type: "Input" },
				{ name: "birthday", type: "Date" },
			],
		});
		const diff = diffTemplateVsSchema(entries(["firstname", "birthday"]), s);
		expect(diffIsEmpty(diff)).toBe(true);
	});

	it("flags settingsAhead when schema has properties the template lacks", () => {
		const s = schema({
			fields: [
				{ name: "firstname", type: "Input" },
				{ name: "birthday", type: "Date" },
				{ name: "email", type: "Input" },
			],
		});
		const diff = diffTemplateVsSchema(entries(["firstname", "birthday"]), s);
		expect(diff.settingsAhead).toEqual(["email"]);
		expect(diff.templateAhead).toEqual([]);
		expect(diffIsEmpty(diff)).toBe(false);
	});

	it("flags templateAhead when template has properties the schema lacks", () => {
		const s = schema({
			fields: [{ name: "firstname", type: "Input" }],
		});
		const diff = diffTemplateVsSchema(entries(["firstname", "hometown"]), s);
		expect(diff.settingsAhead).toEqual([]);
		expect(diff.templateAhead).toEqual(["hometown"]);
		expect(diffIsEmpty(diff)).toBe(false);
	});

	it("flags order: different when shared names appear in a different order", () => {
		const s = schema({
			fields: [
				{ name: "a", type: "Input" },
				{ name: "b", type: "Input" },
			],
		});
		const diff = diffTemplateVsSchema(entries(["b", "a"]), s);
		expect(diff.order).toBe("different");
		expect(diffIsEmpty(diff)).toBe(false);
	});

	// Regression: child types reported permanent out-of-sync when a template
	// legitimately contained inherited fields. Fix is to diff against the
	// resolved schema (own + inherited) in the UI. The diff function itself
	// is unchanged; this test pins the integration with resolveSchema.
	it("is in sync when the template carries inherited fields and we diff against the resolved schema", () => {
		const parent = schema({
			name: "fact",
			fields: [{ name: "role", type: "Input" }],
		});
		const child = schema({
			name: "person",
			extends: "fact",
			fields: [
				{ name: "firstname", type: "Input" },
				{ name: "lastname", type: "Input" },
			],
		});
		const schemas = new Map<string, TypeSchema>([
			["fact", parent],
			["person", child],
		]);
		const resolved = resolveSchema(schemas, "person");
		expect(resolved).toBeDefined();

		const diff = diffTemplateVsSchema(
			entries(["role", "firstname", "lastname"]),
			resolved!
		);
		expect(diffIsEmpty(diff)).toBe(true);
	});
});

// End-to-end: what "Save to template" actually does. Writing a type's property
// list into a template and reading it back must report in sync, or the settings
// pill stays stuck on "Out of sync" no matter how many times the user saves.
describe("Save -> read-back round-trip reports in sync", () => {
	function makePlugin(initialContent: string, globalFields = {}) {
		const file = Object.assign(new TFile(), {
			path: "Templates/foo.md",
			basename: "foo",
			extension: "md",
		});
		let content = initialContent;
		const plugin = {
			app: {
				vault: {
					getAbstractFileByPath: (p: string) => (p === file.path ? file : null),
					read: async () => content,
					modify: async (_f: unknown, c: string) => {
						content = c;
					},
				},
			},
			settings: { typeKey: "type", globalFields },
		};
		return { plugin, getContent: () => content };
	}

	it("a Date field and a declared `summary` field are in sync after Save", async () => {
		const s = schema({
			name: "organization",
			fields: [
				{ name: "summary", type: "Input" }, // collides with an ambient key name
				{ name: "founded", type: "Date" }, // seeds as "" -> reads back as text
				{ name: "headcount", type: "Number" },
			],
		});
		const { plugin } = makePlugin("---\ntype: organization\n---\nTemplater body\n");

		await writeTemplatePropertyList(plugin as never, "Templates/foo.md", s);
		const entries = await extractTemplatePropertyList(plugin as never, "Templates/foo.md", s);
		const comparison = compareTemplateToSchema(entries!, s);

		expect(comparison.inSync).toBe(true);
	});

	it("preserves the template body and a user-added ambient key after Save", async () => {
		const s = schema({ name: "organization", fields: [{ name: "founded", type: "Date" }] });
		const { plugin, getContent } = makePlugin(
			"---\ntype: organization\naliases: []\n---\nTemplater body\n"
		);

		await writeTemplatePropertyList(plugin as never, "Templates/foo.md", s);

		// Body untouched; the ambient `aliases` the user kept is preserved and
		// doesn't show as out of sync (it isn't a declared field).
		expect(getContent()).toContain("Templater body");
		const entries = await extractTemplatePropertyList(plugin as never, "Templates/foo.md", s);
		expect(compareTemplateToSchema(entries!, s).inSync).toBe(true);
	});
});
