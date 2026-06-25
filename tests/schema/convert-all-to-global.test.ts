import { describe, expect, it } from "vitest";
import { convertAllToGlobal } from "../../src/schema/convert-all-to-global";
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

describe("convertAllToGlobal", () => {
	it("is a no-op on thin stubs that reference an existing global (no churn)", () => {
		// Persisted form after dehydration: fields are thin {name, type} stubs and
		// the global holds the canonical shape (incl. target/inverse).
		const globalFields = {
			org: { name: "org", type: "File" as const, target: "organization", inverse: "members" },
			email: { name: "email", type: "Input" as const },
		};
		const schemas = [
			s({ name: "person", fields: [{ name: "org", type: "File" }, { name: "email", type: "Input" }] }),
		];
		const result = convertAllToGlobal(schemas, globalFields);
		expect(result.changed).toBe(false);
		expect(result.conflicts).toEqual([]);
		expect(result.promoted).toBe(0);
		expect(result.linked).toBe(0);
	});

	it("promotes a singleton field (no sharing required)", () => {
		const result = convertAllToGlobal(
			[
				s({
					name: "person",
					fields: [
						{ name: "email", type: "Input", target: "x" /* extra prop */ },
					],
				}),
			],
			{}
		);
		expect(result.changed).toBe(true);
		expect(result.promoted).toBe(1);
		expect(result.linked).toBe(1);
		expect(result.globalFields.email).toEqual({
			name: "email",
			type: "Input",
			target: "x",
		});
		// Per-type field is normalized to {name, type}, no extra props.
		expect(result.schemas[0].fields[0]).toEqual({
			name: "email",
			type: "Input",
		});
	});

	it("is a no-op when every field already matches an existing global with no extras", () => {
		const existing = { email: { name: "email", type: "Input" as const } };
		const result = convertAllToGlobal(
			[s({ name: "person", fields: [{ name: "email", type: "Input" }] })],
			existing
		);
		// Field is already normalized; nothing to do.
		expect(result.changed).toBe(false);
		expect(result.promoted).toBe(0);
		expect(result.linked).toBe(0);
		expect(result.globalFields.email).toBe(existing.email);
	});

	it("flags a conflict when per-type shape differs from an existing global", () => {
		const existing = { rating: { name: "rating", type: "Number" as const } };
		const result = convertAllToGlobal(
			[s({ name: "book", fields: [{ name: "rating", type: "Input" }] })],
			existing
		);
		// The mismatched field stays untouched (validator will flag).
		expect(result.schemas[0].fields[0]).toEqual({ name: "rating", type: "Input" });
		expect(result.conflicts).toEqual([
			{ name: "rating", chosenShape: existing.rating, mismatchedTypes: ["book"] },
		]);
	});

	it("picks the most common shape when two types disagree", () => {
		const result = convertAllToGlobal(
			[
				s({ name: "a", fields: [{ name: "rating", type: "Number" }] }),
				s({ name: "b", fields: [{ name: "rating", type: "Number" }] }),
				s({ name: "c", fields: [{ name: "rating", type: "Input" }] }),
			],
			{}
		);
		expect(result.globalFields.rating.type).toBe("Number");
		// a, b are now normalized matches; c is left for validator.
		expect(result.schemas[0].fields[0]).toEqual({ name: "rating", type: "Number" });
		expect(result.schemas[1].fields[0]).toEqual({ name: "rating", type: "Number" });
		expect(result.schemas[2].fields[0]).toEqual({ name: "rating", type: "Input" });
		expect(result.conflicts[0].mismatchedTypes).toEqual(["c"]);
	});

	it("preserves promptOnCreate on the per-type field; strips it from the global", () => {
		const result = convertAllToGlobal(
			[
				s({
					name: "person",
					fields: [{ name: "name", type: "Input", promptOnCreate: "Their name" }],
				}),
			],
			{}
		);
		expect(result.globalFields.name).toEqual({ name: "name", type: "Input" });
		expect(result.schemas[0].fields[0]).toEqual({
			name: "name",
			type: "Input",
			promptOnCreate: "Their name",
		});
	});

	it("promotes target + inverse + options onto the global", () => {
		const result = convertAllToGlobal(
			[
				s({
					name: "moment",
					fields: [
						{
							name: "people",
							type: "MultiFile",
							target: "person",
							inverse: "moments",
							options: { foo: "bar" },
						},
					],
				}),
			],
			{}
		);
		expect(result.globalFields.people).toEqual({
			name: "people",
			type: "MultiFile",
			target: "person",
			inverse: "moments",
			options: { foo: "bar" },
		});
		// Per-type field gets normalized to just {name, type}.
		expect(result.schemas[0].fields[0]).toEqual({
			name: "people",
			type: "MultiFile",
		});
	});

	it("is idempotent across consecutive runs", () => {
		const first = convertAllToGlobal(
			[
				s({ name: "person", fields: [{ name: "email", type: "Input" }] }),
				s({ name: "company", fields: [{ name: "email", type: "Input" }] }),
			],
			{}
		);
		const second = convertAllToGlobal(first.schemas, first.globalFields);
		expect(second.changed).toBe(false);
		expect(second.schemas).toEqual(first.schemas);
		expect(second.globalFields).toEqual(first.globalFields);
	});
});
