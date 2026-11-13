// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import RejectReasonFields from './reject-reason-fields.svelte';

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

	it('offers presets only for the picked reason, none for "other" (#1256)', async () => {
		instance = mount(RejectReasonFields, {
			target: document.body,
			props: { idPrefix: 't', code: 'over_need' }
		});
		flushSync();
		expect(document.querySelector('[data-testid="t-preset-thanks"]')).not.toBeNull();
		expect(document.querySelector('[data-testid="t-preset-forward"]')).not.toBeNull();
		expect(document.querySelector('[data-testid="t-preset-safety"]')).toBeNull();
		unmount(instance);
		document.body.innerHTML = '';

		instance = mount(RejectReasonFields, {
			target: document.body,
			props: { idPrefix: 't', code: 'other' }
		});
		flushSync();
		expect(document.querySelectorAll('[data-testid^="t-preset-"]')).toHaveLength(0);
	});

	it('appends a preset to what staff typed and shows it in the donor preview (#1256)', () => {
		instance = mount(RejectReasonFields, {
			target: document.body,
			props: { idPrefix: 't', code: 'over_need', note: 'ของซ้ำ' }
		});
		flushSync();
		(document.querySelector('[data-testid="t-preset-thanks"]') as HTMLButtonElement).click();
		flushSync();

		const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
		expect(textarea.value.startsWith('ของซ้ำ ')).toBe(true);
		expect(textarea.value).toContain('ขอบคุณ');
		expect(document.querySelector('[data-testid="t-preview"]')?.textContent).toContain(
			'เกินความต้องการ — ของซ้ำ '
		);
	});

	it('disables a preset that would overflow the detail limit (#1256)', () => {
		instance = mount(RejectReasonFields, {
			target: document.body,
			props: { idPrefix: 't', code: 'over_need', note: 'ก'.repeat(390) }
		});
		flushSync();
		const chip = document.querySelector('[data-testid="t-preset-thanks"]') as HTMLButtonElement;
		expect(chip.disabled).toBe(true);
	});
});
