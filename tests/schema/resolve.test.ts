import { describe, expect, it } from "vitest";
import {
	detectExtendsCycle,
	inheritedFieldNames,
	inheritedLookupNames,
	resolveAll,
	resolveSchema,
	synthesizedInverseLookups,
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

describe("inverse-relationship synthesis", () => {
	it("synthesizes a reverse lookup on the target type for a MultiFile field", () => {
		const map = mapOf(
			s({ name: "person", folder: "Facts/People" }),
			s({
				name: "event",
				folder: "Moments",
				fields: [
					{ name: "people", type: "MultiFile", target: "person", inverse: "events_attended" },
				],
			})
		);
		const person = resolveSchema(map, "person")!;
		const synth = person.lookups.find((l) => l.name === "events_attended");
		expect(synth).toBeDefined();
		expect(synth!.query).toContain('dv.pages(\'"Moments"\')');
		expect(synth!.query).toContain('s.type === "event"');
		expect(synth!.query).toContain("s.people && s.people.some");
		expect(synth!.render).toBe("frontmatter");
	});

	it("uses single-link predicate for File-typed fields", () => {
		const map = mapOf(
			s({ name: "place", folder: "Facts/Places" }),
			s({
				name: "event",
				folder: "Moments",
				fields: [{ name: "place", type: "File", target: "place", inverse: "events_here" }],
			})
		);
		const place = resolveSchema(map, "place")!;
		const synth = place.lookups.find((l) => l.name === "events_here")!;
		expect(synth.query).toContain("s.place && s.place.path === current.file.path");
		expect(synth.query).not.toContain(".some(");
	});

	it("strips template segments from source folder", () => {
		const map = mapOf(
			s({ name: "person" }),
			s({
				name: "event",
				folder: "Moments/{{__year}}",
				fields: [
					{ name: "people", type: "MultiFile", target: "person", inverse: "events_with_me" },
				],
			})
		);
		const person = resolveSchema(map, "person")!;
		const synth = person.lookups.find((l) => l.name === "events_with_me")!;
		expect(synth.query).toContain('dv.pages(\'"Moments"\')');
	});

	it("does not synthesize when target is unknown", () => {
		const map = mapOf(
			s({
				name: "event",
				folder: "Moments",
				fields: [
					{ name: "ghost_field", type: "MultiFile", target: "ghost", inverse: "ghost_inverse" },
				],
			})
		);
		// Resolve a real type — synthesis only fires when target matches.
		const event = resolveSchema(map, "event")!;
		expect(event.lookups.some((l) => l.name === "ghost_inverse")).toBe(false);
	});

	it("manual lookup with the same name wins over synthesis", () => {
		const map = mapOf(
			s({
				name: "person",
				lookups: [
					{
						name: "events_attended",
						query: "MANUAL_QUERY",
						render: "block",
						output: "count",
					},
				],
			}),
			s({
				name: "event",
				folder: "Moments",
				fields: [
					{ name: "people", type: "MultiFile", target: "person", inverse: "events_attended" },
				],
			})
		);
		const person = resolveSchema(map, "person")!;
		const matches = person.lookups.filter((l) => l.name === "events_attended");
		expect(matches).toHaveLength(1);
		expect(matches[0]!.query).toBe("MANUAL_QUERY");
	});

	it("when two sources claim the same inverse, only one wins (validator flags)", () => {
		const map = mapOf(
			s({ name: "person" }),
			s({
				name: "event",
				folder: "Moments",
				fields: [{ name: "people", type: "MultiFile", target: "person", inverse: "shared" }],
			}),
			s({
				name: "journal",
				folder: "Moments",
				fields: [{ name: "people", type: "MultiFile", target: "person", inverse: "shared" }],
			})
		);
		const person = resolveSchema(map, "person")!;
		const matches = person.lookups.filter((l) => l.name === "shared");
		expect(matches).toHaveLength(1);
	});
});

describe("synthesizedInverseLookups", () => {
	it("returns names with their source types", () => {
		const map = mapOf(
			s({ name: "person" }),
			s({
				name: "event",
				folder: "Moments",
				fields: [{ name: "people", type: "MultiFile", target: "person", inverse: "moments_with_me" }],
			})
		);
		const list = synthesizedInverseLookups(map, "person");
		expect(list).toEqual([{ name: "moments_with_me", sourceType: "event" }]);
	});

	it("returns empty for types without inverse declarations pointing at them", () => {
		const map = mapOf(s({ name: "person" }), s({ name: "event", folder: "Moments" }));
		expect(synthesizedInverseLookups(map, "person")).toEqual([]);
	});
});
