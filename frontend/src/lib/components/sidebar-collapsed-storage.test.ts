// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	SIDEBAR_COLLAPSED_KEY,
	readSidebarCollapsed,
	writeSidebarCollapsed
} from './sidebar-collapsed-storage';

describe('sidebar collapsed storage', () => {
	beforeEach(() => localStorage.clear());
	afterEach(() => vi.restoreAllMocks());

	it('reads as collapsed on the first visit, when nothing is stored', () => {
		expect(readSidebarCollapsed()).toBe(true);
	});

	it('reads back an expanded choice', () => {
		writeSidebarCollapsed(false);
		expect(readSidebarCollapsed()).toBe(false);
	});

	it('reads back a collapsed choice', () => {
		writeSidebarCollapsed(false);
		writeSidebarCollapsed(true);
		expect(readSidebarCollapsed()).toBe(true);
	});

	it('reads an unrecognised stored value as collapsed', () => {
		localStorage.setItem(SIDEBAR_COLLAPSED_KEY, 'nope');
		expect(readSidebarCollapsed()).toBe(true);
	});

	it('reads as collapsed without throwing when getItem throws', () => {
		vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new Error('blocked');
		});
		expect(readSidebarCollapsed()).toBe(true);
	});

	it('does not throw when setItem throws', () => {
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('quota');
		});
		expect(() => writeSidebarCollapsed(false)).not.toThrow();
	});
});
