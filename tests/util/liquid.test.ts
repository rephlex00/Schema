import { describe, expect, it } from "vitest";
import { renderTemplate } from "../../src/util/liquid";

describe("renderTemplate", () => {
	it("substitutes simple variables", () => {
		expect(renderTemplate("{{name}}", { name: "Alice" })).toBe("Alice");
		expect(renderTemplate("{{a}} {{b}}", { a: "x", b: "y" })).toBe("x y");
	});

	it("renders missing variables as empty", () => {
		expect(renderTemplate("hello {{missing}}!", {})).toBe("hello !");
	});

	it("trims whitespace inside the tag", () => {
		expect(renderTemplate("{{  name  }}", { name: "Alice" })).toBe("Alice");
	});

	it("applies the lower filter", () => {
		expect(renderTemplate("{{name|lower}}", { name: "Alice" })).toBe("alice");
	});

	it("applies the slug filter", () => {
		expect(renderTemplate("{{title|slug}}", { title: "Hello, World!" })).toBe("hello-world");
	});

	it("applies the slice filter with start and end", () => {
		expect(renderTemplate("{{date|slice:0:4}}", { date: "2026-04-30" })).toBe("2026");
	});

	it("applies the year filter", () => {
		expect(renderTemplate("Moments/{{datetime|year}}", { datetime: "2026-04-30 12:00" })).toBe(
			"Moments/2026"
		);
	});

	it("renders array values comma-joined", () => {
		expect(renderTemplate("{{tags}}", { tags: ["a", "b", "c"] })).toBe("a, b, c");
	});

	it("supports first-name + last-name filename templates", () => {
		const out = renderTemplate("{{firstname}} {{lastname}}", {
			firstname: "Phoebe",
			lastname: "Durkee",
		});
		expect(out).toBe("Phoebe Durkee");
	});
});
