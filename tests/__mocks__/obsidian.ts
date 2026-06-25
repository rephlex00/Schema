/**
 * Minimal stub of the `obsidian` module for unit tests.
 *
 * Only exports symbols that pure-logic modules touch - Events. UI/Modal/
 * Plugin/Notice/etc. are not needed because we don't unit-test UI surfaces.
 */

type Listener = (...data: unknown[]) => unknown;

export class Events {
	private readonly handlers = new Map<string, Set<Listener>>();

	on(event: string, callback: Listener): { event: string; callback: Listener } {
		const set = this.handlers.get(event) ?? new Set();
		set.add(callback);
		this.handlers.set(event, set);
		return { event, callback };
	}

	off(event: string, callback: Listener): void {
		this.handlers.get(event)?.delete(callback);
	}

	offref(ref: { event: string; callback: Listener }): void {
		this.off(ref.event, ref.callback);
	}

	trigger(event: string, ...data: unknown[]): void {
		const set = this.handlers.get(event);
		if (!set) return;
		for (const cb of set) cb(...data);
	}
}

// Stubs to satisfy type-only imports elsewhere; runtime use isn't expected.
export class TFile {}
export class Modal {}
export class Notice {
	constructor(_msg: string, _timeout?: number) {}
}

/** Mirrors Obsidian's normalizePath: unify separators, collapse repeats, trim. */
export function normalizePath(path: string): string {
	return path
		.replace(/\\/g, "/")
		.replace(/\/{2,}/g, "/")
		.replace(/(^\/|\/$)/g, "")
		.trim();
}
