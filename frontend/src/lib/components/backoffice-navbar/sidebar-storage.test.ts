// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	BACKOFFICE_SIDEBAR_KEY,
	readBackofficeSidebarCollapsed,
	writeBackofficeSidebarCollapsed
} from './sidebar-storage';

describe('backoffice sidebar storage', () => {
	beforeEach(() => localStorage.clear());
	afterEach(() => vi.restoreAllMocks());

	it('reads as collapsed when nothing is stored', () => {
		expect(readBackofficeSidebarCollapsed()).toBe(true);
	});

	it('reads back an expanded choice', () => {
		writeBackofficeSidebarCollapsed(false);
		expect(readBackofficeSidebarCollapsed()).toBe(false);
	});

	it('reads back a collapsed choice', () => {
		writeBackofficeSidebarCollapsed(true);
		expect(readBackofficeSidebarCollapsed()).toBe(true);
	});

	it('reads an unrecognised stored value as collapsed', () => {
		localStorage.setItem(BACKOFFICE_SIDEBAR_KEY, 'nope');
		expect(readBackofficeSidebarCollapsed()).toBe(true);
	});

	it('reads as collapsed without throwing when getItem throws', () => {
		vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new Error('blocked');
		});
		expect(readBackofficeSidebarCollapsed()).toBe(true);
	});

	it('does not throw when setItem throws', () => {
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('quota');
		});
		expect(() => writeBackofficeSidebarCollapsed(false)).not.toThrow();
	});
});
