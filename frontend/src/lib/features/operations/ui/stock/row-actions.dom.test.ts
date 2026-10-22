// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import RowActions from './row-actions.svelte';

const HINT = 'ต้องมีสิทธิ์เจ้าหน้าที่คลัง (warehouse_staff) จึงจะเบิกจ่ายได้';

let component: ReturnType<typeof mount> | undefined;
let row: HTMLDivElement;

/**
 * Mounts the actions inside a clickable "row", as `stock-row.svelte` does. The row listener sits
 * on a parent of the mount target: Svelte delegates `onclick` to the target itself.
 */
function render(props: { distributeDisabled?: boolean; disabled?: boolean }) {
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
		expect(wrapper?.getAttribute('role')).toBe('button');
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
