import { describe, expect, it } from "vitest";
import { SchemaLoader } from "../../src/schema/loader";
import type { FieldSchema, TypeSchema } from "../../src/schema/types";

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

describe("SchemaLoader hydration of fields against globalFields", () => {
	it("hydrates every field by overlaying the matching global", () => {
		const loader = new SchemaLoader();
		const globalFields: Record<string, FieldSchema> = {
			email: { name: "email", type: "Input" },
		};
		loader.start(
			[s({ name: "person", fields: [{ name: "email", type: "Input" }] })],
			globalFields
		);
		const person = loader.get("person")!;
		expect(person.fields[0]).toMatchObject({ name: "email", type: "Input" });
	});

	it("overwrites stale per-type field options with the global's", () => {
		const loader = new SchemaLoader();
		const globalFields: Record<string, FieldSchema> = {
			email: { name: "email", type: "Input", options: { placeholder: "you@example.com" } },
		};
		// Per-type field has stale options (was correct when the global had none).
		loader.start(
			[
				s({
					name: "person",
					fields: [
						{ name: "email", type: "Input", options: { placeholder: "old" } },
					],
				}),
			],
			globalFields
		);
		const person = loader.get("person")!;
		expect(person.fields[0].options).toEqual({ placeholder: "you@example.com" });
	});

	it("preserves per-usage promptOnCreate over the global's", () => {
		const loader = new SchemaLoader();
		const globalFields: Record<string, FieldSchema> = {
			name: { name: "name", type: "Input", promptOnCreate: "Name" },
		};
		loader.start(
			[
				s({
					name: "person",
					fields: [{ name: "name", type: "Input", promptOnCreate: "Their name" }],
				}),
			],
			globalFields
		);
		expect(loader.get("person")!.fields[0].promptOnCreate).toBe("Their name");
	});

	it("falls back to the global's promptOnCreate when the per-type field doesn't set one", () => {
		const loader = new SchemaLoader();
		const globalFields: Record<string, FieldSchema> = {
			name: { name: "name", type: "Input", promptOnCreate: "Name" },
		};
		loader.start(
			[
				s({
					name: "person",
					fields: [{ name: "name", type: "Input" }],
				}),
			],
			globalFields
		);
		expect(loader.get("person")!.fields[0].promptOnCreate).toBe("Name");
	});

	it("leaves a field untouched when no matching global exists, and validator flags it", () => {
		const loader = new SchemaLoader();
		loader.start(
			[s({ name: "person", fields: [{ name: "ghost", type: "Input" }] })],
			{}
		);
		const person = loader.get("person")!;
		expect(person.fields[0]).toEqual({ name: "ghost", type: "Input" });
		const errs = loader.getValidationErrors();
		expect(
			errs.some(
				(e) => e.level === "error" && e.message.includes("no entry in globalFields")
			)
		).toBe(true);
	});

	it("re-hydrates every schema when setGlobalFields swaps the registry", () => {
		const loader = new SchemaLoader();
		loader.start(
			[s({ name: "person", fields: [{ name: "rating", type: "Input" }] })],
			{ rating: { name: "rating", type: "Input" } }
		);
		expect(loader.get("person")!.fields[0].type).toBe("Input");

		loader.setGlobalFields({ rating: { name: "rating", type: "Number" } });
		expect(loader.get("person")!.fields[0].type).toBe("Number");
	});

	it("hydrates target + inverse from the global", () => {
		const loader = new SchemaLoader();
		const globalFields: Record<string, FieldSchema> = {
			people: { name: "people", type: "MultiFile", target: "person", inverse: "moments" },
		};
		loader.start(
			[
				s({
					name: "moment",
					fields: [{ name: "people", type: "MultiFile" }],
				}),
			],
			globalFields
		);
		const moment = loader.get("moment")!;
		expect(moment.fields[0].target).toBe("person");
		expect(moment.fields[0].inverse).toBe("moments");
	});
});
