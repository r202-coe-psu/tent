// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';

// The camera is not under test: reads arrive through the typed fallback.
vi.mock('./camera-code-scanner.svelte', () => ({ default: () => {} }));

import CameraCodeScannerDialog from './camera-code-scanner-dialog.svelte';

let instance: ReturnType<typeof mount> | null = null;

function render(props: {
	error?: string | null;
	errorAction?: { label: string; onclick: () => void; disabled?: boolean };
	onScan?: (code: string) => Promise<unknown>;
}) {
	const onScan = props.onScan ?? vi.fn(async () => {});
	instance = mount(CameraCodeScannerDialog, {
		target: document.body,
		props: { open: true, busy: false, error: props.error, errorAction: props.errorAction, onScan }
	});
	flushSync();
	return onScan;
}

async function typeAndSubmit(code: string) {
	const input = document.getElementById('camera-code-manual') as HTMLInputElement;
	input.value = code;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
	const form = input.closest('form')!;
	form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
	await vi.waitFor(() => flushSync());
	await tick();
	await new Promise((resolve) => setTimeout(resolve, 20));
	flushSync();
}

const dialogOpen = () => document.querySelector('[role="dialog"]') !== null;
const alertText = () => document.querySelector('[role="alert"]')?.textContent?.trim();

afterEach(async () => {
	if (instance) await unmount(instance);
	instance = null;
	// bits-ui releases its body scroll lock on a timer after unmount; let it fire while `document`
	// still exists, or it throws `document is not defined` after happy-dom is torn down.
	await new Promise((resolve) => setTimeout(resolve, 50));
	document.body.innerHTML = '';
});

describe('CameraCodeScannerDialog error', () => {
	it('closes once the read settles when there is no error', async () => {
		const onScan = render({ error: null });
		expect(dialogOpen()).toBe(true);

		await typeAndSubmit('evacuee:ABC@123456');

		expect(onScan).toHaveBeenCalledWith('evacuee:ABC@123456');
		expect(dialogOpen()).toBe(false);
	});

	it('stays open and shows the message when the read was refused', async () => {
		const onScan = render({ error: 'QR นี้ออกวันที่ 8 พ.ย. มีใบใหม่' });

		await typeAndSubmit('evacuee:ABC@123456');

		expect(onScan).toHaveBeenCalledTimes(1);
		expect(dialogOpen()).toBe(true);
		expect(alertText()).toBe('QR นี้ออกวันที่ 8 พ.ย. มีใบใหม่');
	});

	it('shows no alert while there is no error', () => {
		render({ error: null });

		expect(alertText()).toBeUndefined();
	});
});

describe('CameraCodeScannerDialog errorAction', () => {
	const actionButton = () =>
		[...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((b) =>
			b.textContent?.includes('ยอมรับความเสี่ยง')
		);

	it('shows the action beside the error and runs it on click', () => {
		const onclick = vi.fn();
		render({ error: 'QR หมดอายุ', errorAction: { label: 'ยอมรับความเสี่ยง', onclick } });

		actionButton()!.click();

		expect(onclick).toHaveBeenCalledTimes(1);
	});

	it('disables the action while the caller marks it disabled', () => {
		render({
			error: 'QR หมดอายุ',
			errorAction: { label: 'ยอมรับความเสี่ยง', onclick: vi.fn(), disabled: true }
		});

		expect(actionButton()!.disabled).toBe(true);
	});

	it('hides the action when there is no error', () => {
		render({ error: null, errorAction: { label: 'ยอมรับความเสี่ยง', onclick: vi.fn() } });

		expect(actionButton()).toBeUndefined();
	});
});
