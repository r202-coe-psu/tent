// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/stores/auth.svelte', () => ({
	authStore: { user: { name: 'staff@example.com', roles: [] }, logout: vi.fn() }
}));

import StaffAccountMenu from './staff-account-menu.svelte';

let instance: ReturnType<typeof mount> | null = null;

afterEach(async () => {
	if (instance) await unmount(instance);
	instance = null;
	// bits-ui releases its body scroll lock on a timer after the menu unmounts.
	await new Promise((resolve) => setTimeout(resolve, 50));
	document.body.innerHTML = '';
});

async function openMenu(props: { languageSwitcher?: boolean }) {
	instance = mount(StaffAccountMenu, { target: document.body, props });
	flushSync();
	const trigger = document.body.querySelector<HTMLButtonElement>('button[aria-label]');
	expect(trigger).not.toBeNull();
	trigger!.focus();
	trigger!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
	await tick();
	flushSync();
	expect(document.body.querySelector('[role="menu"]')).not.toBeNull();
}

const languageGroup = () => document.body.querySelector('[aria-label="Language selection"]');

describe('StaffAccountMenu language toggle', () => {
	it('has no TH/EN toggle by default (back-office, system management)', async () => {
		await openMenu({});
		expect(languageGroup()).toBeNull();
	});

	it('shows the TH/EN toggle when the screen opts in (onsite, portal)', async () => {
		await openMenu({ languageSwitcher: true });
		expect(languageGroup()).not.toBeNull();
	});
});
