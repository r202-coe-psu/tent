// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import PeopleTotalTooltip from './people-total-tooltip.svelte';

let component: ReturnType<typeof mount> | undefined;
let target: HTMLDivElement;

function render() {
	target = document.createElement('div');
	document.body.appendChild(target);
	component = mount(PeopleTotalTooltip, {
		target,
		props: { total: 290, evacuees: 282, staff: 6, volunteers: 2 }
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
	trigger.dispatchEvent(new PointerEvent('pointerleave', touch));
	trigger.click();
	flushSync();
}

const breakdown = () => document.body.querySelector('[data-slot="tooltip-content"]')?.textContent;

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

	it('opens the count of each group on tap, where a touch never hovers', async () => {
		const trigger = render();

		tap(trigger);
		await tick();

		await vi.waitFor(() => {
			const text = breakdown()?.replace(/\s+/g, '');
			expect(text).toContain('ผู้ประสบภัย282คน');
			expect(text).toContain('เจ้าหน้าที่6คน');
			expect(text).toContain('จิตอาสา2คน');
		});
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
});
