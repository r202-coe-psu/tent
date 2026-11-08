// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import BackLink from './back-link.svelte';

type AfterNavigateArg = { from: { url: URL } | null };

const env = vi.hoisted(() => ({
	url: new URL('http://localhost/back-office/tickets/t-1'),
	callbacks: [] as ((nav: AfterNavigateArg) => void)[]
}));

vi.mock('$app/navigation', () => ({
	afterNavigate: (fn: (nav: AfterNavigateArg) => void) => {
		env.callbacks.push(fn);
	}
}));

vi.mock('$app/state', () => ({
	page: {
		get url() {
			return env.url;
		}
	}
}));

let component: ReturnType<typeof mount> | undefined;
let target: HTMLDivElement;

function render(props: Record<string, unknown> = {}) {
	target = document.createElement('div');
	document.body.appendChild(target);
	component = mount(BackLink, {
		target,
		props: { href: '/back-office/tickets/kitchen', label: 'กลับไปคิวตั๋ว', ...props }
	});
	flushSync();
	const link = target.querySelector('[data-back-link]') as HTMLAnchorElement | null;
	if (!link) throw new Error('back link not rendered');
	return link;
}

function arriveFrom(pathname: string | null) {
	const nav: AfterNavigateArg = {
		from: pathname === null ? null : { url: new URL(`http://localhost${pathname}`) }
	};
	for (const fn of env.callbacks) fn(nav);
	flushSync();
}

function click(link: HTMLAnchorElement, init: MouseEventInit = {}) {
	const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init });
	link.dispatchEvent(event);
	flushSync();
	return event;
}

beforeEach(() => {
	env.url = new URL('http://localhost/back-office/tickets/t-1');
	env.callbacks = [];
	vi.spyOn(history, 'back').mockImplementation(() => {});
});

afterEach(() => {
	if (component) unmount(component);
	component = undefined;
	target?.remove();
	vi.restoreAllMocks();
});

describe('BackLink', () => {
	it('renders one link to the destination, named by its visible label', () => {
		const link = render();

		expect(link.tagName).toBe('A');
		expect(link.getAttribute('href')).toBe('/back-office/tickets/kitchen');
		expect(link.textContent?.trim()).toBe('กลับไปคิวตั๋ว');
	});

	it('prefers a valid ?from= over the default destination', () => {
		env.url = new URL('http://localhost/back-office/tickets/t-1?from=/back-office/distribution');

		expect(render().getAttribute('href')).toBe('/back-office/distribution');
	});

	it.each(['//evil.example/steal', 'https://evil.example/steal', '/\\evil.example'])(
		'ignores ?from=%s and keeps the in-app destination',
		(from) => {
			env.url = new URL(
				`http://localhost/back-office/tickets/t-1?from=${encodeURIComponent(from)}`
			);

			expect(render().getAttribute('href')).toBe('/back-office/tickets/kitchen');
		}
	);

	it('ignores ?from= entirely when the page opts out', () => {
		env.url = new URL('http://localhost/back-office/tickets/t-1?from=/back-office/distribution');

		expect(render({ fromParam: false }).getAttribute('href')).toBe('/back-office/tickets/kitchen');
	});

	it('goes back in history when the previous page is the destination, keeping its state', () => {
		const link = render();
		arriveFrom('/back-office/tickets/kitchen');

		const event = click(link);

		expect(history.back).toHaveBeenCalledOnce();
		expect(event.defaultPrevented).toBe(true);
	});

	it('navigates normally when the user arrived from somewhere else', () => {
		const link = render();
		arriveFrom('/back-office/distribution');

		const event = click(link);

		expect(history.back).not.toHaveBeenCalled();
		expect(event.defaultPrevented).toBe(false);
	});

	it('navigates normally on a deep link with no previous page', () => {
		const link = render();
		arriveFrom(null);

		const event = click(link);

		expect(history.back).not.toHaveBeenCalled();
		expect(event.defaultPrevented).toBe(false);
	});

	it('never goes back in history when the page opts out', () => {
		const link = render({ restore: false });
		arriveFrom('/back-office/tickets/kitchen');

		const event = click(link);

		expect(history.back).not.toHaveBeenCalled();
		expect(event.defaultPrevented).toBe(false);
	});

	it.each([
		['ctrl', { ctrlKey: true }],
		['meta', { metaKey: true }],
		['shift', { shiftKey: true }],
		['middle button', { button: 1 }]
	])('leaves a %s click to the browser so the page can open in a new tab', (_name, init) => {
		const link = render();
		arriveFrom('/back-office/tickets/kitchen');

		const event = click(link, init);

		expect(history.back).not.toHaveBeenCalled();
		expect(event.defaultPrevented).toBe(false);
	});
});
