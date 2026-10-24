// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import RowActions from './row-actions.svelte';
import { DISTRIBUTE_FORBIDDEN_HINT as HINT, OFFLINE_HINT } from './hints';

let component: ReturnType<typeof mount> | undefined;
let row: HTMLDivElement;

/**
 * Mounts the actions inside a clickable "row", as `stock-row.svelte` does. The row listener sits
 * on a parent of the mount target: Svelte delegates `onclick` to the target itself.
 */
function render(props: {
	distributeDisabled?: boolean;
	disabled?: boolean;
	disabledReason?: string;
}) {
	row = document.createElement('div');
	document.body.appendChild(row);
	const onRowClick = vi.fn();
	row.addEventListener('click', onRowClick);
	const target = document.createElement('div');
	row.appendChild(target);
	const ondistribute = vi.fn();
	const onreceive = vi.fn();
	component = mount(RowActions, {
		target,
		props: { itemName: 'ผ้าห่มกันหนาว', ondistribute, onreceive, ...props }
	});
	flushSync();
	return { onRowClick, ondistribute, onreceive };
}

afterEach(() => {
	if (component) unmount(component);
	component = undefined;
	row?.remove();
});

describe('RowActions — distribute disabled without warehouse_staff (#572)', () => {
	it('wraps the disabled button in a focusable control that names the reason', () => {
		render({ distributeDisabled: true });

		const button = row.querySelector<HTMLButtonElement>('button[aria-label="เบิก ผ้าห่มกันหนาว"]');
		expect(button?.disabled).toBe(true);
		// The reason no longer rides on `title`, which a pointer-events-none button never shows.
		expect(button?.hasAttribute('title')).toBe(false);

		const wrapper = button?.closest<HTMLElement>('[aria-disabled="true"]');
		expect(wrapper).not.toBeNull();
		// `group`, not `button`: the real button inside keeps the only button role (one match by name).
		expect(wrapper?.getAttribute('role')).toBe('group');
		expect(wrapper?.tabIndex).toBe(0);

		const describedBy = wrapper?.getAttribute('aria-describedby');
		expect(describedBy).toBeTruthy();
		expect(document.getElementById(describedBy!)?.textContent).toBe(HINT);
	});

	it('does not let a click on the disabled button open the row', () => {
		const { onRowClick, ondistribute } = render({ distributeDisabled: true });

		// In a browser the click lands on the wrapper: the disabled button has pointer-events: none.
		const wrapper = row.querySelector<HTMLElement>('[aria-disabled="true"]');
		expect(wrapper).not.toBeNull();
		wrapper!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

		expect(onRowClick).not.toHaveBeenCalled();
		expect(ondistribute).not.toHaveBeenCalled();
	});

	it('leaves an allowed distribute button unwrapped and working', () => {
		const { onRowClick, ondistribute } = render({ distributeDisabled: false });

		expect(row.querySelector('[aria-disabled="true"]')).toBeNull();
		const button = row.querySelector<HTMLButtonElement>('button[aria-label="เบิก ผ้าห่มกันหนาว"]');
		expect(button?.disabled).toBe(false);

		button?.click();

		expect(ondistribute).toHaveBeenCalledOnce();
		expect(onRowClick).not.toHaveBeenCalled();
	});
});

describe('RowActions — offline row', () => {
	it('names the offline reason on both buttons and keeps clicks off the row', () => {
		const { onRowClick, onreceive, ondistribute } = render({
			disabled: true,
			disabledReason: OFFLINE_HINT
		});

		const wrappers = [...row.querySelectorAll<HTMLElement>('[aria-disabled="true"]')];
		expect(wrappers).toHaveLength(2);
		for (const wrapper of wrappers) {
			const describedBy = wrapper.getAttribute('aria-describedby');
			expect(document.getElementById(describedBy!)?.textContent).toBe(OFFLINE_HINT);
			wrapper.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		}

		expect(onRowClick).not.toHaveBeenCalled();
		expect(onreceive).not.toHaveBeenCalled();
		expect(ondistribute).not.toHaveBeenCalled();
	});

	it('keeps the warehouse reason on a read-only row with no offline reason', () => {
		render({ disabled: true, distributeDisabled: true });

		const wrappers = row.querySelectorAll<HTMLElement>('[aria-disabled="true"]');
		expect(wrappers).toHaveLength(1);
		const describedBy = wrappers[0].getAttribute('aria-describedby');
		expect(document.getElementById(describedBy!)?.textContent).toBe(HINT);
	});
});
