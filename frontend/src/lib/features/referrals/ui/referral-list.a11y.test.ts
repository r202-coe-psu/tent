import { describe, it, expect, vi } from 'vitest';
import { render } from 'svelte/server';
import type { Referral } from '../domain/referral.schema';

const { useEvacuees } = vi.hoisted(() => ({ useEvacuees: vi.fn(() => ({ data: [] })) }));
vi.mock('$lib/features/people', () => ({ useEvacuees }));

vi.mock('$lib/db/shelter', () => ({
	getShelterCode: () => 'SH001',
	getShelterDb: () => 'shelter_sh001'
}));

import ReferralList from './referral-list.svelte';

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

const TAB_LABELS = [
	'ทั้งหมด',
	'ฉบับร่าง (Draft)',
	'ส่งแล้ว (Sent)',
	'ตอบรับแล้ว (Accepted)',
	'ปฏิเสธ (Rejected)',
	'ปิดรายการ (Closed)'
];

/** Every complete `<button>…</button>` in the SSR markup (non-greedy, so nested ones are cut short). */
function buttonElements(html: string): string[] {
	return html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
}

function openTag(element: string): string {
	return element.slice(0, element.indexOf('>') + 1);
}

/** Deepest nesting of `<button>` tags. Greater than 1 means an interactive element sits inside another. */
function maxButtonDepth(html: string): number {
	let depth = 0;
	let max = 0;
	for (const m of html.matchAll(/<(\/?)button\b/g)) {
		depth = m[1] ? depth - 1 : depth + 1;
		max = Math.max(max, depth);
	}
	return max;
}

function tabElement(html: string, label: string): string {
	const found = buttonElements(html).find((b) => b.includes(label));
	if (!found) throw new Error(`tab not found: ${label}`);
	return found;
}

describe('referral-list accessibility', () => {
	const { body } = render(ReferralList, { props: { referrals: [draftReferral] } });

	it('does not nest a button inside the row button (F-28)', () => {
		expect(maxButtonDepth(body)).toBe(1);
	});

	it('exposes each status filter tab state with aria-pressed (F-30)', () => {
		for (const label of TAB_LABELS) {
			expect(openTag(tabElement(body, label))).toMatch(/aria-pressed="(true|false)"/);
		}
		expect(openTag(tabElement(body, 'ทั้งหมด'))).toContain('aria-pressed="true"');
		expect(openTag(tabElement(body, 'ฉบับร่าง (Draft)'))).toContain('aria-pressed="false"');
	});

	it('marks the active filter tab with an icon, not only color and underline (F-30)', () => {
		expect(tabElement(body, 'ทั้งหมด')).toMatch(/<svg\b/);
	});

	it('gives the search input an accessible name (F-31)', () => {
		const input = body.match(/<input\b[^>]*>/g)?.find((tag) => tag.includes('type="text"'));
		expect(input).toMatch(/aria-label="[^"]+"/);
	});

	it('shows a visible focus ring on filter tabs (F-33)', () => {
		for (const label of TAB_LABELS) {
			expect(openTag(tabElement(body, label))).toContain('focus-visible:ring-2');
		}
	});

	it('renders rows as links with a visible focus ring and no checkboxes (F-33)', () => {
		const links = body.match(/<a\b[^>]*href="\/back-office\/referrals\/[^"]*"[^>]*>/g) ?? [];
		// One link in the md+ table, one in the card list.
		expect(links).toHaveLength(2);
		for (const tag of links) expect(tag).toContain('focus-visible:ring-2');
		expect(body).not.toMatch(/type="checkbox"/);
	});

	it('links a single referral to its detail and a multi-member group to the batch page', () => {
		expect(body).toContain('href="/back-office/referrals/referral%3A1"');
		expect(body).not.toContain('/batch"');
		const member = (id: string, evacuee: string) =>
			({ ...draftReferral, _id: id, evacuee_id: evacuee }) as Referral;
		const { body: html } = render(ReferralList, {
			props: { referrals: [member('referral:m1', 'evacuee:1'), member('referral:m2', 'evacuee:2')] }
		});
		expect(html).toContain('ชุดส่งต่อ 2 คน');
		expect(html).toMatch(/href="\/back-office\/referrals\/referral%3Am[12]\/batch"/);
	});

	it('exposes the direction control as a tablist with aria-selected', () => {
		expect(body).toMatch(/role="tablist"/);
		expect(openTag(tabElement(body, 'ขาออก'))).toContain('aria-selected="true"');
		expect(openTag(tabElement(body, 'ขาเข้า'))).toContain('aria-selected="false"');
	});

	it('shows the load-more button and search scope hint only when more rows exist', () => {
		const more = render(ReferralList, { props: { referrals: [draftReferral], hasMore: true } });
		expect(more.body).toContain('โหลดเพิ่ม');
		expect(more.body).not.toContain('ไม่มีรายการเพิ่มเติม');
		expect(body).toContain('ไม่มีรายการเพิ่มเติม');
		expect(body).toContain('แสดง 1 รายการ');
		expect(body).not.toContain('จากทั้งหมด');
	});

	it('counts referrals, not collapsed batches, in the footer', () => {
		const member = (id: string, evacuee: string) =>
			({ ...draftReferral, _id: id, evacuee_id: evacuee }) as Referral;
		const single = {
			...draftReferral,
			_id: 'referral:solo',
			reason: 'อื่น',
			evacuee_id: 'evacuee:solo'
		} as Referral;
		const { body: html } = render(ReferralList, {
			props: {
				referrals: [
					member('referral:m1', 'evacuee:1'),
					member('referral:m2', 'evacuee:2'),
					member('referral:m3', 'evacuee:3'),
					single
				]
			}
		});
		expect(html).toContain('แสดง 4 รายการ');
	});

	it('shows a role=alert load-more error while keeping the button', () => {
		const { body: html } = render(ReferralList, {
			props: { referrals: [draftReferral], hasMore: true, isLoadMoreError: true }
		});
		expect(html).toMatch(/role="alert"[^>]*>[^<]*โหลดรายการเพิ่มไม่สำเร็จ/);
		expect(html).toContain('โหลดเพิ่ม');
		expect(body).not.toContain('โหลดรายการเพิ่มไม่สำเร็จ');
	});
});

describe('referral-list names come from evacuee_summary (F-04, F-06)', () => {
	it('never loads the evacuee roster', () => {
		render(ReferralList, { props: { referrals: [draftReferral] } });
		expect(useEvacuees).not.toHaveBeenCalled();
	});

	it('shows the summary name, the mononym without trailing space, and a fallback without summary', () => {
		const withSummary = {
			...draftReferral,
			_id: 'referral:a',
			evacuee_id: 'evacuee:a',
			evacuee_summary: { first_name: 'สมชาย', last_name: 'ใจดี' }
		} as Referral;
		const mononym = {
			...draftReferral,
			_id: 'referral:b',
			evacuee_id: 'evacuee:b',
			evacuee_summary: { first_name: 'มะลิ', last_name: '' }
		} as Referral;
		const legacy = { ...draftReferral, _id: 'referral:c', evacuee_id: 'evacuee:c' } as Referral;
		const html = (r: Referral) => render(ReferralList, { props: { referrals: [r] } }).body;
		expect(html(withSummary)).toContain('สมชาย ใจดี');
		expect(html(mononym)).toMatch(/มะลิ(?! )/);
		expect(html(legacy)).toContain('ไม่พบชื่อผู้เข้าพัก');
	});
});
