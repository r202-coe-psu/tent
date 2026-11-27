// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import StaffAccountMenu from './staff-account-menu.svelte';

const session = vi.hoisted(() => ({
	user: null as { name: string; roles: string[]; display_name?: string | null } | null
}));

vi.mock('$lib/stores/auth.svelte', () => ({
	authStore: {
		get user() {
			return session.user;
		},
		logout: vi.fn()
	}
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('svelte-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

let instance: ReturnType<typeof mount> | null = null;

afterEach(async () => {
	if (instance) await unmount(instance);
	instance = null;
	session.user = null;
	document.body.innerHTML = '';
});

function render(props: { compact?: boolean } = {}) {
	instance = mount(StaffAccountMenu, { target: document.body, props });
	flushSync();
	const trigger = document.body.querySelector('button');
	expect(trigger).not.toBeNull();
	return trigger!;
}

describe('StaffAccountMenu trigger', () => {
	it('shows the full name, not the username', () => {
		session.user = { name: 'somchai', roles: [], display_name: '  สมชาย ใจดี ' };
		const trigger = render();
		expect(trigger.textContent?.trim()).toBe('สมชาย ใจดี');
		expect(trigger.getAttribute('aria-label')).toBe('สมชาย ใจดี');
	});

	it('falls back to the username when there is no full name', () => {
		session.user = { name: 'somchai', roles: [], display_name: null };
		expect(render().textContent?.trim()).toBe('somchai');
	});

	it('renders no initials avatar', () => {
		session.user = { name: 'somchai', roles: [], display_name: 'Somchai Jaidee' };
		const trigger = render();
		expect(trigger.textContent).not.toContain('SO');
		expect(trigger.querySelectorAll('span')).toHaveLength(1);
		expect(trigger.querySelector('.rounded-full')).toBeNull();
	});

	it('keeps the name visible in compact mode and truncates it', () => {
		session.user = { name: 'somchai', roles: [], display_name: 'สมชาย ใจดี' };
		const trigger = render({ compact: true });
		const name = trigger.querySelector('span');
		expect(name?.textContent?.trim()).toBe('สมชาย ใจดี');
		expect(name?.className).toContain('truncate');
		expect(name?.className).not.toContain('hidden');
		// Stays inside a narrow collapsed rail instead of spilling past it.
		expect(trigger.className).toContain('overflow-hidden');
		expect(trigger.className).toContain('max-w-full');
		expect(trigger.getAttribute('title')).toBe('สมชาย ใจดี');
	});
});
