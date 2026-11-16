// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import RejectReasonFields from './reject-reason-fields.svelte';
import { rejectNoteTemplate } from '../domain/reject-reason';

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

	it('offers the three tones only for a reason that has a message, none for "other" (#1256)', () => {
		instance = mount(RejectReasonFields, {
			target: document.body,
			props: { idPrefix: 't', code: 'over_need' }
		});
		flushSync();
		expect(document.querySelector('[data-testid="t-template-formal"]')?.textContent?.trim()).toBe(
			'ทางการ'
		);
		expect(document.querySelector('[data-testid="t-template-warm"]')?.textContent?.trim()).toBe(
			'อบอุ่น'
		);
		expect(document.querySelector('[data-testid="t-template-concise"]')?.textContent?.trim()).toBe(
			'กระชับ'
		);
		unmount(instance);
		document.body.innerHTML = '';

		for (const code of [undefined, 'other'] as const) {
			instance = mount(RejectReasonFields, {
				target: document.body,
				props: { idPrefix: 't', code }
			});
			flushSync();
			expect(document.querySelectorAll('[data-testid^="t-template-"]'), String(code)).toHaveLength(
				0
			);
			unmount(instance);
			document.body.innerHTML = '';
		}
		instance = null;
	});

	it('fills the whole message for the reason and shows it in the donor preview (#1256)', () => {
		instance = mount(RejectReasonFields, {
			target: document.body,
			props: { idPrefix: 't', code: 'over_need' }
		});
		flushSync();
		(document.querySelector('[data-testid="t-template-warm"]') as HTMLButtonElement).click();
		flushSync();

		const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
		expect(textarea.value).toBe(rejectNoteTemplate('over_need', 'warm'));
		expect(document.querySelector('[data-testid="t-preview"]')?.textContent).toContain(
			`เกินความต้องการ — ${rejectNoteTemplate('over_need', 'warm')}`
		);
	});

	it('swaps to another tone instead of stacking, and keeps what staff typed (#1256)', () => {
		instance = mount(RejectReasonFields, {
			target: document.body,
			props: { idPrefix: 't', code: 'over_need' }
		});
		flushSync();
		const click = (tone: string) => {
			(document.querySelector(`[data-testid="t-template-${tone}"]`) as HTMLButtonElement).click();
			flushSync();
		};
		const textarea = () => document.querySelector('textarea') as HTMLTextAreaElement;

		click('formal');
		click('concise');
		expect(textarea().value).toBe(rejectNoteTemplate('over_need', 'concise'));

		textarea().value = 'ของซ้ำ';
		textarea().dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		click('warm');
		expect(textarea().value).toBe(`ของซ้ำ ${rejectNoteTemplate('over_need', 'warm')}`);
	});

	it('disables a tone that would overflow the detail limit (#1256)', () => {
		instance = mount(RejectReasonFields, {
			target: document.body,
			props: { idPrefix: 't', code: 'over_need', note: 'ก'.repeat(390) }
		});
		flushSync();
		const chip = document.querySelector('[data-testid="t-template-concise"]') as HTMLButtonElement;
		expect(chip.disabled).toBe(true);
	});

	// Review round 3, B1 — the radio group needs a real click to change the reason.
	const pickReason = (code: string) => {
		(document.querySelector(`[id="t-code-${code}"]`) as HTMLElement).click();
		flushSync();
	};
	const noteBox = () => document.querySelector('textarea') as HTMLTextAreaElement;
	const click = (tone: string) => {
		(document.querySelector(`[data-testid="t-template-${tone}"]`) as HTMLButtonElement).click();
		flushSync();
	};

	it('swaps the message for the new reason instead of leaving the old reason’s text (#1256 B1)', () => {
		instance = mount(RejectReasonFields, {
			target: document.body,
			props: { idPrefix: 't', code: 'over_need' }
		});
		flushSync();
		click('formal');
		pickReason('expired');

		expect(noteBox().value).toBe(rejectNoteTemplate('expired', 'formal'));
		const preview = document.querySelector('[data-testid="t-preview"]')?.textContent ?? '';
		expect(preview).toContain('หมดอายุ');
		expect(preview).not.toContain('เพียงพอแล้ว');
	});

	it('clears a template when the reason becomes "other", so the note is required again (#1256 B1)', () => {
		instance = mount(RejectReasonFields, {
			target: document.body,
			props: { idPrefix: 't', code: 'over_need' }
		});
		flushSync();
		click('warm');
		pickReason('other');

		expect(noteBox().value).toBe('');
		expect(noteBox().required).toBe(true);
	});

	it('keeps staff words around the template when the reason changes (#1256 B1)', () => {
		instance = mount(RejectReasonFields, {
			target: document.body,
			props: { idPrefix: 't', code: 'over_need', note: 'นมหมดอายุ' }
		});
		flushSync();
		click('concise');
		pickReason('not_eligible');

		expect(noteBox().value).toBe(`นมหมดอายุ ${rejectNoteTemplate('not_eligible', 'concise')}`);
	});

	it('does not stack a second message when staff typed first and then switches tone (#1256 W1)', () => {
		instance = mount(RejectReasonFields, {
			target: document.body,
			props: { idPrefix: 't', code: 'over_need', note: 'นมหมดอายุ' }
		});
		flushSync();
		click('formal');
		click('warm');

		expect(noteBox().value).toBe(`นมหมดอายุ ${rejectNoteTemplate('over_need', 'warm')}`);
	});

	it('names each tone button for screen readers and explains a disabled one (#1256 S2, S3)', () => {
		instance = mount(RejectReasonFields, {
			target: document.body,
			props: { idPrefix: 't', code: 'over_need', note: 'ก'.repeat(390) }
		});
		flushSync();
		const chip = document.querySelector('[data-testid="t-template-formal"]') as HTMLButtonElement;
		expect(chip.getAttribute('aria-label')).toBe('ใส่ข้อความแบบทางการ');
		expect(chip.disabled).toBe(true);
		const hintId = chip.getAttribute('aria-describedby');
		expect(hintId).toBeTruthy();
		expect(document.getElementById(hintId!)?.textContent).toContain('400');
	});
});
