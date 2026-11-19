import { describe, expect, it } from 'vitest';
import { assertCheckoutDestination } from '$lib/features/people/domain/people';
import {
	initialCheckoutSelection,
	isSelfCheckoutEligible,
	kioskCheckoutDestination,
	kioskCheckoutReason,
	selfCheckoutUnavailableReason,
	shouldOfferSelfCheckout
} from './self-checkout';

const holder = (status: string) => [
	{ evacuee_id: 'evacuee:P', is_primary: true, status },
	{ evacuee_id: 'evacuee:M', is_primary: false, status: 'active' }
];

describe('shouldOfferSelfCheckout', () => {
	it.each([
		['smart-card', 'active', true],
		['smart-card', 'room_confirmed', true],
		['thaid', 'active', true],
		['thaid', 'room_confirmed', true],
		['smart-card', 'arriving', false],
		['smart-card', 'temporary_leave', false],
		['smart-card', 'pre_registered', false],
		['smart-card', 'checked_out', false],
		['thaid', 'arriving', false],
		['qr', 'active', false],
		['qr', 'room_confirmed', false],
		['phone', 'active', false],
		['phone', 'room_confirmed', false]
	] as const)('source %s with a %s holder -> %s', (source, status, expected) => {
		expect(shouldOfferSelfCheckout(source, holder(status))).toBe(expected);
	});

	it('does not offer when nobody is the card holder, even if others are active', () => {
		expect(
			shouldOfferSelfCheckout('smart-card', [
				{ is_primary: false, status: 'active' },
				{ is_primary: false, status: 'room_confirmed' }
			])
		).toBe(false);
	});

	it('is decided by the holder, not by an eligible non-holder member', () => {
		expect(
			shouldOfferSelfCheckout('smart-card', [
				{ is_primary: true, status: 'arriving' },
				{ is_primary: false, status: 'active' }
			])
		).toBe(false);
	});
});

describe('isSelfCheckoutEligible', () => {
	it.each(['active', 'room_confirmed'])('accepts %s', (status) => {
		expect(isSelfCheckoutEligible(status)).toBe(true);
	});
	it.each(['arriving', 'temporary_leave', 'pre_registered', 'checked_out', '', null, undefined])(
		'rejects %s',
		(status) => {
			expect(isSelfCheckoutEligible(status)).toBe(false);
		}
	);
});

describe('selfCheckoutUnavailableReason', () => {
	it('is null for a member who can check out', () => {
		expect(selfCheckoutUnavailableReason('active', 'th')).toBeNull();
		expect(selfCheckoutUnavailableReason('room_confirmed', 'en')).toBeNull();
	});

	it.each([
		['arriving', 'ยังไม่ผ่านจุดจัดโซน — ติดต่อเจ้าหน้าที่', 'Not zoned yet — please contact staff'],
		[
			'temporary_leave',
			'ออกนอกศูนย์ชั่วคราว — ติดต่อเจ้าหน้าที่',
			'Temporarily away — please contact staff'
		],
		['pre_registered', 'ยังไม่ได้รายงานตัว', 'Not checked in yet'],
		['checked_out', 'ติดต่อเจ้าหน้าที่', 'Please contact staff'],
		['whatever', 'ติดต่อเจ้าหน้าที่', 'Please contact staff']
	])('explains %s in Thai and English', (status, th, en) => {
		expect(selfCheckoutUnavailableReason(status, 'th')).toBe(th);
		expect(selfCheckoutUnavailableReason(status, 'en')).toBe(en);
	});
});

describe('initialCheckoutSelection', () => {
	it('ticks only the card holder', () => {
		expect(initialCheckoutSelection(holder('active'))).toEqual(['evacuee:P']);
	});

	it('ticks nobody when the holder cannot check out', () => {
		expect(initialCheckoutSelection(holder('arriving'))).toEqual([]);
	});
});

describe('kioskCheckoutReason', () => {
	it('names the kiosk in the movement reason', () => {
		expect(kioskCheckoutReason('kiosk-3')).toBe('เช็คเอาต์ด้วยตนเองที่ตู้ kiosk (kiosk-3)');
	});
});

describe('kioskCheckoutDestination', () => {
	it('maps returned_home to the household destination', () => {
		expect(kioskCheckoutDestination('returned_home')).toEqual({ type: 'returned_home' });
	});

	it('maps other to a destination carrying the required notes', () => {
		expect(kioskCheckoutDestination('other')).toEqual({
			type: 'other',
			notes: 'เช็คเอาต์ที่ตู้ kiosk'
		});
	});

	it.each(['returned_home', 'other'] as const)('%s passes R-29-8', (type) => {
		expect(() => assertCheckoutDestination(kioskCheckoutDestination(type))).not.toThrow();
	});
});
