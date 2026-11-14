import { describe, expect, it, vi, type Mock } from 'vitest';
import { KioskRequestError, type KioskEvacueeSummary } from '../data/kiosk-check-in.api';
import type { KioskCheckOutResult } from '../data/kiosk-check-out.api';
import {
	SELF_CHECKOUT_RETURN_SECONDS,
	SelfCheckoutSession,
	type SelfCheckoutDeps
} from './self-checkout-session.svelte';

function member(id: string, status: string, isPrimary = false): KioskEvacueeSummary {
	return {
		evacuee_id: id,
		first_name: `ชื่อ${id}`,
		last_name: 'ส****',
		gender: null,
		age: null,
		status,
		is_primary: isPrimary,
		selectable: false
	};
}

const MEMBERS = [
	member('EV1', 'active', true),
	member('EV2', 'room_confirmed'),
	member('EV3', 'arriving'),
	member('EV4', 'temporary_leave')
];

const CARD = { source: 'smart-card', citizen_id: '1234567890123' } as const;
const THAID = { source: 'thaid', session_id: 'thaid-session-1' } as const;

const ALL_DONE: KioskCheckOutResult = {
	shelter_code: 'SH001',
	members: [
		{ evacuee_id: 'EV1', status: 'checked_out' },
		{ evacuee_id: 'EV2', status: 'checked_out' }
	]
};

function setup(gate: typeof CARD | typeof THAID = CARD) {
	const checkOut: Mock<SelfCheckoutDeps['checkOut']> = vi
		.fn<SelfCheckoutDeps['checkOut']>()
		.mockResolvedValue(ALL_DONE);
	const session = new SelfCheckoutSession(
		{ gate, primaryEvacueeId: 'EV1', members: MEMBERS },
		{ checkOut }
	);
	return { session, checkOut };
}

function toConfirm(
	session: SelfCheckoutSession,
	destination: 'returned_home' | 'other' = 'returned_home'
) {
	session.start();
	session.next();
	session.chooseDestination(destination);
}

describe('SelfCheckoutSession steps', () => {
	it('opens on the question, then lists the members with only the card holder ticked', () => {
		const { session } = setup();
		expect(session.step).toBe('ask');

		session.start();

		expect(session.step).toBe('members');
		expect(session.selectedIds).toEqual(['EV1']);
	});

	it('only lets members who can check out be ticked, and needs one ticked to go on', () => {
		const { session } = setup();
		session.start();

		session.toggleMember('EV3');
		session.toggleMember('EV4');
		expect(session.selectedIds).toEqual(['EV1']);

		session.toggleMember('EV1');
		expect(session.selectedIds).toEqual([]);
		expect(session.canContinue).toBe(false);
		session.next();
		expect(session.step).toBe('members');

		session.toggleMember('EV2');
		expect(session.selectedIds).toEqual(['EV2']);
		expect(session.canContinue).toBe(true);
		session.next();
		expect(session.step).toBe('destination');
	});

	it('walks back one step at a time: confirm, destination, members, question', () => {
		const { session } = setup();
		toConfirm(session);
		expect(session.step).toBe('confirm');

		session.back();
		expect(session.step).toBe('destination');
		session.back();
		expect(session.step).toBe('members');
		session.back();
		expect(session.step).toBe('ask');
	});

	it('moves to the confirm step on picking a destination without sending anything', () => {
		const { session, checkOut } = setup();
		session.start();
		session.next();

		session.chooseDestination('other');

		expect(session.step).toBe('confirm');
		expect(session.destination).toBe('other');
		expect(checkOut).not.toHaveBeenCalled();
	});
});

describe('SelfCheckoutSession confirm', () => {
	it('sends the ticked members with the destination and the card gate, then shows the results', async () => {
		const { session, checkOut } = setup();
		session.start();
		session.toggleMember('EV2');
		session.next();
		session.chooseDestination('returned_home');

		await session.confirm();

		expect(checkOut).toHaveBeenCalledExactlyOnceWith({
			primary_evacuee_id: 'EV1',
			evacuee_ids: ['EV1', 'EV2'],
			destination_type: 'returned_home',
			gate: CARD
		});
		expect(session.step).toBe('done');
		expect(session.results).toEqual(ALL_DONE.members);
	});

	it('sends the ThaiD session as the gate for a ThaiD visitor', async () => {
		const { session, checkOut } = setup(THAID);
		toConfirm(session, 'other');

		await session.confirm();

		expect(checkOut.mock.calls[0][0].gate).toEqual(THAID);
		expect(checkOut.mock.calls[0][0].destination_type).toBe('other');
	});

	it('is busy while the request is in flight and ignores a second confirm', async () => {
		const { session, checkOut } = setup();
		let release: (result: KioskCheckOutResult) => void = () => {};
		checkOut.mockReturnValue(new Promise((resolve) => (release = resolve)));
		toConfirm(session);

		const first = session.confirm();
		expect(session.step).toBe('submitting');
		expect(session.busy).toBe(true);
		await session.confirm();
		release(ALL_DONE);
		await first;

		expect(checkOut).toHaveBeenCalledTimes(1);
		expect(session.busy).toBe(false);
	});

	it('keeps members the server did not check out in the results for the done screen', async () => {
		const { session, checkOut } = setup();
		checkOut.mockResolvedValue({
			shelter_code: 'SH001',
			members: [
				{ evacuee_id: 'EV1', status: 'checked_out' },
				{ evacuee_id: 'EV2', status: 'not_eligible', stay_status: 'checked_out' }
			]
		});
		toConfirm(session);

		await session.confirm();

		expect(session.step).toBe('done');
		expect(session.results.map((result) => result.status)).toEqual(['checked_out', 'not_eligible']);
	});

	it('returns to confirm with the server message when the request fails, and can retry', async () => {
		const { session, checkOut } = setup();
		checkOut.mockRejectedValueOnce(
			new KioskRequestError('บันทึกการเช็คเอาต์ไม่สำเร็จ', 500, 'KIOSK_CHECK_OUT_FAILED')
		);
		toConfirm(session);

		await session.confirm();

		expect(session.step).toBe('confirm');
		expect(session.error).toEqual({ message: 'บันทึกการเช็คเอาต์ไม่สำเร็จ', terminal: false });

		await session.confirm();

		expect(session.step).toBe('done');
		expect(session.error).toBeNull();
	});

	it('has no message for an error that is not a server answer, so the screen words it', async () => {
		const { session, checkOut } = setup();
		checkOut.mockRejectedValueOnce(new TypeError('fetch failed'));
		toConfirm(session);

		await session.confirm();

		expect(session.step).toBe('confirm');
		expect(session.error).toEqual({ message: null, terminal: false });
	});

	it.each([
		'KIOSK_CHECK_OUT_IDENTITY_MISMATCH',
		'KIOSK_THAID_SESSION_INVALID',
		'KIOSK_METHOD_DISABLED'
	])('marks %s terminal: retrying the same request cannot work', async (code) => {
		const { session, checkOut } = setup();
		checkOut.mockRejectedValueOnce(new KioskRequestError('ไม่ผ่าน', 409, code));
		toConfirm(session);

		await session.confirm();

		expect(session.error).toEqual({ message: 'ไม่ผ่าน', terminal: true });
	});

	it('clears the error on going back', async () => {
		const { session, checkOut } = setup();
		checkOut.mockRejectedValueOnce(new KioskRequestError('x', 500, 'KIOSK_CHECK_OUT_FAILED'));
		toConfirm(session);
		await session.confirm();

		session.back();

		expect(session.step).toBe('destination');
		expect(session.error).toBeNull();
	});
});

describe('SelfCheckoutSession return countdown', () => {
	it('counts down once done and reports when it reaches zero', async () => {
		const { session } = setup();
		toConfirm(session);
		await session.confirm();
		expect(session.secondsLeft).toBe(SELF_CHECKOUT_RETURN_SECONDS);

		for (let i = 0; i < SELF_CHECKOUT_RETURN_SECONDS - 1; i++) session.tick();
		expect(session.secondsLeft).toBe(1);
		expect(session.expired).toBe(false);

		session.tick();
		expect(session.secondsLeft).toBe(0);
		expect(session.expired).toBe(true);
		session.tick();
		expect(session.secondsLeft).toBe(0);
	});
});
