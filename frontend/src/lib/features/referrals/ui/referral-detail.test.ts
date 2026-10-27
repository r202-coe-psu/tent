import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import type { Referral } from '../domain/referral.schema';

const transition = vi.hoisted(() => ({
	isPending: false,
	mutateAsync: vi.fn<(vars: unknown) => Promise<unknown>>()
}));

vi.mock('@tanstack/svelte-query', () => ({
	useQueryClient: () => ({})
}));

vi.mock('svelte-sonner', () => ({
	toast: { promise: vi.fn(), error: vi.fn(), success: vi.fn() }
}));

vi.mock('$lib/db/shelter', () => ({
	getShelterCode: () => 'SH001',
	getShelterDb: () => 'shelter_sh001'
}));

vi.mock('../application/queries', () => ({
	useTransitionReferral: () => transition
}));

import ReferralDetail from './referral-detail.svelte';

const draftReferral = {
	_id: 'referral:1',
	referral_type: 'medical-emergency',
	status: 'draft',
	urgency: 'normal',
	evacuee_id: 'evacuee:01A',
	shelter_code: 'SH001',
	reason: 'ต้องการการรักษา',
	created_at: '2026-10-14T08:00:00.000Z',
	created_by: 'sm_user',
	to_org: { name: 'โรงพยาบาลทดสอบ', kind: 'hospital', contact: '053-000000' }
} as Referral;

/**
 * Server-renders the detail page and returns the opening tag of the first <button> whose
 * content includes `text`. Works on SSR markup only (no DOM), which is what svelte/server emits.
 */
function buttonOpenTag(html: string, text: string): string {
	const buttons = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
	const found = buttons.find((b) => b.includes(text));
	if (!found) throw new Error(`button not found: ${text}`);
	return found.slice(0, found.indexOf('>') + 1);
}

function isDisabled(openTag: string): boolean {
	return /\sdisabled(=""|\s|>|=)/.test(openTag);
}

beforeEach(() => {
	transition.isPending = false;
	transition.mutateAsync.mockReset();
});

describe('referral-detail transition actions', () => {
	it('keeps the transition buttons enabled when no transition is pending', () => {
		const { body } = render(ReferralDetail, { props: { referral: draftReferral } });

		expect(isDisabled(buttonOpenTag(body, 'ส่งออกข้อมูล'))).toBe(false);
		expect(isDisabled(buttonOpenTag(body, 'ยกเลิกร่าง'))).toBe(false);
	});

	it('disables the transition buttons while a transition is pending', () => {
		transition.isPending = true;
		const { body } = render(ReferralDetail, { props: { referral: draftReferral } });

		expect(isDisabled(buttonOpenTag(body, 'ส่งออกข้อมูล'))).toBe(true);
		expect(isDisabled(buttonOpenTag(body, 'ยกเลิกร่าง'))).toBe(true);
	});
});

describe('referral-detail close_reason', () => {
	const closed = {
		...draftReferral,
		status: 'closed',
		schema_v: 2,
		close_reason: 'ส่งผิดศูนย์',
		timeline: { closed: { at: '2026-10-14T09:00:00.000Z', by: 'sm_user' } }
	} as Referral;

	it('shows close_reason in the timeline of a closed referral', () => {
		const { body } = render(ReferralDetail, { props: { referral: closed } });
		expect(body).toContain('ส่งผิดศูนย์');
	});

	it('shows no reason line when a closed referral has no close_reason', () => {
		const { body } = render(ReferralDetail, {
			props: { referral: { ...closed, close_reason: undefined } as Referral }
		});
		expect(body).not.toContain('close-reason');
	});
});

describe('referral-detail withdraw (CR-167)', () => {
	const stamp = { at: '2026-10-14T08:00:00.000Z', by: 'sm_user' };
	const outgoingSent = {
		...draftReferral,
		referral_type: 'capacity',
		to_org: undefined,
		to_shelter_code: 'SH002',
		status: 'sent',
		timeline: { sent: stamp }
	} as Referral;
	const incomingSent = {
		...outgoingSent,
		shelter_code: 'SH009',
		to_shelter_code: 'SH001'
	} as Referral;

	it('offers a withdraw button (and no generic close) to the source of a sent referral', () => {
		const { body } = render(ReferralDetail, { props: { referral: outgoingSent } });

		expect(isDisabled(buttonOpenTag(body, 'ถอนคำขอ'))).toBe(false);
		expect(body).not.toContain('btn-close-referral');
	});

	it('offers no withdraw button to the destination of a sent referral', () => {
		const { body } = render(ReferralDetail, { props: { referral: incomingSent } });

		expect(body).not.toContain('btn-withdraw-referral');
		expect(buttonOpenTag(body, 'ตอบรับ')).toBeTruthy();
	});

	it('shows the withdrawn label to the source and no withdraw button once closed', () => {
		const closed = { ...outgoingSent, status: 'closed', timeline: { sent: stamp, closed: stamp } };
		const { body } = render(ReferralDetail, { props: { referral: closed as Referral } });

		expect(body).toContain('closed-sub-label');
		expect(body).toContain('ถอนคำขอ');
		expect(body).not.toContain('btn-withdraw-referral');
	});

	it('shows the destination the withdrawn-by-source label and no accept/reject buttons', () => {
		const closed = { ...incomingSent, status: 'closed', timeline: { sent: stamp, closed: stamp } };
		const { body } = render(ReferralDetail, { props: { referral: closed as Referral } });

		expect(body).toContain('ถูกถอนโดยศูนย์ต้นทาง');
		expect(body).not.toContain('ตอบรับการส่งต่อ');
		expect(body).not.toContain('ปฏิเสธรับการส่งต่อ');
	});
});
