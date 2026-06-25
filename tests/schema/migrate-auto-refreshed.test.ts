import { describe, expect, it } from "vitest";
import { foldAutoRefreshedIntoGlobals } from "../../src/schema/migrate-auto-refreshed";
import type { FieldSchema } from "../../src/schema/types";

describe("foldAutoRefreshedIntoGlobals", () => {
	it("promotes icon/color to universal Icon/Color globals", () => {
		const { globalFields, changed } = foldAutoRefreshedIntoGlobals(
			{},
			[
				{ name: "icon", kind: "icon" },
				{ name: "color", kind: "color" },
			]
		);
		expect(changed).toBe(true);
		expect(globalFields.icon).toEqual({ name: "icon", type: "Icon", universal: true });
		expect(globalFields.color).toEqual({ name: "color", type: "Color", universal: true });
	});

	it("treats other kinds as Input and infers Icon/Color by name", () => {
		const { globalFields } = foldAutoRefreshedIntoGlobals({}, [
			{ name: "banner", kind: "text" },
			{ name: "color" },
		]);
		expect(globalFields.banner.type).toBe("Input");
		expect(globalFields.banner.universal).toBe(true);
		expect(globalFields.color.type).toBe("Color");
	});

	it("only sets universal on an existing global, preserving its shape", () => {
		const existing: Record<string, FieldSchema> = {
			icon: { name: "icon", type: "Input", options: { x: 1 } },
		};
		const { globalFields, changed } = foldAutoRefreshedIntoGlobals(existing, [
			{ name: "icon", kind: "icon" },
		]);
		expect(changed).toBe(true);
		expect(globalFields.icon).toEqual({
			name: "icon",
			type: "Input",
			options: { x: 1 },
			universal: true,
		});
	});

	it("is a no-op for empty / missing legacy data", () => {
		expect(foldAutoRefreshedIntoGlobals({}, undefined).changed).toBe(false);
		expect(foldAutoRefreshedIntoGlobals({}, []).changed).toBe(false);
		const g = { icon: { name: "icon", type: "Icon" as const, universal: true } };
		expect(foldAutoRefreshedIntoGlobals(g, [{ name: "icon", kind: "icon" }]).changed).toBe(false);
	});
});
