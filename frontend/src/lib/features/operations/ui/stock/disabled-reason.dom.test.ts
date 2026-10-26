// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRawSnippet, flushSync, mount, unmount } from 'svelte';
import DisabledReason from './disabled-reason.svelte';

const REASON = 'ต้องมีสิทธิ์เจ้าหน้าที่คลัง (warehouse_staff) จึงจะเบิกจ่ายได้';

let component: ReturnType<typeof mount> | undefined;
let parent: HTMLDivElement;

const children = createRawSnippet(() => ({
	render: () => '<button type="button" disabled>เบิกจ่าย</button>'
}));

function render(reason?: string) {
	parent = document.createElement('div');
	document.body.appendChild(parent);
	const onParentClick = vi.fn();
	parent.addEventListener('click', onParentClick);
	const target = document.createElement('div');
	parent.appendChild(target);
	component = mount(DisabledReason, { target, props: { reason, children } });
	flushSync();
	return { onParentClick };
}

afterEach(() => {
	if (component) unmount(component);
	component = undefined;
	parent?.remove();
});

describe('DisabledReason', () => {
	it('renders only the control when there is no reason', () => {
		render();

		expect(parent.querySelector('[aria-disabled="true"]')).toBeNull();
		expect(parent.querySelector('.sr-only')).toBeNull();
		expect(parent.querySelector('button')?.textContent).toBe('เบิกจ่าย');
	});

	it('wraps the control in a focusable group described by the reason', () => {
		render(REASON);

		const wrapper = parent.querySelector<HTMLElement>('[aria-disabled="true"]');
		expect(wrapper?.getAttribute('role')).toBe('group');
		expect(wrapper?.tabIndex).toBe(0);
		expect(wrapper?.querySelector('button')).not.toBeNull();
		const describedBy = wrapper?.getAttribute('aria-describedby');
		expect(document.getElementById(describedBy!)?.textContent).toBe(REASON);
	});

	it('stops a click from reaching what is underneath', () => {
		const { onParentClick } = render(REASON);

		parent
			.querySelector<HTMLElement>('[aria-disabled="true"]')!
			.dispatchEvent(new MouseEvent('click', { bubbles: true }));

		expect(onParentClick).not.toHaveBeenCalled();
	});
});
