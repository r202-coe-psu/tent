// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { scrollAppToTop } from './scroll-app-to-top';

describe('scrollAppToTop', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		document.documentElement.scrollTop = 0;
		document.body.scrollTop = 0;
	});

	it('resets window and document scroll position', () => {
		const scrollTo = vi.fn();
		vi.spyOn(window, 'scrollTo').mockImplementation(scrollTo);

		document.documentElement.scrollTop = 240;
		document.body.scrollTop = 120;

		scrollAppToTop();

		expect(scrollTo).toHaveBeenCalledWith(0, 0);
		expect(document.documentElement.scrollTop).toBe(0);
		expect(document.body.scrollTop).toBe(0);
	});
});
