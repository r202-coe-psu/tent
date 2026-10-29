import { afterEach, describe, expect, it, vi } from 'vitest';
import { readStoredDeskMode, storeDeskMode } from './desk-mode-storage';

function stubStorage(store: Record<string, string> = {}) {
	vi.stubGlobal('localStorage', {
		getItem: (key: string) => store[key] ?? null,
		setItem: (key: string, value: string) => {
			store[key] = value;
		}
	});
	return store;
}

afterEach(() => vi.unstubAllGlobals());

describe('desk mode storage', () => {
	it('round-trips a stored mode', () => {
		stubStorage();
		storeDeskMode('supplies');
		expect(readStoredDeskMode()).toBe('supplies');
	});

	it('ignores an unrecognised stored value', () => {
		stubStorage({ 'distribution-desk-mode': 'drinks' });
		expect(readStoredDeskMode()).toBeNull();
	});

	it('survives storage that throws', () => {
		vi.stubGlobal('localStorage', {
			getItem: () => {
				throw new Error('blocked');
			},
			setItem: () => {
				throw new Error('blocked');
			}
		});
		expect(readStoredDeskMode()).toBeNull();
		expect(() => storeDeskMode('food')).not.toThrow();
	});
});
