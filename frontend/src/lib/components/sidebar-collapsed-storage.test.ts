// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	SIDEBAR_COLLAPSED_KEYS,
	readSidebarCollapsed,
	writeSidebarCollapsed
} from './sidebar-collapsed-storage';

const { backoffice, systemManagement } = SIDEBAR_COLLAPSED_KEYS;

describe('sidebar collapsed storage', () => {
	beforeEach(() => localStorage.clear());
	afterEach(() => vi.restoreAllMocks());

	it('reads as collapsed when nothing is stored', () => {
		expect(readSidebarCollapsed(backoffice)).toBe(true);
	});

	it('reads back an expanded choice', () => {
		writeSidebarCollapsed(backoffice, false);
		expect(readSidebarCollapsed(backoffice)).toBe(false);
	});

	it('reads back a collapsed choice', () => {
		writeSidebarCollapsed(backoffice, true);
		expect(readSidebarCollapsed(backoffice)).toBe(true);
	});

	it('keeps each sidebar choice separate', () => {
		writeSidebarCollapsed(systemManagement, false);
		expect(readSidebarCollapsed(systemManagement)).toBe(false);
		expect(readSidebarCollapsed(backoffice)).toBe(true);
	});

	it('reads an unrecognised stored value as collapsed', () => {
		localStorage.setItem(backoffice, 'nope');
		expect(readSidebarCollapsed(backoffice)).toBe(true);
	});

	it('reads as collapsed without throwing when getItem throws', () => {
		vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new Error('blocked');
		});
		expect(readSidebarCollapsed(backoffice)).toBe(true);
	});

	it('does not throw when setItem throws', () => {
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('quota');
		});
		expect(() => writeSidebarCollapsed(backoffice, false)).not.toThrow();
	});
});
