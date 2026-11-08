// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import ReceivedByTypeTooltip from './received-by-type-tooltip.svelte';

let component: ReturnType<typeof mount> | undefined;
let target: HTMLDivElement;

function render(props: Record<string, unknown> = {}) {
	target = document.createElement('div');
	document.body.appendChild(target);
	component = mount(ReceivedByTypeTooltip, {
		target,
		props: { received: 7, breakdown: { evacuees: 4, staff: 2, volunteers: 1 }, ...props }
	});
	flushSync();
	return target.querySelector('button');
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

const content = () =>
	document.body.querySelector('[data-slot="tooltip-content"]')?.textContent?.replace(/\s+/g, '');

afterEach(() => {
	if (component) unmount(component);
	component = undefined;
	target?.remove();
});

describe('ReceivedByTypeTooltip', () => {
	it('shows only the total until it is opened', () => {
		const trigger = render();

		expect(trigger?.textContent?.replace(/\s+/g, ' ').trim()).toBe('7 คน');
		expect(document.body.textContent).not.toContain('เจ้าหน้าที่');
	});

	it('opens the count of each kind of person on tap', async () => {
		const trigger = render();
		if (!trigger) throw new Error('trigger not rendered');

		tap(trigger);
		await tick();

		await vi.waitFor(() => {
			expect(content()).toContain('ผู้พักพิง4คน');
			expect(content()).toContain('เจ้าหน้าที่2คน');
			expect(content()).toContain('จิตอาสา1คน');
		});
	});

	it('is plain text, with no tooltip to open, when nobody received it yet', () => {
		const trigger = render({ received: 0, breakdown: { evacuees: 0, staff: 0, volunteers: 0 } });

		expect(trigger).toBeNull();
		expect(target.textContent?.replace(/\s+/g, ' ').trim()).toBe('0 คน');
	});
});
