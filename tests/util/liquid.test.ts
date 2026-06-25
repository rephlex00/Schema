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
			firstname: "Ada",
			lastname: "Lovelace",
		});
		expect(out).toBe("Ada Lovelace");
	});

	describe("moment-style date/time tokens", () => {
		const fixed = new Date(2026, 3, 28, 14, 7, 9); // 2026-04-28 14:07:09

		it("formats {{date:YYYYMMDD}} via __now context", () => {
			expect(renderTemplate("{{date:YYYYMMDD}}", { __now: fixed })).toBe("20260428");
		});

		it("formats {{date:YYYY-MM-DD}}", () => {
			expect(renderTemplate("{{date:YYYY-MM-DD}}", { __now: fixed })).toBe("2026-04-28");
		});

		it("formats {{time:HH:mm}}", () => {
			expect(renderTemplate("{{time:HH:mm}}", { __now: fixed })).toBe("14:07");
		});

		it("formats default {{date}} as YYYY-MM-DD", () => {
			expect(renderTemplate("{{date}}", { __now: fixed })).toBe("2026-04-28");
		});

		it("formats default {{time}} as HH:mm", () => {
			expect(renderTemplate("{{time}}", { __now: fixed })).toBe("14:07");
		});

		it("formats moment ISO-week token", () => {
			expect(renderTemplate("{{date:YYYYMM-[W]WW}}", { __now: fixed })).toBe("202604-W18");
		});

		it("works in folder templates", () => {
			expect(renderTemplate("Moments/{{date:YYYY}}", { __now: fixed })).toBe("Moments/2026");
		});

		it("supports literal-bracket escapes", () => {
			expect(renderTemplate("{{date:[Year-]YYYY}}", { __now: fixed })).toBe("Year-2026");
		});

		it("does not interfere with normal variables", () => {
			expect(
				renderTemplate("{{firstname}} {{date:YYYY}}", {
					firstname: "Alice",
					__now: fixed,
				})
			).toBe("Alice 2026");
		});
	});
});
