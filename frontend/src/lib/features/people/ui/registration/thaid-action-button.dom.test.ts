// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import ThaidActionButton from './thaid-action-button.svelte';

let instance: ReturnType<typeof mount> | null = null;

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
});

const connectButton = () =>
	[...document.querySelectorAll('button')].find((b) => b.textContent?.includes('เชื่อมต่อ ThaiD'))!;

describe('ThaidActionButton', () => {
	it('hands the click to onConnect and stays on the page (onsite QR flow)', () => {
		const onConnect = vi.fn();
		const before = window.location.href;
		instance = mount(ThaidActionButton, { target: document.body, props: { onConnect } });
		flushSync();

		connectButton().click();
		flushSync();

		expect(onConnect).toHaveBeenCalledOnce();
		expect(window.location.href).toBe(before);
		expect(connectButton().disabled).toBe(false);
	});
});
