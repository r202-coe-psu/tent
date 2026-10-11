import { describe, expect, it, vi } from 'vitest';
import {
	STAFF_PIN_ALERT_EVERY,
	STAFF_PIN_MAX_PENDING,
	StaffPinTurns
} from '../../../server/staff-pin-turns.mjs';

const turn = (owner: string | number, req: string) => ({ owner, req });

describe('StaffPinTurns', () => {
	it('grants one turn per device and queues the next across owners', () => {
		const turns = new StaffPinTurns();
		expect(turns.acquire('kiosk-01', turn(1, 'a'))).toBe('granted');
		expect(turns.acquire('kiosk-01', turn(2, 'a'))).toBe('queued');
		expect(turns.acquire('kiosk-02', turn(3, 'a'))).toBe('granted');
	});

	it(`answers busy past ${STAFF_PIN_MAX_PENDING} pending checks for one device, whichever worker asks`, () => {
		const turns = new StaffPinTurns();
		for (let i = 0; i < STAFF_PIN_MAX_PENDING; i += 1) turns.acquire('kiosk-01', turn(i, 'a'));
		expect(turns.acquire('kiosk-01', turn(99, 'a'))).toBe('busy');
	});

	it('hands the device to the next waiting turn on release, and ignores a release by a non-holder', () => {
		const turns = new StaffPinTurns();
		turns.acquire('kiosk-01', turn(1, 'a'));
		turns.acquire('kiosk-01', turn(2, 'a'));
		expect(turns.release('kiosk-01', turn(2, 'a'), 'ok')).toBeNull();
		expect(turns.release('kiosk-01', turn(1, 'a'), 'wrong')).toEqual(turn(2, 'a'));
		expect(turns.release('kiosk-01', turn(2, 'a'), 'ok')).toBeNull();
		expect(turns.acquire('kiosk-01', turn(3, 'a'))).toBe('granted');
	});

	it('frees the turns of an owner that went away and grants the next', () => {
		const turns = new StaffPinTurns();
		turns.acquire('kiosk-01', turn(1, 'a'));
		turns.acquire('kiosk-01', turn(2, 'a'));
		turns.acquire('kiosk-02', turn(2, 'b'));
		turns.acquire('kiosk-02', turn(1, 'b'));

		expect(turns.dropOwner(1)).toEqual([{ device: 'kiosk-01', turn: turn(2, 'a') }]);
		expect(turns.release('kiosk-02', turn(2, 'b'), 'ok')).toBeNull();
		expect(turns.acquire('kiosk-02', turn(3, 'c'))).toBe('granted');
	});

	it('warns on every fifth wrong PIN in a row for a device, counted across owners', () => {
		const warn = vi.fn<(line: string) => void>();
		const turns = new StaffPinTurns({ warn });
		for (let i = 0; i < STAFF_PIN_ALERT_EVERY; i += 1) {
			const t = turn(i % 3, String(i));
			turns.acquire('kiosk-01', t);
			turns.release('kiosk-01', t, 'wrong');
		}
		expect(warn).toHaveBeenCalledOnce();
		expect(warn.mock.calls[0][0]).toContain(`consecutive=${STAFF_PIN_ALERT_EVERY}`);
	});
});
