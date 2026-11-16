// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { walkInSession } from '$lib/features/kiosk';
import Page from './+page.svelte';

vi.mock('$app/state', () => ({
	page: { url: new URL('http://kiosk.test/kiosk/closed?shelter_code=S1') }
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

let instance: ReturnType<typeof mount> | null = null;

describe('kiosk closed page clears a walk-in left behind', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
	});

	afterEach(() => {
		if (instance) unmount(instance);
		instance = null;
		walkInSession.clear();
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	// The layout gate can redirect here mid walk-in (a page navigating forward skips its own cleanup).
	it('forgets the card read when the kiosk lands on the closed page', () => {
		walkInSession.begin('1234567890123');

		instance = mount(Page, { target: document.body });
		flushSync();

		expect(walkInSession.active).toBe(false);
		expect(walkInSession.citizenId).toBeNull();
		expect(walkInSession.card).toBeNull();
	});

	it('forgets a ThaiD walk-in session id too', () => {
		walkInSession.beginThaid('thaid-session-1');

		instance = mount(Page, { target: document.body });
		flushSync();

		expect(walkInSession.active).toBe(false);
		expect(walkInSession.thaidSessionId).toBeNull();
	});
});
