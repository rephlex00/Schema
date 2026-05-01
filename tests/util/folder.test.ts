import { describe, expect, it } from "vitest";
import { stripTemplateSegments } from "../../src/util/folder";

describe("stripTemplateSegments", () => {
	it("returns plain folders unchanged", () => {
		expect(stripTemplateSegments("Facts/People")).toBe("Facts/People");
	});

	it("strips trailing template segments", () => {
		expect(stripTemplateSegments("Moments/{{__year}}")).toBe("Moments");
	});

	it("strips multi-level template segments", () => {
		expect(stripTemplateSegments("Moments/{{__year}}/{{__month}}")).toBe("Moments");
	});

	it("returns empty when the first segment is templated", () => {
		expect(stripTemplateSegments("{{__year}}/Moments")).toBe("");
	});

	it("trims trailing slashes", () => {
		expect(stripTemplateSegments("Facts/People/")).toBe("Facts/People");
	});

	it("handles empty / undefined", () => {
		expect(stripTemplateSegments("")).toBe("");
		expect(stripTemplateSegments(undefined)).toBe("");
	});
});
