// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import RejectReasonFields from './reject-reason-fields.svelte';
import { REJECT_NOTE_MAX, rejectNoteTemplate } from '../domain/reject-reason';

let instance: ReturnType<typeof mount> | null = null;

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
});

describe('RejectReasonFields (#1166)', () => {
	it('offers the five selectable reasons and not the legacy combined one', () => {
		instance = mount(RejectReasonFields, { target: document.body, props: { idPrefix: 't' } });
		flushSync();

		expect(document.body.querySelectorAll('[role="radio"]')).toHaveLength(5);
		const text = document.body.textContent ?? '';
		expect(text).toContain('เกินความต้องการ');
		expect(text).toContain('ไม่ตรงเกณฑ์การรับ');
		expect(text).not.toContain('ไม่ตรงเกณฑ์การรับ / เกินความต้องการ');
	});

	// The radio group needs a real click to change the reason.
	const pickReason = (code: string) => {
		(document.querySelector(`[id="t-code-${code}"]`) as HTMLElement).click();
		flushSync();
	};
	const noteBox = () => document.querySelector('textarea') as HTMLTextAreaElement;
	const type = (value: string) => {
		noteBox().value = value;
		noteBox().dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
	};
	const mountFields = (props: Record<string, unknown> = {}) => {
		instance = mount(RejectReasonFields, {
			target: document.body,
			props: { idPrefix: 't', ...props }
		});
		flushSync();
	};

	it('fills the formal message the moment a reason is picked, and previews it (#1256)', () => {
		mountFields();
		expect(noteBox().value).toBe('');

		pickReason('over_need');

		expect(noteBox().value).toBe(rejectNoteTemplate('over_need'));
		expect(document.querySelector('[data-testid="t-preview"]')?.textContent).toContain(
			`เกินความต้องการ — ${rejectNoteTemplate('over_need')}`
		);
	});

	it('has no tone or preset buttons any more (#1256)', () => {
		mountFields();
		pickReason('over_need');
		expect(document.querySelectorAll('[data-testid^="t-template-"]')).toHaveLength(0);
		expect(document.body.textContent).not.toContain('อบอุ่น');
		expect(document.body.textContent).not.toContain('กระชับ');
	});

	it('swaps the message for the new reason instead of leaving the old one’s text (#1256 B1)', () => {
		mountFields();
		pickReason('over_need');
		pickReason('expired');

		expect(noteBox().value).toBe(rejectNoteTemplate('expired'));
		const preview = document.querySelector('[data-testid="t-preview"]')?.textContent ?? '';
		expect(preview).toContain('หมดอายุ');
		expect(preview).not.toContain('เพียงพอแล้ว');
	});

	it('clears the message for "other", so the note is required again (#1256 B1)', () => {
		mountFields();
		pickReason('over_need');
		pickReason('other');

		expect(noteBox().value).toBe('');
		expect(noteBox().required).toBe(true);
	});

	it('keeps what staff typed around the message when the reason changes (#1256)', () => {
		mountFields();
		pickReason('over_need');
		type(`นมหมดอายุ ${rejectNoteTemplate('over_need')}`);
		pickReason('not_eligible');

		expect(noteBox().value).toBe(`นมหมดอายุ ${rejectNoteTemplate('not_eligible')}`);
	});

	it('leaves a note staff rewrote from scratch alone when the reason changes (#1256)', () => {
		mountFields();
		pickReason('over_need');
		type('ขออภัยครับ ศูนย์มีของพอแล้ว ลองส่งต่อศูนย์อื่นนะครับ');
		pickReason('not_eligible');

		expect(noteBox().value).toBe('ขออภัยครับ ศูนย์มีของพอแล้ว ลองส่งต่อศูนย์อื่นนะครับ');
	});

	it('keeps an auto-filled message staff edited when the reason changes — it is theirs now (#1256)', () => {
		mountFields();
		pickReason('over_need');
		const edited = `${rejectNoteTemplate('over_need')} ขอบคุณที่ตั้งใจนะครับ`.replace(
			'ศูนย์',
			'ที่นี่'
		);
		expect(edited).not.toBe(`${rejectNoteTemplate('over_need')} ขอบคุณที่ตั้งใจนะครับ`);
		type(edited);
		pickReason('expired');

		expect(noteBox().value).toBe(edited);
	});

	it('does not stack a second message on a note already written when it mounts (#1256)', () => {
		const written = 'ขออภัยครับ ศูนย์มีของพอแล้ว ลองส่งต่อศูนย์อื่นนะครับ';
		mountFields({ note: written });
		pickReason('expired');

		expect(noteBox().value).toBe(written);
	});

	it('still swaps an untouched message that was already there when it mounts (#1256)', () => {
		mountFields({ note: rejectNoteTemplate('over_need') });
		pickReason('expired');

		expect(noteBox().value).toBe(rejectNoteTemplate('expired'));
	});

	it('swaps the message for the new reason after staff typed their own words first (#1256)', () => {
		mountFields();
		type('นมหมดอายุ 2 กล่อง');
		pickReason('over_need');
		expect(noteBox().value).toBe(`นมหมดอายุ 2 กล่อง ${rejectNoteTemplate('over_need')}`);
		pickReason('not_eligible');

		expect(noteBox().value).toBe(`นมหมดอายุ 2 กล่อง ${rejectNoteTemplate('not_eligible')}`);
		const template = rejectNoteTemplate('not_eligible') as string;
		expect(noteBox().value.split(template)).toHaveLength(2);
	});

	it('puts the message after words staff typed before picking a reason (#1256)', () => {
		mountFields();
		type('นมหมดอายุ 2 กล่อง');
		pickReason('expired');

		expect(noteBox().value).toBe(`นมหมดอายุ 2 กล่อง ${rejectNoteTemplate('expired')}`);
	});

	it('leaves long staff text alone instead of cutting a sentence (#1256)', () => {
		const long = 'ก'.repeat(REJECT_NOTE_MAX - 10);
		mountFields();
		type(long);
		pickReason('over_need');

		expect(noteBox().value).toBe(long);
	});
});
