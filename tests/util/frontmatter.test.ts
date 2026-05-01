import { describe, expect, it } from "vitest";
import type { TypeSchema } from "../../src/schema/types";
import { buildFrontmatter, renderFrontmatter } from "../../src/util/frontmatter";

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

	it("overlays prompted values onto defaults", () => {
		const fm = buildFrontmatter(
			schema({
				fields: [
					{ name: "firstname", type: "Input" },
					{ name: "lastname", type: "Input" },
				],
			}),
			{ firstname: "Phoebe", lastname: "Durkee" }
		);
		expect(fm.firstname).toBe("Phoebe");
		expect(fm.lastname).toBe("Durkee");
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
