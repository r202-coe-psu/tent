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
});
