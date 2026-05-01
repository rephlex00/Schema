import { describe, expect, it } from "vitest";
import {
	detectExtendsCycle,
	inheritedFieldNames,
	inheritedLookupNames,
	resolveAll,
	resolveSchema,
} from "../../src/schema/resolve";
import type { TypeSchema } from "../../src/schema/types";

function s(overrides: Partial<TypeSchema>): TypeSchema {
	return {
		name: "x",
		tags: [],
		fields: [],
		lookups: [],
		defaults: {},
		...overrides,
	};
}

function mapOf(...arr: TypeSchema[]): Map<string, TypeSchema> {
	const m = new Map<string, TypeSchema>();
	for (const x of arr) m.set(x.name, x);
	return m;
}

describe("resolveSchema", () => {
	it("returns the schema unchanged when there's no parent", () => {
		const map = mapOf(s({ name: "a", fields: [{ name: "x", type: "Input" }] }));
		const r = resolveSchema(map, "a")!;
		expect(r.fields).toHaveLength(1);
		expect(r.fields[0]!.name).toBe("x");
	});

	it("merges fields from parent into child", () => {
		const map = mapOf(
			s({ name: "fact", fields: [{ name: "title", type: "Input" }] }),
			s({
				name: "person",
				extends: "fact",
				fields: [{ name: "firstname", type: "Input" }],
			})
		);
		const r = resolveSchema(map, "person")!;
		expect(r.fields.map((f) => f.name)).toEqual(["title", "firstname"]);
	});

	it("child overrides parent on field name collision", () => {
		const map = mapOf(
			s({
				name: "fact",
				fields: [{ name: "title", type: "Input", promptOnCreate: "from parent" }],
			}),
			s({
				name: "person",
				extends: "fact",
				fields: [{ name: "title", type: "Input", promptOnCreate: "from child" }],
			})
		);
		const r = resolveSchema(map, "person")!;
		const t = r.fields.find((f) => f.name === "title")!;
		expect(t.promptOnCreate).toBe("from child");
	});

	it("merges lookups by name", () => {
		const map = mapOf(
			s({
				name: "moment",
				lookups: [{ name: "siblings", query: "x", render: "block", output: "list" }],
			}),
			s({
				name: "event",
				extends: "moment",
				lookups: [{ name: "guests", query: "y", render: "frontmatter", output: "list" }],
			})
		);
		const r = resolveSchema(map, "event")!;
		expect(r.lookups.map((l) => l.name).sort()).toEqual(["guests", "siblings"]);
	});

	it("merges defaults; child wins per key", () => {
		const map = mapOf(
			s({ name: "a", defaults: { icon: "parent-icon", color: "#111" } }),
			s({ name: "b", extends: "a", defaults: { color: "#222" } })
		);
		const r = resolveSchema(map, "b")!;
		expect(r.defaults).toEqual({ icon: "parent-icon", color: "#222" });
	});

	it("inherits folder + filename from parent when child omits", () => {
		const map = mapOf(
			s({ name: "moment", folder: "Moments", filename: "{{__timestamp}}" }),
			s({ name: "event", extends: "moment" })
		);
		const r = resolveSchema(map, "event")!;
		expect(r.folder).toBe("Moments");
		expect(r.filename).toBe("{{__timestamp}}");
	});

	it("child folder/filename override parent", () => {
		const map = mapOf(
			s({ name: "moment", folder: "Moments", filename: "{{__timestamp}}" }),
			s({ name: "event", extends: "moment", folder: "Events", filename: "{{title}}" })
		);
		const r = resolveSchema(map, "event")!;
		expect(r.folder).toBe("Events");
		expect(r.filename).toBe("{{title}}");
	});

	it("does NOT inherit tags — each type owns its own tag set", () => {
		const map = mapOf(
			s({ name: "fact", tags: ["type/fact"] }),
			s({ name: "person", extends: "fact", tags: ["type/person"] })
		);
		const r = resolveSchema(map, "person")!;
		expect(r.tags).toEqual(["type/person"]);
	});

	it("walks multi-level chains", () => {
		const map = mapOf(
			s({ name: "moment", fields: [{ name: "datetime", type: "DateTime" }] }),
			s({
				name: "periodic",
				extends: "moment",
				fields: [{ name: "period", type: "Input" }],
			}),
			s({
				name: "daily",
				extends: "periodic",
				fields: [{ name: "events", type: "MultiFile" }],
			})
		);
		const r = resolveSchema(map, "daily")!;
		expect(r.fields.map((f) => f.name)).toEqual(["datetime", "period", "events"]);
	});

	it("returns own schema when extends points at unknown type", () => {
		const map = mapOf(
			s({ name: "person", extends: "ghost", fields: [{ name: "x", type: "Input" }] })
		);
		const r = resolveSchema(map, "person")!;
		expect(r.fields).toHaveLength(1);
	});

	it("short-circuits cycles instead of looping forever", () => {
		const map = mapOf(
			s({ name: "a", extends: "b", fields: [{ name: "from-a", type: "Input" }] }),
			s({ name: "b", extends: "a", fields: [{ name: "from-b", type: "Input" }] })
		);
		const r = resolveSchema(map, "a");
		expect(r).toBeDefined();
		// Cycle short-circuits — exact merge result is implementation-defined,
		// but it must not hang.
	});
});

describe("detectExtendsCycle", () => {
	it("returns null when there is no cycle", () => {
		const map = mapOf(s({ name: "a" }), s({ name: "b", extends: "a" }));
		expect(detectExtendsCycle(map, "b")).toBeNull();
	});

	it("returns the path including the repeated node when there is a cycle", () => {
		const map = mapOf(
			s({ name: "a", extends: "b" }),
			s({ name: "b", extends: "a" })
		);
		const cycle = detectExtendsCycle(map, "a");
		expect(cycle).not.toBeNull();
		expect(cycle!.length).toBeGreaterThanOrEqual(3);
	});
});

describe("inheritedFieldNames / inheritedLookupNames", () => {
	it("returns names contributed by ancestors only", () => {
		const map = mapOf(
			s({ name: "fact", fields: [{ name: "title", type: "Input" }] }),
			s({
				name: "person",
				extends: "fact",
				fields: [{ name: "firstname", type: "Input" }],
			})
		);
		expect(inheritedFieldNames(map, "person")).toEqual(["title"]);
	});

	it("returns empty when child overrides every parent field", () => {
		const map = mapOf(
			s({ name: "fact", fields: [{ name: "title", type: "Input" }] }),
			s({
				name: "person",
				extends: "fact",
				fields: [{ name: "title", type: "Input" }],
			})
		);
		expect(inheritedFieldNames(map, "person")).toEqual([]);
	});

	it("works for lookups too", () => {
		const map = mapOf(
			s({
				name: "moment",
				lookups: [{ name: "shared", query: "q", render: "block", output: "list" }],
			}),
			s({ name: "event", extends: "moment" })
		);
		expect(inheritedLookupNames(map, "event")).toEqual(["shared"]);
	});
});

describe("resolveAll", () => {
	it("resolves every entry in the map", () => {
		const map = mapOf(
			s({ name: "fact", fields: [{ name: "title", type: "Input" }] }),
			s({ name: "person", extends: "fact" })
		);
		const all = resolveAll(map);
		expect(all).toHaveLength(2);
		const person = all.find((x) => x.name === "person")!;
		expect(person.fields.map((f) => f.name)).toEqual(["title"]);
	});
});
