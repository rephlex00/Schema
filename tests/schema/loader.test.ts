import { describe, expect, it } from "vitest";
import { SchemaLoader } from "../../src/schema/loader";
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

describe("SchemaLoader", () => {
	it("starts empty", () => {
		const loader = new SchemaLoader();
		expect(loader.getAll()).toHaveLength(0);
	});

	it("loads provided schemas via start()", () => {
		const loader = new SchemaLoader();
		loader.start([s({ name: "a" }), s({ name: "b" })]);
		expect(loader.getAll().map((x) => x.name).sort()).toEqual(["a", "b"]);
	});

	it("get() returns by name", () => {
		const loader = new SchemaLoader();
		loader.start([s({ name: "person", folder: "Facts/People" })]);
		expect(loader.get("person")?.folder).toBe("Facts/People");
		expect(loader.get("ghost")).toBeUndefined();
	});

	it("setAll replaces the registry", () => {
		const loader = new SchemaLoader();
		loader.start([s({ name: "a" })]);
		loader.setAll([s({ name: "b" }), s({ name: "c" })]);
		expect(loader.getAll().map((x) => x.name).sort()).toEqual(["b", "c"]);
	});

	it("add() inserts and emits schema-changed", () => {
		const loader = new SchemaLoader();
		loader.start([]);
		let fired = false;
		loader.on("schema-changed", () => (fired = true));
		loader.add(s({ name: "new" }));
		expect(loader.get("new")).toBeDefined();
		expect(fired).toBe(true);
	});

	it("remove() deletes and emits schema-changed", () => {
		const loader = new SchemaLoader();
		loader.start([s({ name: "a" })]);
		let fired = false;
		loader.on("schema-changed", () => (fired = true));
		const removed = loader.remove("a");
		expect(removed).toBe(true);
		expect(loader.get("a")).toBeUndefined();
		expect(fired).toBe(true);
	});

	it("update() applies a partial change", () => {
		const loader = new SchemaLoader();
		loader.start([s({ name: "a", folder: "old" })]);
		loader.update("a", { folder: "new" });
		expect(loader.get("a")?.folder).toBe("new");
	});

	it("update() preserves the name (immutable)", () => {
		const loader = new SchemaLoader();
		loader.start([s({ name: "a" })]);
		loader.update("a", { name: "b" } as Partial<TypeSchema>);
		expect(loader.get("a")?.name).toBe("a");
		expect(loader.get("b")).toBeUndefined();
	});

	it("ensureShape fills in missing arrays/objects", () => {
		const loader = new SchemaLoader();
		// Pass in a schema with missing arrays — loader should normalize.
		loader.start([{ name: "a" } as unknown as TypeSchema]);
		const got = loader.get("a");
		expect(got?.tags).toEqual([]);
		expect(got?.fields).toEqual([]);
		expect(got?.lookups).toEqual([]);
		expect(got?.defaults).toEqual({});
	});

	it("validates after every commit", () => {
		const loader = new SchemaLoader();
		loader.start([s({ name: "a", extends: "ghost" })]);
		const errs = loader.getValidationErrors();
		expect(errs.some((e) => e.message.includes("ghost"))).toBe(true);
	});
});
