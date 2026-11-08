// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { PrinterSummary } from '../domain/print-device.schema';
import PrinterPicker from './printer-picker.svelte';

const printer = (id: string): PrinterSummary => ({
	id,
	name: `เครื่อง-${id}`,
	station: null,
	online: true,
	queue_state: 'ready',
	last_seen_at: null
});

const printers = [printer('a'), printer('b'), printer('c')];

let component: ReturnType<typeof mount> | undefined;

function render(selectedId: string | null = null) {
	const onSelect = vi.fn();
	component = mount(PrinterPicker, {
		target: document.body,
		props: { printers, selectedId, onSelect }
	});
	flushSync();
	const radios = [...document.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
	return { onSelect, radios };
}

function press(target: HTMLElement, key: string) {
	target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
	flushSync();
}

afterEach(() => {
	if (component) unmount(component);
	component = undefined;
	document.body.innerHTML = '';
});

describe('PrinterPicker keyboard', () => {
	it('puts only the selected printer in the tab order', () => {
		const { radios } = render('b');

		expect(radios.map((radio) => radio.tabIndex)).toEqual([-1, 0, -1]);
	});

	it('puts the first printer in the tab order when none is selected', () => {
		const { radios } = render();

		expect(radios.map((radio) => radio.tabIndex)).toEqual([0, -1, -1]);
	});

	it('moves focus with the arrow keys, wrapping at both ends, without selecting', () => {
		const { radios, onSelect } = render('a');
		radios[0].focus();

		press(radios[0], 'ArrowDown');
		expect(document.activeElement).toBe(radios[1]);
		press(radios[1], 'ArrowRight');
		expect(document.activeElement).toBe(radios[2]);
		press(radios[2], 'ArrowDown');
		expect(document.activeElement).toBe(radios[0]);
		press(radios[0], 'ArrowUp');
		expect(document.activeElement).toBe(radios[2]);
		press(radios[2], 'ArrowLeft');
		expect(document.activeElement).toBe(radios[1]);

		expect(onSelect).not.toHaveBeenCalled();
	});

	it('jumps to the first and last printer with Home and End', () => {
		const { radios } = render('b');
		radios[1].focus();

		press(radios[1], 'End');
		expect(document.activeElement).toBe(radios[2]);
		press(radios[2], 'Home');
		expect(document.activeElement).toBe(radios[0]);
	});

	it('selects the focused printer on click (Enter / Space activate the button)', () => {
		const { radios, onSelect } = render('a');

		radios[2].click();

		expect(onSelect).toHaveBeenCalledWith('c');
	});
});
