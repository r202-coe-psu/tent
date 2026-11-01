import { describe, it, expect, vi } from 'vitest';
import { render } from 'svelte/server';
import ReferralConfirmDialog from './referral-confirm-dialog.svelte';

/** Opening tag of the first <button> whose content includes `text` (SSR markup only). */
function buttonOpenTag(html: string, text: string): string {
	const buttons = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
	const found = buttons.find((b) => b.includes(text));
	if (!found) throw new Error(`button not found: ${text}`);
	return found.slice(0, found.indexOf('>') + 1);
}

function isDisabled(openTag: string): boolean {
	return /\sdisabled(=""|\s|>|=)/.test(openTag);
}

const names = [
	'สมชาย ใจดี',
	'สมหญิง ใจงาม',
	'วิชัย มั่นคง',
	'ปรีชา เก่งกาจ',
	'มานี มีสุข',
	'ดารา ดาวเด่น'
];

function props(overrides: Record<string, unknown> = {}) {
	return {
		open: true,
		title: 'ยืนยันการปิดรายการ',
		names,
		count: names.length,
		confirmLabel: 'ปิดทั้งหมด (6)',
		destructive: true,
		pending: false,
		portalDisabled: true,
		onConfirm: vi.fn(),
		...overrides
	};
}

describe('referral-confirm-dialog markup', () => {
	it('renders the action title, item count, and the names capped at 5 with the remainder', () => {
		const { body } = render(ReferralConfirmDialog, { props: props() });

		expect(body).toContain('ยืนยันการปิดรายการ');
		expect(body).toContain('>6</span> รายการ');
		expect(body).toContain('สมชาย ใจดี, สมหญิง ใจงาม');
		expect(body).toContain('และอีก 1 คน');
		expect(body).not.toContain('ดารา ดาวเด่น');
	});

	it('renders the optional description line when given', () => {
		const { body } = render(ReferralConfirmDialog, {
			props: props({ description: 'เหตุผลนี้จะใช้กับ 6 รายการ' })
		});

		expect(body).toContain('เหตุผลนี้จะใช้กับ 6 รายการ');
	});

	it('enables the cancel and confirm buttons when nothing is pending', () => {
		const { body } = render(ReferralConfirmDialog, { props: props() });

		expect(isDisabled(buttonOpenTag(body, 'ยกเลิก'))).toBe(false);
		expect(isDisabled(buttonOpenTag(body, 'ปิดทั้งหมด'))).toBe(false);
	});

	it('disables confirm and cancel while pending so the action cannot be repeated', () => {
		const { body } = render(ReferralConfirmDialog, { props: props({ pending: true }) });

		expect(isDisabled(buttonOpenTag(body, 'ปิดทั้งหมด'))).toBe(true);
		expect(isDisabled(buttonOpenTag(body, 'ยกเลิก'))).toBe(true);
	});

	it('gives both dialog buttons a 44px minimum touch height', () => {
		const { body } = render(ReferralConfirmDialog, { props: props() });

		expect(buttonOpenTag(body, 'ยกเลิก')).toContain('min-h-11');
		expect(buttonOpenTag(body, 'ปิดทั้งหมด')).toContain('min-h-11');
	});

	it('omits the names line when there are no names', () => {
		const { body } = render(ReferralConfirmDialog, {
			props: props({ names: [], count: 0 })
		});

		expect(body).not.toContain('ผู้เข้าพัก:');
	});
});
