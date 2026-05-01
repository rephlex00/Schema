import { describe, expect, it } from "vitest";
import type { TypeSchema } from "../../src/schema/types";
import { buildFrontmatter, renderFrontmatter } from "../../src/util/frontmatter";

function schema(overrides: Partial<TypeSchema>): TypeSchema {
	return {
		name: "person",
		sourcePath: "x.md",
		fields: [],
		lookups: [],
		raw: {},
		...overrides,
	};
}

describe("buildFrontmatter", () => {
	it("starts with type and includes schema fields with sensible defaults", () => {
		const fm = buildFrontmatter(
			schema({
				fields: [
					{ name: "firstname", type: "Input", id: "id1" },
					{ name: "tags", type: "Multi", id: "id2" },
					{ name: "active", type: "Boolean", id: "id3" },
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

	it("overlays prompted values onto defaults", () => {
		const fm = buildFrontmatter(
			schema({
				fields: [
					{ name: "firstname", type: "Input", id: "id1" },
					{ name: "lastname", type: "Input", id: "id2" },
				],
			}),
			{ firstname: "Phoebe", lastname: "Durkee" }
		);
		expect(fm.firstname).toBe("Phoebe");
		expect(fm.lastname).toBe("Durkee");
	});

	it("respects fieldsOrder", () => {
		const fm = buildFrontmatter(
			schema({
				fields: [
					{ name: "a", type: "Input", id: "id1" },
					{ name: "b", type: "Input", id: "id2" },
					{ name: "c", type: "Input", id: "id3" },
				],
				fieldsOrder: ["id3", "id1", "id2"],
			}),
			{}
		);
		const keys = Object.keys(fm);
		expect(keys.indexOf("c")).toBeLessThan(keys.indexOf("a"));
		expect(keys.indexOf("a")).toBeLessThan(keys.indexOf("b"));
	});

	it("skips block-mode lookup fields", () => {
		const fm = buildFrontmatter(
			schema({
				fields: [{ name: "events", type: "Lookup", id: "id1" }],
				lookups: [{ name: "events", query: "x", render: "block" }],
			}),
			{}
		);
		expect("events" in fm).toBe(false);
	});

	it("includes frontmatter-mode lookup fields with empty array default", () => {
		const fm = buildFrontmatter(
			schema({
				fields: [{ name: "events", type: "Lookup", id: "id1" }],
				lookups: [{ name: "events", query: "x", render: "frontmatter" }],
			}),
			{}
		);
		expect(fm.events).toEqual([]);
	});

	it("injects icon and color from schema when not in fields", () => {
		const fm = buildFrontmatter(
			schema({ icon: "user", color: "#4A90E2" }),
			{}
		);
		expect(fm.icon).toBe("user");
		expect(fm.color).toBe("#4A90E2");
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
