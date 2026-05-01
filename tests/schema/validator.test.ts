import { describe, expect, it } from "vitest";
import type { TypeSchema } from "../../src/schema/types";
import { validateAll, validateOne } from "../../src/schema/validator";

function makeSchema(overrides: Partial<TypeSchema>): TypeSchema {
	return {
		name: "x",
		sourcePath: "x.md",
		fields: [],
		lookups: [],
		raw: {},
		...overrides,
	};
}

describe("validateOne", () => {
	it("flags duplicate field IDs", () => {
		const s = makeSchema({
			fields: [
				{ name: "a", type: "Input", id: "abc123" },
				{ name: "b", type: "Input", id: "abc123" },
			],
		});
		const errs = validateOne(s);
		expect(errs.some((e) => e.level === "error" && e.message.includes("abc123"))).toBe(true);
	});

	it("flags duplicate field names", () => {
		const s = makeSchema({
			fields: [
				{ name: "a", type: "Input", id: "id1" },
				{ name: "a", type: "Input", id: "id2" },
			],
		});
		const errs = validateOne(s);
		expect(errs.some((e) => e.level === "error" && e.message.includes("duplicate field name"))).toBe(true);
	});

	it("warns when fieldsOrder lists unknown ids", () => {
		const s = makeSchema({
			fields: [{ name: "a", type: "Input", id: "id1" }],
			fieldsOrder: ["id1", "ghostId"],
		});
		const errs = validateOne(s);
		expect(errs.some((e) => e.level === "warning" && e.message.includes("ghostId"))).toBe(true);
	});

	it("warns when fields are missing from fieldsOrder", () => {
		const s = makeSchema({
			fields: [
				{ name: "a", type: "Input", id: "id1" },
				{ name: "b", type: "Input", id: "id2" },
			],
			fieldsOrder: ["id1"],
		});
		const errs = validateOne(s);
		expect(errs.some((e) => e.level === "warning" && e.message.includes("not listed"))).toBe(true);
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
				fields: [{ name: "org", type: "MultiFile", id: "id1", target: "ghost" }],
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
