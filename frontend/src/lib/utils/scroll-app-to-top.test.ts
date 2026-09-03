// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { scrollAppToTop } from './scroll-app-to-top';

describe('scrollAppToTop', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		document.body.innerHTML = '';
		document.documentElement.scrollTop = 0;
		document.body.scrollTop = 0;
	});

	it('resets window and nested overflow containers that are scrolled', () => {
		const scrollTo = vi.fn();
		vi.spyOn(window, 'scrollTo').mockImplementation(scrollTo);

		document.body.innerHTML = `
			<main class="overflow-y-auto"></main>
			<div class="overflow-auto"></div>
			<div class="dropdown overflow-y-auto"></div>
		`;
		const main = document.querySelector('main') as HTMLElement;
		const shell = document.querySelector('.overflow-auto') as HTMLElement;
		const dropdown = document.querySelector('.dropdown') as HTMLElement;
		Object.defineProperty(main, 'scrollTop', { value: 120, writable: true, configurable: true });
		Object.defineProperty(shell, 'scrollTop', { value: 40, writable: true, configurable: true });
		Object.defineProperty(dropdown, 'scrollTop', {
			value: 0,
			writable: true,
			configurable: true
		});

		scrollAppToTop();

		expect(scrollTo).toHaveBeenCalledWith(0, 0);
		expect(main.scrollTop).toBe(0);
		expect(shell.scrollTop).toBe(0);
		expect(dropdown.scrollTop).toBe(0);
	});
});
