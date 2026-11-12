// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import InternalBannerKeypad from './internal-banner-keypad.svelte';

let instance: ReturnType<typeof mount> | null = null;

function render(props: { error?: string | null } = {}) {
	const onsubmit = vi.fn<(code: string) => void>();
	instance = mount(InternalBannerKeypad, { target: document.body, props: { ...props, onsubmit } });
	flushSync();
	return onsubmit;
}

const button = (name: string) =>
	[...document.querySelectorAll<HTMLButtonElement>('button')].find(
		(b) => (b.getAttribute('aria-label') ?? b.textContent?.trim()) === name
	)!;
const digit = (d: string) => button(`ตัวเลข ${d}`);
const typed = () => document.querySelector('[aria-label="รหัสที่กรอก"]')!.textContent!.trim();

function press(key: string, target: EventTarget = window) {
	target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
	flushSync();
}
function click(el: HTMLElement) {
	el.click();
	flushSync();
}

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
});

describe('InternalBannerKeypad', () => {
	it('submits as soon as the sixth digit is clicked, and ignores a seventh', () => {
		const onsubmit = render();
		for (const d of '12345') click(digit(d));
		expect(onsubmit).not.toHaveBeenCalled();

		click(digit('6'));
		click(digit('7'));

		expect(onsubmit).toHaveBeenCalledTimes(1);
		expect(onsubmit).toHaveBeenCalledWith('123456');
		expect(typed()).toBe('123456');
	});

	it('ตกลง does nothing before six digits and resubmits the full code', () => {
		const onsubmit = render();
		for (const d of '123') click(digit(d));
		click(button('ตกลง'));
		expect(onsubmit).not.toHaveBeenCalled();
		expect(button('ตกลง').getAttribute('aria-disabled')).toBe('true');

		for (const d of '456') click(digit(d));
		click(button('ตกลง'));

		expect(onsubmit).toHaveBeenNthCalledWith(2, '123456');
	});

	it('ลบ and Backspace delete the last digit', () => {
		render();
		for (const d of '123') click(digit(d));
		click(button('ลบหนึ่งตัว'));
		expect(typed()).toBe('12');

		press('Backspace');
		expect(typed()).toBe('1');
	});

	it('types digits from the keyboard, but not while a modifier is held', () => {
		const onsubmit = render();
		press('9');
		window.dispatchEvent(new KeyboardEvent('keydown', { key: '8', ctrlKey: true }));
		flushSync();
		expect(typed()).toBe('9');

		for (const d of '87654') press(d);
		expect(onsubmit).toHaveBeenCalledWith('987654');
	});

	it('ignores keys typed into a text field', () => {
		render();
		const input = document.createElement('input');
		document.body.append(input);
		press('5', input);
		expect(typed()).toBe('');
	});

	it('arrow keys move focus within the 3x4 grid and stop at its edges', () => {
		render();
		digit('1').focus();

		press('ArrowLeft');
		expect(document.activeElement).toBe(digit('1'));
		press('ArrowUp');
		expect(document.activeElement).toBe(digit('1'));

		press('ArrowRight');
		press('ArrowRight');
		expect(document.activeElement).toBe(digit('3'));
		press('ArrowRight'); // no wrap onto the next row
		expect(document.activeElement).toBe(digit('3'));

		for (let i = 0; i < 3; i++) press('ArrowDown');
		expect(document.activeElement).toBe(button('ตกลง'));
		press('ArrowLeft');
		expect(document.activeElement).toBe(digit('0'));
	});

	it('the first arrow press brings focus back to "1" when nothing is focused', () => {
		render();
		(document.activeElement as HTMLElement | null)?.blur();

		press('ArrowDown');

		expect(document.activeElement).toBe(digit('1'));
	});

	it('shows the error as an alert', () => {
		render({ error: 'รหัสไม่ถูกต้องหรือถูกเปลี่ยนแล้ว' });
		expect(document.querySelector('[role="alert"]')?.textContent).toContain(
			'รหัสไม่ถูกต้องหรือถูกเปลี่ยนแล้ว'
		);
	});
});
