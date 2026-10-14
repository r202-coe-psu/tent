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
