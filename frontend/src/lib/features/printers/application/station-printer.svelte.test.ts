import { afterEach, describe, expect, it, vi } from 'vitest';
import { StationPrinterStore } from './station-printer.svelte';

function memoryStorage(): Storage {
	const data = new Map<string, string>();
	return {
		get length() {
			return data.size;
		},
		clear: () => data.clear(),
		getItem: (key) => data.get(key) ?? null,
		key: (i) => [...data.keys()][i] ?? null,
		removeItem: (key) => void data.delete(key),
		setItem: (key, value) => void data.set(key, value)
	};
}

function throwingStorage(): Storage {
	const boom = () => {
		throw new DOMException('denied', 'SecurityError');
	};
	return {
		length: 0,
		clear: boom,
		getItem: boom,
		key: boom,
		removeItem: boom,
		setItem: boom
	};
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('StationPrinterStore', () => {
	it('has no printer until one is chosen', () => {
		vi.stubGlobal('localStorage', memoryStorage());

		expect(new StationPrinterStore().get('SH001')).toBeNull();
	});

	it('remembers the chosen printer per shelter across reloads', () => {
		vi.stubGlobal('localStorage', memoryStorage());
		const store = new StationPrinterStore();

		store.set('SH001', 'print_device:a');
		store.set('SH002', 'print_device:b');

		const afterReload = new StationPrinterStore();
		expect(afterReload.get('SH001')).toBe('print_device:a');
		expect(afterReload.get('SH002')).toBe('print_device:b');
		expect(localStorage.getItem('tent.printer.SH001')).toBe('print_device:a');
	});

	it('forgets the choice when cleared', () => {
		vi.stubGlobal('localStorage', memoryStorage());
		const store = new StationPrinterStore();
		store.set('SH001', 'print_device:a');

		store.set('SH001', null);

		expect(store.get('SH001')).toBeNull();
		expect(new StationPrinterStore().get('SH001')).toBeNull();
	});

	it('reads as no printer when storage throws', () => {
		vi.stubGlobal('localStorage', throwingStorage());

		expect(new StationPrinterStore().get('SH001')).toBeNull();
	});

	it('keeps the choice in memory when storage throws on write', () => {
		vi.stubGlobal('localStorage', throwingStorage());
		const store = new StationPrinterStore();

		expect(() => store.set('SH001', 'print_device:a')).not.toThrow();

		expect(store.get('SH001')).toBe('print_device:a');
	});

	it('works without any localStorage', () => {
		vi.stubGlobal('localStorage', undefined);
		const store = new StationPrinterStore();

		store.set('SH001', 'print_device:a');

		expect(store.get('SH001')).toBe('print_device:a');
		expect(new StationPrinterStore().get('SH001')).toBeNull();
	});
});
