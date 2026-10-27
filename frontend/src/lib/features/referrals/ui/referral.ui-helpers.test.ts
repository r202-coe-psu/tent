import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/db/shelter', () => ({
	getShelterCode: () => 'SH001'
}));

import {
	getEvacueeSelectionError,
	resolveEvacueeName,
	formatEvacueeFullName,
	EVACUEE_NAME_FALLBACK,
	getClosedSubLabel,
	buildReferralListHref,
	parseReferralListParams,
	referralBatchPath,
	referralDetailPath
} from './referral.ui-helpers';

describe('getEvacueeSelectionError', () => {
	it('returns the Thai required-selection message when no evacuee is selected', () => {
		expect(getEvacueeSelectionError([])).toBe('กรุณาเลือกผู้เข้าพักอย่างน้อย 1 คน');
	});

	it('returns undefined when at least one evacuee is selected', () => {
		expect(getEvacueeSelectionError(['evacuee:01A'])).toBeUndefined();
		expect(getEvacueeSelectionError(['evacuee:01A', 'evacuee:01B'])).toBeUndefined();
	});
});

describe('resolveEvacueeName', () => {
	const roster = { first_name: 'สมชาย', last_name: 'ใจดี' };
	const summary = { first_name: 'สมหญิง', last_name: 'รักดี' };

	it('prefers the roster name over the summary', () => {
		expect(resolveEvacueeName(roster, summary)).toBe('สมชาย ใจดี');
	});

	it('falls back to the summary when the roster has no match', () => {
		expect(resolveEvacueeName(undefined, summary)).toBe('สมหญิง รักดี');
		expect(resolveEvacueeName(null, summary)).toBe('สมหญิง รักดี');
	});

	it('returns the shared fallback text when no source has a name', () => {
		expect(resolveEvacueeName()).toBe(EVACUEE_NAME_FALLBACK);
		expect(resolveEvacueeName(undefined, undefined)).toBe('ไม่พบชื่อผู้เข้าพัก');
	});
});

describe('formatEvacueeFullName', () => {
	it('joins first and last name with one space', () => {
		expect(formatEvacueeFullName({ first_name: 'สมชาย', last_name: 'ใจดี' })).toBe('สมชาย ใจดี');
	});

	it('omits an empty, blank or missing last name (mononym) without a trailing space', () => {
		expect(formatEvacueeFullName({ first_name: 'ทดสอบ', last_name: '' })).toBe('ทดสอบ');
		expect(formatEvacueeFullName({ first_name: 'ทดสอบ', last_name: '  ' })).toBe('ทดสอบ');
		expect(formatEvacueeFullName({ first_name: 'ทดสอบ' })).toBe('ทดสอบ');
		expect(resolveEvacueeName({ first_name: 'ทดสอบ', last_name: '' })).toBe('ทดสอบ');
	});
});

describe('getClosedSubLabel (CR-167 derived labels)', () => {
	const stamp = { at: '2026-10-14T08:00:00.000Z', by: 'sm' };

	it('labels a closed referral that was sent and never answered as withdrawn', () => {
		const r = { status: 'closed', timeline: { sent: stamp, closed: stamp } } as const;
		expect(getClosedSubLabel(r)).toBe('ถอนคำขอ');
	});

	it('shows the destination the withdrawn-by-source wording', () => {
		const r = { status: 'closed', timeline: { sent: stamp, closed: stamp } } as const;
		expect(getClosedSubLabel(r, 'destination')).toBe('ถูกถอนโดยศูนย์ต้นทาง');
	});

	it('labels a closed referral that was never sent as a cancelled draft', () => {
		const r = { status: 'closed', timeline: { closed: stamp } } as const;
		expect(getClosedSubLabel(r)).toBe('ยกเลิกร่าง');
	});

	it('has no sub-label for a closed referral the destination responded to', () => {
		const r = {
			status: 'closed',
			timeline: { sent: stamp, responded: stamp, closed: stamp }
		} as const;
		expect(getClosedSubLabel(r)).toBeNull();
	});

	it('has no sub-label for a referral that is not closed', () => {
		expect(getClosedSubLabel({ status: 'sent', timeline: { sent: stamp } })).toBeNull();
	});
});

describe('referral route paths', () => {
	it('encodes ids that contain a colon and round-trips through decodeURIComponent', () => {
		const id = 'referral:01ABC';
		expect(referralDetailPath(id)).toBe('/back-office/referrals/referral%3A01ABC');
		expect(referralBatchPath(id)).toBe('/back-office/referrals/referral%3A01ABC/batch');
		expect(decodeURIComponent(referralDetailPath(id).split('/').pop()!)).toBe(id);
	});
});

describe('list URL params', () => {
	it('defaults to outgoing / all / empty', () => {
		expect(parseReferralListParams(new URLSearchParams())).toEqual({
			direction: 'outgoing',
			status: 'all',
			q: ''
		});
	});

	it('reads dir, status and q, ignoring unknown status values', () => {
		expect(parseReferralListParams(new URLSearchParams('dir=in&status=sent&q=สม'))).toEqual({
			direction: 'incoming',
			status: 'sent',
			q: 'สม'
		});
		expect(parseReferralListParams(new URLSearchParams('status=bogus&dir=x')).status).toBe('all');
	});

	it('builds a clean URL, omitting defaults', () => {
		expect(buildReferralListHref({})).toBe('/back-office/referrals');
		expect(buildReferralListHref({ direction: 'outgoing', status: 'all', q: '  ' })).toBe(
			'/back-office/referrals'
		);
		expect(buildReferralListHref({ direction: 'incoming', status: 'sent', q: 'a b' })).toBe(
			'/back-office/referrals?dir=in&status=sent&q=a+b'
		);
	});
});
