/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument -- this is a sandboxed AST interpreter; it walks untyped ESTree nodes and operates on `any` user values by design. */

/**
 * A small, sandboxed JavaScript evaluator used in place of `new Function` /
 * `eval` for the plugin's user-authored expressions (Formula fields, Lookup /
 * Dataview JS queries, custom Liquid filters).
 *
 * It parses source with acorn (no code generation, no `eval`) and tree-walks the
 * resulting ESTree AST. The interpreter is deliberately limited:
 *
 * - Identifiers resolve only against an explicit scope plus a small whitelist of
 *   safe globals (`Math`, `JSON`, `Date`, ...). `globalThis`, `window`,
 *   `Function`, `eval`, `require`, `process`, etc. are never reachable.
 * - Member access to `constructor`, `prototype`, and `__proto__` is blocked,
 *   which closes the classic `({}).constructor.constructor("...")()` escape that
 *   would otherwise make a tree-walker as dangerous as `new Function`.
 * - A bounded step counter prevents runaway loops from hanging the app.
 *
 * The trust model is unchanged from before (these expressions come from the
 * user's own plugin config, not remote input) but nothing here can break out of
 * the sandbox the way raw `new Function` could.
 */

import { parse, parseExpressionAt } from "acorn";

type Node = any;
type Scope = Record<string, unknown>;

/** Property names that would let sandboxed code climb the prototype chain back
 *  to the Function constructor (or pollute prototypes). Access is refused. */
const BLOCKED_PROPS = new Set(["__proto__", "constructor", "prototype"]);

/** A reflection-free `Object` facade. The real `Object` is withheld because its
 *  reflection methods (`getPrototypeOf`, `getOwnPropertyDescriptor`, ...) let
 *  sandboxed code climb to a constructor and then to `Function` - the member
 *  denylist below only guards property *access*, not these string-keyed APIs. */
const SAFE_OBJECT = Object.freeze({
	keys: Object.keys,
	values: Object.values,
	entries: Object.entries,
	assign: Object.assign,
	fromEntries: Object.fromEntries,
	freeze: Object.freeze,
});

/** Globals exposed to expressions. Pure, side-effect-free value helpers only -
 *  no I/O, no reflection, nothing that can reach `Function`/`eval`. */
const SAFE_GLOBALS: Readonly<Scope> = Object.freeze({
	Math,
	JSON,
	Number,
	String,
	Boolean,
	Array,
	Object: SAFE_OBJECT,
	Date,
	RegExp,
	parseInt,
	parseFloat,
	isNaN,
	isFinite,
	NaN,
	Infinity,
	undefined,
});

/** Hard ceiling on interpreter steps, so a user loop (`while (true) {}`) surfaces
 *  as an error instead of freezing Obsidian. */
const MAX_STEPS = 1_000_000;

/** Thrown for anything the sandbox refuses or can't handle. */
export class SafeEvalError extends Error {}

/** Lexical environment: a variable map chained to a parent scope. */
class Env {
	private readonly vars = new Map<string, unknown>();
	constructor(private readonly parent: Env | null) {}

	static root(scope: Scope): Env {
		const env = new Env(null);
		for (const [k, v] of Object.entries(SAFE_GLOBALS)) env.define(k, v);
		// User scope wins over globals of the same name (e.g. a frontmatter key
		// called `Date`), matching how `new Function` parameters shadowed globals.
		for (const [k, v] of Object.entries(scope)) env.define(k, v);
		return env;
	}

	child(): Env {
		return new Env(this);
	}

	define(name: string, value: unknown): void {
		this.vars.set(name, value);
	}

	has(name: string): boolean {
		return this.vars.has(name) || (this.parent?.has(name) ?? false);
	}

	get(name: string): unknown {
		if (this.vars.has(name)) return this.vars.get(name);
		if (this.parent) return this.parent.get(name);
		throw new SafeEvalError(`${name} is not defined`);
	}

	assign(name: string, value: unknown): void {
		if (this.vars.has(name)) {
			this.vars.set(name, value);
			return;
		}
		if (this.parent) {
			this.parent.assign(name, value);
			return;
		}
		throw new SafeEvalError(`${name} is not defined`);
	}
}

/** Statement completion signal (normal fall-through vs. return/break/continue). */
type Completion =
	| { type: "normal" }
	| { type: "return"; value: unknown }
	| { type: "break" }
	| { type: "continue" };

const NORMAL: Completion = { type: "normal" };

/**
 * Evaluate a single JS expression with the given variable scope and return its
 * value. Used for Formula fields and Lookup / Dataview JS queries (including
 * arrow-function callbacks passed to `.filter`/`.where`, which become real host
 * closures so the host API can invoke them).
 */
export function evalExpression(code: string, scope: Scope = {}): unknown {
	let node: Node;
	try {
		node = parseExpressionAt(code, 0, { ecmaVersion: 2020 });
	} catch (err) {
		throw new SafeEvalError(err instanceof Error ? err.message : String(err));
	}
	const ctx = new Ctx();
	return ctx.evalNode(node, Env.root(scope));
}

/**
 * Compile a function body (a sequence of statements) into a host closure. Used
 * for user-registered custom Liquid filters, whose body receives the declared
 * params and returns a value.
 */
export function evalFunctionBody(
	params: string[],
	body: string,
	scope: Scope = {}
): (...args: unknown[]) => unknown {
	let program: Node;
	try {
		program = parse(body, { ecmaVersion: 2020, allowReturnOutsideFunction: true });
	} catch (err) {
		throw new SafeEvalError(err instanceof Error ? err.message : String(err));
	}
	const root = Env.root(scope);
	return (...args: unknown[]): unknown => {
		const ctx = new Ctx();
		const env = root.child();
		params.forEach((name, i) => env.define(name, args[i]));
		const completion = ctx.execStatements(program.body, env);
		return completion.type === "return" ? completion.value : undefined;
	};
}

/** Per-evaluation interpreter state (the step budget). A fresh `Ctx` is created
 *  for each top-level evaluation / closure call. */
class Ctx {
	private steps = 0;

	private tick(): void {
		if (++this.steps > MAX_STEPS) {
			throw new SafeEvalError("expression exceeded the evaluation step limit");
		}
	}

	execStatements(stmts: Node[], env: Env): Completion {
		for (const stmt of stmts) {
			const c = this.execStatement(stmt, env);
			if (c.type !== "normal") return c;
		}
		return NORMAL;
	}

	private execStatement(node: Node, env: Env): Completion {
		this.tick();
		switch (node.type) {
			case "ExpressionStatement":
				this.evalNode(node.expression, env);
				return NORMAL;
			case "ReturnStatement":
				return {
					type: "return",
					value: node.argument ? this.evalNode(node.argument, env) : undefined,
				};
			case "VariableDeclaration": {
				for (const decl of node.declarations) {
					const value = decl.init ? this.evalNode(decl.init, env) : undefined;
					this.bindPattern(decl.id, value, env);
				}
				return NORMAL;
			}
			case "BlockStatement":
				return this.execStatements(node.body, env.child());
			case "IfStatement": {
				if (truthy(this.evalNode(node.test, env))) {
					return this.execStatement(node.consequent, env.child());
				} else if (node.alternate) {
					return this.execStatement(node.alternate, env.child());
				}
				return NORMAL;
			}
			case "WhileStatement": {
				while (truthy(this.evalNode(node.test, env))) {
					this.tick();
					const c = this.execStatement(node.body, env.child());
					if (c.type === "break") break;
					if (c.type === "return") return c;
				}
				return NORMAL;
			}
			case "ForStatement": {
				const forEnv = env.child();
				if (node.init) {
					if (node.init.type === "VariableDeclaration") this.execStatement(node.init, forEnv);
					else this.evalNode(node.init, forEnv);
				}
				while (node.test ? truthy(this.evalNode(node.test, forEnv)) : true) {
					this.tick();
					const c = this.execStatement(node.body, forEnv.child());
					if (c.type === "break") break;
					if (c.type === "return") return c;
					if (node.update) this.evalNode(node.update, forEnv);
				}
				return NORMAL;
			}
			case "ForOfStatement": {
				const iterable = this.evalNode(node.right, env) as Iterable<unknown>;
				for (const item of iterable ?? []) {
					this.tick();
					const loopEnv = env.child();
					if (node.left.type === "VariableDeclaration") {
						this.bindPattern(node.left.declarations[0].id, item, loopEnv);
					} else {
						this.assignTo(node.left, item, loopEnv);
					}
					const c = this.execStatement(node.body, loopEnv);
					if (c.type === "break") break;
					if (c.type === "return") return c;
				}
				return NORMAL;
			}
			case "BreakStatement":
				return { type: "break" };
			case "ContinueStatement":
				return { type: "continue" };
			case "EmptyStatement":
				return NORMAL;
			default:
				throw new SafeEvalError(`unsupported statement: ${node.type}`);
		}
	}

	evalNode(node: Node, env: Env): unknown {
		this.tick();
		switch (node.type) {
			case "Literal":
				return node.value;
			case "Identifier":
				return env.get(node.name);
			case "ThisExpression":
				return undefined;
			case "TemplateLiteral": {
				let out = "";
				node.quasis.forEach((q: Node, i: number) => {
					out += q.value.cooked;
					if (i < node.expressions.length) out += stringifyTemplate(this.evalNode(node.expressions[i], env));
				});
				return out;
			}
			case "ArrayExpression": {
				const arr: unknown[] = [];
				for (const el of node.elements) {
					if (el == null) {
						arr.length += 1; // hole
					} else if (el.type === "SpreadElement") {
						for (const v of this.evalNode(el.argument, env) as Iterable<unknown>) arr.push(v);
					} else {
						arr.push(this.evalNode(el, env));
					}
				}
				return arr;
			}
			case "ObjectExpression": {
				const obj: Record<string, unknown> = {};
				for (const prop of node.properties) {
					if (prop.type === "SpreadElement") {
						Object.assign(obj, this.evalNode(prop.argument, env));
						continue;
					}
					const key = this.propKey(prop, env);
					if (BLOCKED_PROPS.has(key)) throw new SafeEvalError(`refusing to set '${key}'`);
					obj[key] = this.evalNode(prop.value, env);
				}
				return obj;
			}
			case "MemberExpression":
				return this.evalMember(node, env).value;
			case "ChainExpression":
				return this.evalNode(node.expression, env);
			case "CallExpression":
				return this.evalCall(node, env);
			case "NewExpression": {
				const callee = this.evalNode(node.callee, env) as new (...a: unknown[]) => unknown;
				if (typeof callee !== "function") throw new SafeEvalError("not a constructor");
				return new callee(...this.evalArgs(node.arguments, env));
			}
			case "ArrowFunctionExpression":
			case "FunctionExpression":
				return this.makeClosure(node, env);
			case "UnaryExpression": {
				if (node.operator === "typeof" && node.argument.type === "Identifier" && !env.has(node.argument.name)) {
					return "undefined";
				}
				return applyUnary(node.operator, this.evalNode(node.argument, env));
			}
			case "BinaryExpression":
				return applyBinary(node.operator, this.evalNode(node.left, env), this.evalNode(node.right, env));
			case "LogicalExpression": {
				const left = this.evalNode(node.left, env);
				if (node.operator === "&&") return truthy(left) ? this.evalNode(node.right, env) : left;
				if (node.operator === "||") return truthy(left) ? left : this.evalNode(node.right, env);
				return left ?? this.evalNode(node.right, env); // ??
			}
			case "ConditionalExpression":
				return truthy(this.evalNode(node.test, env))
					? this.evalNode(node.consequent, env)
					: this.evalNode(node.alternate, env);
			case "AssignmentExpression": {
				let value = this.evalNode(node.right, env);
				if (node.operator !== "=") {
					const current = this.evalNode(node.left, env);
					value = applyBinary(node.operator.slice(0, -1), current, value);
				}
				this.assignTo(node.left, value, env);
				return value;
			}
			case "UpdateExpression": {
				const old = Number(this.evalNode(node.argument, env));
				const next = node.operator === "++" ? old + 1 : old - 1;
				this.assignTo(node.argument, next, env);
				return node.prefix ? next : old;
			}
			case "SequenceExpression": {
				let result: unknown;
				for (const expr of node.expressions) result = this.evalNode(expr, env);
				return result;
			}
			case "SpreadElement":
				return this.evalNode(node.argument, env);
			default:
				throw new SafeEvalError(`unsupported expression: ${node.type}`);
		}
	}

	/** Evaluate a member expression, returning both the resolved value and the
	 *  object it was read from (so call expressions can bind `this`). */
	private evalMember(node: Node, env: Env): { obj: unknown; value: unknown } {
		const obj = this.evalNode(node.object, env);
		if (node.optional && obj == null) return { obj, value: undefined };
		const key = node.computed ? String(this.evalNode(node.property, env)) : node.property.name;
		if (BLOCKED_PROPS.has(key)) throw new SafeEvalError(`access to '${key}' is blocked`);
		if (obj == null) throw new SafeEvalError(`cannot read '${key}' of ${String(obj)}`);
		return { obj, value: (obj as Record<string, unknown>)[key] };
	}

	private evalCall(node: Node, env: Env): unknown {
		let fn: unknown;
		let thisArg: unknown = undefined;
		if (node.callee.type === "MemberExpression") {
			const { obj, value } = this.evalMember(node.callee, env);
			if (node.callee.optional && obj == null) return undefined;
			thisArg = obj;
			fn = value;
		} else {
			fn = this.evalNode(node.callee, env);
		}
		if (node.optional && fn == null) return undefined;
		if (typeof fn !== "function") throw new SafeEvalError("attempted to call a non-function");
		return (fn as (...a: unknown[]) => unknown).apply(thisArg, this.evalArgs(node.arguments, env));
	}

	private evalArgs(args: Node[], env: Env): unknown[] {
		const out: unknown[] = [];
		for (const a of args) {
			if (a.type === "SpreadElement") {
				for (const v of this.evalNode(a.argument, env) as Iterable<unknown>) out.push(v);
			} else {
				out.push(this.evalNode(a, env));
			}
		}
		return out;
	}

	/** Turn an arrow/function node into a real callable that the host (or other
	 *  evaluated code) can invoke - this is what makes `.where(p => ...)` work. */
	private makeClosure(node: Node, closureEnv: Env): (...args: unknown[]) => unknown {
		return (...args: unknown[]): unknown => {
			const local = closureEnv.child();
			node.params.forEach((param: Node, i: number) => {
				if (param.type === "RestElement") {
					this.bindPattern(param.argument, args.slice(i), local);
				} else {
					this.bindPattern(param, args[i], local);
				}
			});
			if (node.body.type === "BlockStatement") {
				const c = this.execStatements(node.body.body, local);
				return c.type === "return" ? c.value : undefined;
			}
			return this.evalNode(node.body, local);
		};
	}

	/** Bind a (possibly destructuring) pattern to a value in `env`. */
	private bindPattern(pattern: Node, value: unknown, env: Env): void {
		switch (pattern.type) {
			case "Identifier":
				env.define(pattern.name, value);
				return;
			case "AssignmentPattern":
				this.bindPattern(pattern.left, value === undefined ? this.evalNode(pattern.right, env) : value, env);
				return;
			case "ArrayPattern": {
				const arr = (value ?? []) as unknown[];
				pattern.elements.forEach((el: Node, i: number) => {
					if (el == null) return;
					if (el.type === "RestElement") this.bindPattern(el.argument, arr.slice(i), env);
					else this.bindPattern(el, arr[i], env);
				});
				return;
			}
			case "ObjectPattern": {
				const obj = (value ?? {}) as Record<string, unknown>;
				for (const prop of pattern.properties) {
					if (prop.type === "RestElement") continue; // rest of object props - rarely needed
					const key = this.propKey(prop, env);
					if (BLOCKED_PROPS.has(key)) throw new SafeEvalError(`access to '${key}' is blocked`);
					this.bindPattern(prop.value, obj[key], env);
				}
				return;
			}
			default:
				throw new SafeEvalError(`unsupported binding pattern: ${pattern.type}`);
		}
	}

	/** Assign to an existing binding or object member. */
	private assignTo(target: Node, value: unknown, env: Env): void {
		if (target.type === "Identifier") {
			env.assign(target.name, value);
			return;
		}
		if (target.type === "MemberExpression") {
			const obj = this.evalNode(target.object, env);
			const key = target.computed ? String(this.evalNode(target.property, env)) : target.property.name;
			if (BLOCKED_PROPS.has(key)) throw new SafeEvalError(`assignment to '${key}' is blocked`);
			if (obj == null) throw new SafeEvalError(`cannot set '${key}' of ${String(obj)}`);
			(obj as Record<string, unknown>)[key] = value;
			return;
		}
		throw new SafeEvalError(`unsupported assignment target: ${target.type}`);
	}

	/** Resolve a property/object key node to its string name. */
	private propKey(prop: Node, env: Env): string {
		if (prop.computed) return String(this.evalNode(prop.key, env));
		return prop.key.type === "Identifier" ? prop.key.name : String(prop.key.value);
	}
}

function truthy(v: unknown): boolean {
	return Boolean(v);
}

function stringifyTemplate(v: unknown): string {
	return v == null ? "" : String(v);
}

function applyUnary(op: string, v: any): unknown {
	switch (op) {
		case "-":
			return -v;
		case "+":
			return +v;
		case "!":
			return !v;
		case "~":
			return ~v;
		case "typeof":
			return typeof v;
		case "void":
			return undefined;
		default:
			throw new SafeEvalError(`unsupported unary operator: ${op}`);
	}
}

function applyBinary(op: string, l: any, r: any): unknown {
	switch (op) {
		case "+":
			return l + r;
		case "-":
			return l - r;
		case "*":
			return l * r;
		case "/":
			return l / r;
		case "%":
			return l % r;
		case "**":
			return l ** r;
		case "==":
			return l == r;
		case "!=":
			return l != r;
		case "===":
			return l === r;
		case "!==":
			return l !== r;
		case "<":
			return l < r;
		case "<=":
			return l <= r;
		case ">":
			return l > r;
		case ">=":
			return l >= r;
		case "&":
			return l & r;
		case "|":
			return l | r;
		case "^":
			return l ^ r;
		case "<<":
			return l << r;
		case ">>":
			return l >> r;
		case ">>>":
			return l >>> r;
		case "in":
			return l in r;
		case "instanceof":
			return l instanceof r;
		default:
			throw new SafeEvalError(`unsupported binary operator: ${op}`);
	}
}
