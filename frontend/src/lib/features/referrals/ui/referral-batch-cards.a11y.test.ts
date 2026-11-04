import { describe, it, expect, vi } from 'vitest';
import { render } from 'svelte/server';
import type { Referral } from '../domain/referral.schema';

vi.mock('@tanstack/svelte-query', () => ({
	useQueryClient: () => ({})
}));

vi.mock('svelte-sonner', () => ({
	toast: { promise: vi.fn(), error: vi.fn(), success: vi.fn() }
}));

const { useEvacuees } = vi.hoisted(() => ({ useEvacuees: vi.fn(() => ({ data: [] })) }));
vi.mock('$lib/features/people', () => ({ useEvacuees, zoneLabel: (zone: string) => zone }));

vi.mock('$lib/db/shelter', () => ({
	getShelterCode: () => 'SH001',
	getShelterDb: () => 'shelter_sh001'
}));

vi.mock('../application/queries', () => ({
	useBulkTransition: () => ({
		mutation: { isPending: false },
		progress: { phase: 'idle', total: 0, succeeded: 0, failed: [], fraction: 0, reset: vi.fn() },
		run: vi.fn(),
		retryFailed: vi.fn()
	})
}));

import ReferralBatchCards from './referral-batch-cards.svelte';

function makeReferral(id: string): Referral {
	return {
		_id: id,
		referral_type: 'medical-emergency',
		status: 'draft',
		urgency: 'normal',
		evacuee_id: `evacuee:${id}`,
		shelter_code: 'SH001',
		reason: 'ต้องการการรักษา',
		created_at: '2026-10-14T08:00:00.000Z',
		created_by: 'sm_user',
		to_org: { name: 'โรงพยาบาลทดสอบ', kind: 'hospital', contact: '053-000000' }
	} as Referral;
}

/** Opening tags of the body rows (the header row is excluded by its class). */
function bodyRowTags(html: string): string[] {
	return [...html.matchAll(/<tr\b[^>]*>/g)]
		.map((m) => m[0])
		.filter((tag) => tag.includes('data-slot="table-row"') && !tag.includes('bg-muted/40'));
}

describe('referral-batch-cards keyboard access (F-29, F-33)', () => {
	const referrals = [makeReferral('referral:1'), makeReferral('referral:2')];

	it('makes each selectable row reachable with the keyboard', () => {
		const { body } = render(ReferralBatchCards, {
			props: { referrals, onSelectReferral: () => {} }
		});
		const rows = bodyRowTags(body);
		expect(rows).toHaveLength(2);
		for (const tag of rows) {
			expect(tag).toContain('tabindex="0"');
		}
	});

	it('shows a visible focus ring on selectable rows (F-33)', () => {
		const { body } = render(ReferralBatchCards, {
			props: { referrals, onSelectReferral: () => {} }
		});
		for (const tag of bodyRowTags(body)) {
			expect(tag).toContain('focus-visible:ring-2');
		}
	});

	it('leaves rows out of the tab order when they are not selectable', () => {
		const { body } = render(ReferralBatchCards, { props: { referrals } });
		for (const tag of bodyRowTags(body)) {
			expect(tag).not.toContain('tabindex');
		}
	});
});

describe('referral-batch-cards names come from evacuee_summary (F-04, F-06)', () => {
	it('never loads the evacuee roster and resolves names per member', () => {
		const named = {
			...makeReferral('referral:1'),
			evacuee_summary: { first_name: 'สมชาย', last_name: 'ใจดี' }
		} as Referral;
		const mononym = {
			...makeReferral('referral:2'),
			evacuee_summary: { first_name: 'มะลิ', last_name: '' }
		} as Referral;
		const legacy = makeReferral('referral:3');
		const { body } = render(ReferralBatchCards, { props: { referrals: [named, mononym, legacy] } });
		expect(useEvacuees).not.toHaveBeenCalled();
		expect(body).toContain('สมชาย ใจดี');
		expect(body).toContain('มะลิ');
		expect(body).not.toMatch(/มะลิ +[^\s<]/);
		expect(body).toContain('ไม่พบชื่อผู้เข้าพัก');
	});
});

describe('referral-batch-cards selection (#563)', () => {
	const closed = { ...makeReferral('referral:closed'), status: 'closed' } as Referral;
	const draft = makeReferral('referral:draft');
	const accepted = { ...makeReferral('referral:acc'), status: 'accepted' } as Referral;
	const checkboxes = (html: string) => html.match(/<button[^>]*role="checkbox"[^>]*>/g) ?? [];

	it('gives rows with an action a checkbox, and rows without one none', () => {
		const { body } = render(ReferralBatchCards, {
			props: { referrals: [draft, accepted, closed], mode: 'view' }
		});
		// select-all + draft + accepted; the closed member has none
		const boxes = checkboxes(body);
		expect(boxes).toHaveLength(3);
		expect(boxes.join('')).toContain('aria-label="เลือก ไม่พบชื่อผู้เข้าพัก"');
		expect(body).toContain('เลือกทั้งหมด');
		expect(body).toContain('(1 · ฉบับร่าง)');
	});

	it('shows no checkbox, select-all or action bar in the post-create result view', () => {
		const { body } = render(ReferralBatchCards, {
			props: { referrals: [draft, accepted], mode: 'created' }
		});
		expect(checkboxes(body)).toHaveLength(0);
		expect(body).not.toContain('เลือกทั้งหมด');
	});

	it('renders no sticky action bar until something is selected', () => {
		const { body } = render(ReferralBatchCards, { props: { referrals: [draft], mode: 'view' } });
		expect(body).not.toContain('sticky bottom-0');
		expect(body).not.toContain('ล้างการเลือก');
	});
});
