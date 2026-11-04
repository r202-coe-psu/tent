// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { mount, unmount } from 'svelte';
import PasswordRuleChecklist from './password-rule-checklist.svelte';

let instance: ReturnType<typeof mount> | null = null;

afterEach(async () => {
	if (instance) await unmount(instance);
	instance = null;
	document.body.innerHTML = '';
});

const items = () => [...document.body.querySelectorAll('li')];

describe('PasswordRuleChecklist (#1045)', () => {
	it('shows every unmet rule in red', () => {
		instance = mount(PasswordRuleChecklist, { target: document.body, props: { password: '' } });
		expect(items()).toHaveLength(5);
		expect(items().every((li) => li.className.includes('text-destructive'))).toBe(true);
	});

	it('turns a met rule green and leaves the rest red', () => {
		instance = mount(PasswordRuleChecklist, {
			target: document.body,
			props: { password: 'ABCDEFGHIJ' }
		});
		const green = items().filter((li) => li.className.includes('text-emerald-700'));
		expect(green.map((li) => li.textContent?.trim())).toEqual([
			'อย่างน้อย 10 ตัวอักษร (ผ่าน)',
			'ตัวพิมพ์ใหญ่ (A-Z) (ผ่าน)'
		]);
		expect(items().filter((li) => li.className.includes('text-destructive'))).toHaveLength(3);
	});

	it('is all green for a password that meets the policy', () => {
		instance = mount(PasswordRuleChecklist, {
			target: document.body,
			props: { password: 'Shelter-2569x' }
		});
		expect(items().every((li) => li.className.includes('text-emerald-700'))).toBe(true);
	});
});
