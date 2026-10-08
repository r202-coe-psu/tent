import { afterEach, describe, expect, it, vi } from 'vitest';
import type { KioskStaffPinResult } from '../data/kiosk-staff-pin.api';
import { StaffPinEntry, STAFF_PIN_IDLE_MS, STAFF_PIN_LENGTH } from './staff-pin-entry.svelte';

function setup(results: (KioskStaffPinResult | Error)[] = [{ kind: 'verified' }]) {
	const queue = [...results];
	const verify = vi.fn<(pin: string) => Promise<KioskStaffPinResult>>(async () => {
		const next = queue.length > 1 ? queue.shift()! : queue[0];
		if (next instanceof Error) throw next;
		return next;
	});
	const onverified = vi.fn();
	const oncancel = vi.fn();
	const onretry = vi.fn();
	const entry = new StaffPinEntry({ verify, onverified, oncancel, onretry });
	entry.start();
	return { entry, verify, onverified, oncancel, onretry };
}

function type(entry: StaffPinEntry, digits: string): void {
	for (const digit of digits) entry.press(digit);
}

afterEach(() => {
	vi.useRealTimers();
});

describe('StaffPinEntry typing', () => {
	it('takes up to six digits and can only confirm once all six are in', () => {
		const { entry } = setup();

		type(entry, '12345');
		expect(entry.canConfirm).toBe(false);
		type(entry, '67');
		expect(entry.pin).toBe('123456');
		expect(entry.pin).toHaveLength(STAFF_PIN_LENGTH);
		expect(entry.canConfirm).toBe(true);

		entry.press('Backspace');
		expect(entry.pin).toBe('12345');
	});

	it('ignores keys it does not use', () => {
		const { entry } = setup();

		expect(entry.press('a')).toBe(false);
		expect(entry.press('Tab')).toBe(false);
		expect(entry.pin).toBe('');
	});

	it('does not check a short PIN', async () => {
		const { entry, verify } = setup();

		type(entry, '123');
		await entry.confirm();

		expect(verify).not.toHaveBeenCalled();
	});
});

describe('StaffPinEntry.confirm', () => {
	it('carries on once the PIN is right, and forgets it', async () => {
		const { entry, verify, onverified, oncancel } = setup();

		type(entry, '123456');
		await entry.confirm();

		expect(verify).toHaveBeenCalledExactlyOnceWith('123456');
		expect(onverified).toHaveBeenCalledOnce();
		expect(entry.pin).toBe('');
		entry.cancel();
		expect(oncancel).not.toHaveBeenCalled();
	});

	it('confirms with Enter as well', async () => {
		const { entry, onverified } = setup();

		type(entry, '123456');
		entry.press('Enter');
		await vi.waitFor(() => expect(onverified).toHaveBeenCalledOnce());
	});

	it('locks the keys while the server checks', async () => {
		let answer!: (result: KioskStaffPinResult) => void;
		const onverified = vi.fn();
		const checking = new StaffPinEntry({
			verify: () => new Promise((done) => (answer = done)),
			onverified,
			oncancel: vi.fn()
		});

		type(checking, '123456');
		const pending = checking.confirm();
		expect(checking.status.kind).toBe('checking');
		expect(checking.keysDisabled).toBe(true);
		checking.press('Backspace');
		expect(checking.pin).toBe('123456');

		answer({ kind: 'verified' });
		await pending;
		expect(onverified).toHaveBeenCalledOnce();
	});

	it('says the PIN is wrong, clears it and lets staff try again (no lockout)', async () => {
		const { entry, onverified, onretry, verify } = setup([{ kind: 'wrong' }]);

		for (let attempt = 1; attempt <= 5; attempt++) {
			type(entry, '000000');
			await entry.confirm();
			expect(entry.status.kind).toBe('wrong');
			expect(entry.pin).toBe('');
			expect(entry.keysDisabled).toBe(false);
		}
		expect(verify).toHaveBeenCalledTimes(5);
		expect(onretry).toHaveBeenCalledTimes(5);
		expect(onverified).not.toHaveBeenCalled();
	});

	it('lets staff retry when the server could not check the PIN (timeout, server down)', async () => {
		const { entry, onverified, onretry, verify } = setup([{ kind: 'error' }, { kind: 'verified' }]);

		type(entry, '123456');
		await entry.confirm();
		expect(entry.status.kind).toBe('error');
		expect(entry.keysDisabled).toBe(false);
		expect(onretry).toHaveBeenCalledOnce();

		type(entry, '123456');
		await entry.confirm();
		expect(verify).toHaveBeenCalledTimes(2);
		expect(onverified).toHaveBeenCalledOnce();
	});

	it('treats a thrown check as a retryable error', async () => {
		const { entry } = setup([new TypeError('Failed to fetch')]);

		type(entry, '123456');
		await entry.confirm();

		expect(entry.status.kind).toBe('error');
		expect(entry.keysDisabled).toBe(false);
	});

	it('blocks the keys only when no PIN is set on this kiosk', async () => {
		const { entry, onretry } = setup([{ kind: 'not_set' }]);

		type(entry, '123456');
		await entry.confirm();

		expect(entry.status.kind).toBe('blocked');
		expect(entry.keysDisabled).toBe(true);
		expect(onretry).not.toHaveBeenCalled();
		type(entry, '1');
		expect(entry.pin).toBe('');
	});

	it('ignores a late answer once the panel was cancelled', async () => {
		let answer!: (result: KioskStaffPinResult) => void;
		const onverified = vi.fn();
		const oncancel = vi.fn();
		const entry = new StaffPinEntry({
			verify: () => new Promise((done) => (answer = done)),
			onverified,
			oncancel
		});

		type(entry, '123456');
		const pending = entry.confirm();
		entry.press('Escape');
		answer({ kind: 'verified' });
		await pending;

		expect(oncancel).toHaveBeenCalledOnce();
		expect(onverified).not.toHaveBeenCalled();
	});
});

describe('StaffPinEntry closing', () => {
	it('cancels on Esc, forgets the PIN, and only once', () => {
		const { entry, oncancel } = setup();

		type(entry, '123');
		expect(entry.press('Escape')).toBe(true);
		entry.press('Escape');
		entry.cancel();

		expect(oncancel).toHaveBeenCalledOnce();
		expect(entry.pin).toBe('');
	});

	it('closes itself as cancelled after 30 s without a touch', () => {
		vi.useFakeTimers();
		const { entry, oncancel } = setup();
		type(entry, '12');

		vi.advanceTimersByTime(STAFF_PIN_IDLE_MS - 1);
		expect(oncancel).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(oncancel).toHaveBeenCalledOnce();
		expect(entry.pin).toBe('');
	});

	it('starts the 30 s again on every touch', () => {
		vi.useFakeTimers();
		const { entry, oncancel } = setup();

		vi.advanceTimersByTime(STAFF_PIN_IDLE_MS - 1_000);
		entry.touch();
		vi.advanceTimersByTime(STAFF_PIN_IDLE_MS - 1);
		expect(oncancel).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(oncancel).toHaveBeenCalledOnce();
	});

	it('does not call back once the page closed it', () => {
		vi.useFakeTimers();
		const { entry, oncancel } = setup();
		type(entry, '12');

		entry.close();
		vi.advanceTimersByTime(STAFF_PIN_IDLE_MS * 2);

		expect(oncancel).not.toHaveBeenCalled();
		expect(entry.pin).toBe('');
	});
});
