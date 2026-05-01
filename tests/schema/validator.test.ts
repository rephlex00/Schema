import { describe, expect, it } from "vitest";
import type { TypeSchema } from "../../src/schema/types";
import { validateAll, validateOne } from "../../src/schema/validator";

function makeSchema(overrides: Partial<TypeSchema>): TypeSchema {
	return {
		name: "x",
		tags: [],
		fields: [],
		lookups: [],
		defaults: {},
		...overrides,
	};
}

describe("validateOne", () => {
	it("flags duplicate field names", () => {
		const s = makeSchema({
			fields: [
				{ name: "a", type: "Input" },
				{ name: "a", type: "Input" },
			],
		});
		const errs = validateOne(s);
		expect(errs.some((e) => e.message.includes("duplicate field name"))).toBe(true);
	});

	it("flags empty field names", () => {
		const s = makeSchema({
			fields: [{ name: "", type: "Input" }],
		});
		const errs = validateOne(s);
		expect(errs.some((e) => e.message.includes("empty name"))).toBe(true);
	});

	it("flags lookups that collide with field names", () => {
		const s = makeSchema({
			fields: [{ name: "shared", type: "Input" }],
			lookups: [{ name: "shared", query: "x", render: "block", output: "list" }],
		});
		const errs = validateOne(s);
		expect(errs.some((e) => e.message.includes("collides"))).toBe(true);
	});

	it("flags duplicate lookup names", () => {
		const s = makeSchema({
			lookups: [
				{ name: "lk", query: "x", render: "block", output: "list" },
				{ name: "lk", query: "y", render: "block", output: "list" },
			],
		});
		const errs = validateOne(s);
		expect(errs.length).toBeGreaterThan(0);
	});
});

describe("validateAll", () => {
	it("flags missing extends target", () => {
		const map = new Map<string, TypeSchema>();
		map.set("person", makeSchema({ name: "person", extends: "ghost" }));
		const result = validateAll(map);
		expect(result.ok).toBe(false);
		expect(result.errors.some((e) => e.message.includes("ghost"))).toBe(true);
	});

	it("warns when a field target points at an unknown type", () => {
		const map = new Map<string, TypeSchema>();
		map.set(
			"person",
			makeSchema({
				name: "person",
				fields: [{ name: "org", type: "MultiFile", target: "ghost" }],
			})
		);
		const result = validateAll(map);
		expect(result.errors.some((e) => e.level === "warning" && e.message.includes("ghost"))).toBe(true);
	});

	it("flags duplicate tag declarations across types", () => {
		const map = new Map<string, TypeSchema>();
		map.set("a", makeSchema({ name: "a", tags: ["type/shared"] }));
		map.set("b", makeSchema({ name: "b", tags: ["type/shared"] }));
		const result = validateAll(map);
		expect(result.errors.some((e) => e.message.includes("type/shared"))).toBe(true);
	});

	it("returns ok=true when all checks pass", () => {
		const map = new Map<string, TypeSchema>();
		map.set("a", makeSchema({ name: "a", tags: ["type/a"] }));
		map.set("b", makeSchema({ name: "b", extends: "a", tags: ["type/b"] }));
		const result = validateAll(map);
		expect(result.ok).toBe(true);
	});
});
