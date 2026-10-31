import { SvelteDate } from 'svelte/reactivity';

/**
 * A reactive clock that re-reads the wall time every minute while a component
 * is mounted (#885, #849 CR-207 FR-1). Call during component init: the interval
 * lives in an `$effect` and is cleared on teardown. Everything time-dependent
 * (`today`, "รอยืนยันการเข้างาน") must derive from `clock.now`, never from a
 * fresh `new Date()`, so one tick moves them together.
 */
export const MINUTE_MS = 60_000;

export function createMinuteClock(): { readonly now: SvelteDate } {
	const now = new SvelteDate(Date.now());
	$effect(() => {
		const timer = setInterval(() => now.setTime(Date.now()), MINUTE_MS);
		return () => clearInterval(timer);
	});
	return { now };
}
