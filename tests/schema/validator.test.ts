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
		expect(errs.some((e) => e.message.includes("duplicate property name"))).toBe(true);
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

	it("reports an extends cycle exactly once, not once per member", () => {
		const map = new Map<string, TypeSchema>();
		map.set("a", makeSchema({ name: "a", extends: "b" }));
		map.set("b", makeSchema({ name: "b", extends: "a" }));
		const result = validateAll(map);
		const cycleErrors = result.errors.filter((e) => e.message.includes("extends chain cycles"));
		expect(cycleErrors).toHaveLength(1);
		// Canonicalized smallest-name-first and closed back to the start.
		expect(cycleErrors[0].message).toContain("a → b → a");
	});

	it("returns ok=true when all checks pass", () => {
		const map = new Map<string, TypeSchema>();
		map.set("a", makeSchema({ name: "a", tags: ["type/a"] }));
		map.set("b", makeSchema({ name: "b", extends: "a", tags: ["type/b"] }));
		const result = validateAll(map);
		expect(result.ok).toBe(true);
	});

	it("does NOT flag two types sharing the same global field with the same inverse name", () => {
		const map = new Map<string, TypeSchema>();
		map.set("organization", makeSchema({ name: "organization" }));
		map.set(
			"person",
			makeSchema({
				name: "person",
				fields: [
					{ name: "jam", type: "File", target: "organization", inverse: "jam" },
				],
			})
		);
		map.set(
			"event",
			makeSchema({
				name: "event",
				fields: [
					{ name: "jam", type: "File", target: "organization", inverse: "jam" },
				],
			})
		);
		const globalFields = {
			jam: { name: "jam", type: "File" as const, target: "organization", inverse: "jam" },
		};
		const result = validateAll(map, globalFields);
		expect(
			result.errors.some((e) => e.message.includes("claim inverse"))
		).toBe(false);
	});

	it("DOES flag distinct field names claiming the same inverse on the same target", () => {
		const map = new Map<string, TypeSchema>();
		map.set("organization", makeSchema({ name: "organization" }));
		map.set(
			"person",
			makeSchema({
				name: "person",
				fields: [
					{ name: "jam", type: "File", target: "organization", inverse: "shared" },
				],
			})
		);
		map.set(
			"event",
			makeSchema({
				name: "event",
				fields: [
					{
						name: "peanut_butter",
						type: "File",
						target: "organization",
						inverse: "shared",
					},
				],
			})
		);
		const globalFields = {
			jam: { name: "jam", type: "File" as const, target: "organization", inverse: "shared" },
			peanut_butter: {
				name: "peanut_butter",
				type: "File" as const,
				target: "organization",
				inverse: "shared",
			},
		};
		const result = validateAll(map, globalFields);
		expect(
			result.errors.some(
				(e) =>
					e.level === "error" &&
					e.message.includes("distinct properties claim inverse") &&
					e.message.includes("shared")
			)
		).toBe(true);
	});
});

describe("excludeFields validation", () => {
	it("warns when excluding a name no ancestor declares", () => {
		const map = new Map<string, TypeSchema>();
		map.set("moment", makeSchema({ name: "moment", fields: [{ name: "title", type: "Input" }] }));
		map.set(
			"periodic",
			makeSchema({ name: "periodic", extends: "moment", excludeFields: ["dailynot"] })
		);
		const r = validateAll(map, { title: { name: "title", type: "Input" } });
		expect(
			r.errors.some(
				(e) => e.level === "warning" && e.message.includes('"dailynot"') && e.message.includes("no ancestor")
			)
		).toBe(true);
	});

	it("warns when a type both declares and excludes the same name", () => {
		const map = new Map<string, TypeSchema>();
		map.set(
			"weekly",
			makeSchema({
				name: "weekly",
				fields: [{ name: "dailynote", type: "File" }],
				excludeFields: ["dailynote"],
			})
		);
		const r = validateAll(map, { dailynote: { name: "dailynote", type: "File" } });
		expect(
			r.errors.some(
				(e) => e.level === "warning" && e.message.includes("the declaration wins")
			)
		).toBe(true);
	});

	it("a correct exclusion produces no warnings", () => {
		const map = new Map<string, TypeSchema>();
		map.set(
			"moment",
			makeSchema({ name: "moment", fields: [{ name: "dailynote", type: "File" }] })
		);
		map.set(
			"periodic",
			makeSchema({ name: "periodic", extends: "moment", excludeFields: ["dailynote"] })
		);
		const r = validateAll(map, { dailynote: { name: "dailynote", type: "File" } });
		expect(r.errors).toHaveLength(0);
	});
});
