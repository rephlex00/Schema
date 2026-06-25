import { describe, expect, it } from "vitest";
import { evalExpression, evalFunctionBody, SafeEvalError } from "../../src/util/safe-eval";

describe("evalExpression - values & operators", () => {
	it("evaluates arithmetic and precedence", () => {
		expect(evalExpression("1 + 2 * 3")).toBe(7);
		expect(evalExpression("(1 + 2) * 3")).toBe(9);
		expect(evalExpression("2 ** 10")).toBe(1024);
		expect(evalExpression("7 % 3")).toBe(1);
	});

	it("concatenates strings and resolves scope variables", () => {
		expect(evalExpression("fm.first + ' ' + fm.last", { fm: { first: "Ada", last: "Lovelace" } })).toBe(
			"Ada Lovelace"
		);
	});

	it("handles ternary, logical and nullish operators", () => {
		expect(evalExpression("a ? 'yes' : 'no'", { a: true })).toBe("yes");
		expect(evalExpression("a && b", { a: 1, b: 2 })).toBe(2);
		expect(evalExpression("a || b", { a: 0, b: 5 })).toBe(5);
		expect(evalExpression("a ?? b", { a: null, b: 9 })).toBe(9);
	});

	it("supports template literals", () => {
		expect(evalExpression("`${x}-${y}`", { x: "a", y: 1 })).toBe("a-1");
	});

	it("supports optional chaining", () => {
		expect(evalExpression("a?.b?.c", { a: null })).toBeUndefined();
		expect(evalExpression("a?.b?.c", { a: { b: { c: 5 } } })).toBe(5);
	});

	it("builds arrays and objects", () => {
		expect(evalExpression("[1, 2, ...rest]", { rest: [3, 4] })).toEqual([1, 2, 3, 4]);
		expect(evalExpression("({ a: 1, [k]: 2 })", { k: "b" })).toEqual({ a: 1, b: 2 });
	});

	it("exposes safe globals (Math, JSON, Number)", () => {
		expect(evalExpression("Math.round(fm.miles * 1.60934 * 100) / 100", { fm: { miles: 3 } })).toBe(4.83);
		expect(evalExpression("JSON.stringify({a: 1})")).toBe('{"a":1}');
		expect(evalExpression("Number('42') + 1")).toBe(43);
		expect(evalExpression("Object.keys({a:1, b:2}).length")).toBe(2);
	});

	it("typeof of an unknown identifier is 'undefined', not an error", () => {
		expect(evalExpression("typeof whatever")).toBe("undefined");
	});

	it("throws SafeEvalError reading a property of undefined", () => {
		expect(() => evalExpression("fm.a.b.c", { fm: {} })).toThrow(SafeEvalError);
	});
});

describe("evalExpression - arrow callbacks become host closures", () => {
	it("works with Array.prototype.filter/map/some", () => {
		expect(evalExpression("xs.filter(n => n > 2)", { xs: [1, 2, 3, 4] })).toEqual([3, 4]);
		expect(evalExpression("xs.map(n => n * 2)", { xs: [1, 2, 3] })).toEqual([2, 4, 6]);
		expect(evalExpression("xs.some(n => n === 3)", { xs: [1, 2, 3] })).toBe(true);
	});

	it("captures free variables from the enclosing scope", () => {
		const arrow = evalExpression("m => m.type === t && m.owner === current.name", {
			t: "event",
			current: { name: "Alice" },
		}) as (m: unknown) => boolean;
		expect(arrow({ type: "event", owner: "Alice" })).toBe(true);
		expect(arrow({ type: "event", owner: "Bob" })).toBe(false);
	});

	it("evaluates a dataview-style query against a mock dv API", () => {
		// Minimal DataArray with the chainable .where used by lookup queries.
		const makeArr = (rows: { file: { path: string } }[]) => ({
			values: rows,
			where(pred: (r: { file: { path: string } }) => boolean) {
				return makeArr(rows.filter(pred));
			},
		});
		const dv = {
			pages: () =>
				makeArr([
					{ file: { path: "A/one.md" }, type: "event" } as never,
					{ file: { path: "B/two.md" }, type: "journal" } as never,
				]),
		};
		const result = evalExpression(`dv.pages('"X"').where(p => p.type === "event")`, {
			dv,
			current: { file: { path: "me.md" } },
		}) as { values: { file: { path: string } }[] };
		expect(result.values.map((r) => r.file.path)).toEqual(["A/one.md"]);
	});
});

describe("evalFunctionBody - statement bodies", () => {
	it("runs a custom-filter style body with return", () => {
		const fn = evalFunctionBody(["value"], "return value.toUpperCase() + '!';");
		expect(fn("hi")).toBe("HI!");
	});

	it("supports local variables, conditionals and loops", () => {
		const fn = evalFunctionBody(
			["value"],
			`let out = "";
			 for (let i = 0; i < value.length; i++) {
				 if (value[i] !== " ") out += value[i];
			 }
			 return out;`
		);
		expect(fn("a b c")).toBe("abc");
	});

	it("returns undefined when the body has no return", () => {
		const fn = evalFunctionBody(["value"], "value.trim();");
		expect(fn("  x  ")).toBeUndefined();
	});
});

describe("safe-eval - sandbox guards", () => {
	it("blocks member access to constructor / __proto__ / prototype", () => {
		expect(() => evalExpression("({}).constructor")).toThrow(SafeEvalError);
		expect(() => evalExpression("({}).__proto__")).toThrow(SafeEvalError);
		expect(() => evalExpression("[].constructor")).toThrow(SafeEvalError);
		expect(() => evalExpression("({})['constructor']")).toThrow(SafeEvalError);
	});

	it("refuses the classic constructor-of-constructor escape", () => {
		expect(() => evalExpression("[].filter.constructor('return process')()")).toThrow(SafeEvalError);
	});

	it("does not expose dangerous globals", () => {
		for (const name of ["Function", "eval", "globalThis", "window", "process", "require", "Reflect"]) {
			expect(() => evalExpression(name)).toThrow(SafeEvalError);
		}
	});

	it("withholds Object reflection methods that could climb to Function", () => {
		expect(() => evalExpression("Object.getPrototypeOf([])")).toThrow(SafeEvalError);
		expect(() => evalExpression("Object.getOwnPropertyDescriptor([], 'length')")).toThrow(SafeEvalError);
	});

	it("aborts runaway loops via the step budget", () => {
		const fn = evalFunctionBody([], "while (true) {}");
		expect(() => fn()).toThrow(SafeEvalError);
	});

	it("reports a clear error for unsupported syntax", () => {
		// A class expression is outside the supported subset.
		expect(() => evalExpression("class X {}")).toThrow(SafeEvalError);
	});
});
