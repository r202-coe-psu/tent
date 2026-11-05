// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import PeopleTotalTooltip from './people-total-tooltip.svelte';

let component: ReturnType<typeof mount> | undefined;
let target: HTMLDivElement;

function render(props: Record<string, unknown> = {}) {
	target = document.createElement('div');
	document.body.appendChild(target);
	component = mount(PeopleTotalTooltip, {
		target,
		props: { total: 290, evacuees: 282, staff: 6, volunteers: 2, ...props }
	});
	flushSync();
	const trigger = target.querySelector('button');
	if (!trigger) throw new Error('trigger not rendered');
	return trigger;
}

function tap(trigger: HTMLButtonElement) {
	const touch = { bubbles: true, pointerType: 'touch' };
	trigger.dispatchEvent(new PointerEvent('pointerenter', touch));
	trigger.dispatchEvent(new PointerEvent('pointerdown', touch));
	trigger.dispatchEvent(new PointerEvent('pointerup', touch));
	trigger.focus();
	trigger.dispatchEvent(new PointerEvent('pointerleave', touch));
	trigger.click();
	flushSync();
}

function pressEnter(trigger: HTMLButtonElement) {
	trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
	trigger.click();
	flushSync();
}

const breakdown = () => document.body.querySelector('[data-slot="tooltip-content"]')?.textContent;
const squash = (text: string | undefined) => text?.replace(/\s+/g, '');

afterEach(() => {
	if (component) unmount(component);
	component = undefined;
	target?.remove();
});

describe('PeopleTotalTooltip', () => {
	it('shows only the total until it is opened', () => {
		const trigger = render();

		expect(trigger.textContent?.replace(/\s+/g, ' ').trim()).toBe('ทั้งหมด 290 คน');
		expect(document.body.textContent).not.toContain('ผู้ประสบภัย');
	});

	it('opens the count of each group on the first tap, where the tap also focuses', async () => {
		const trigger = render();

		tap(trigger);
		await tick();

		await vi.waitFor(() => {
			const text = squash(breakdown());
			expect(text).toContain('ผู้ประสบภัย282คน');
			expect(text).toContain('เจ้าหน้าที่6คน');
			expect(text).toContain('จิตอาสา2คน');
		});
		expect(trigger.dataset.state).not.toBe('closed');
	});

	it('closes on a second tap', async () => {
		const trigger = render();

		tap(trigger);
		await tick();
		await vi.waitFor(() => expect(trigger.dataset.state).not.toBe('closed'));

		tap(trigger);
		await tick();
		await vi.waitFor(() => expect(trigger.dataset.state).toBe('closed'));
	});

	it('still toggles from the keyboard', async () => {
		const trigger = render();

		trigger.focus();
		flushSync();
		await vi.waitFor(() => expect(trigger.dataset.state).not.toBe('closed'));

		pressEnter(trigger);
		await tick();
		await vi.waitFor(() => expect(trigger.dataset.state).toBe('closed'));

		pressEnter(trigger);
		await tick();
		await vi.waitFor(() => expect(trigger.dataset.state).not.toBe('closed'));
	});

	it('says the base is short instead of reporting zero when the counts failed to load', async () => {
		const trigger = render({ staff: 0, volunteers: 0, total: 282, failed: true });

		tap(trigger);
		await tick();

		await vi.waitFor(() => {
			const text = squash(breakdown());
			expect(text).toContain('ผู้ประสบภัย282คน');
			expect(text).toContain('เจ้าหน้าที่—');
			expect(text).toContain('จิตอาสา—');
			expect(text).toContain('ต่ำกว่าความเป็นจริง');
		});
		expect(squash(breakdown())).not.toContain('เจ้าหน้าที่0คน');
	});
});
