// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { REOPEN_LOAN_ACTION, REOPEN_LOAN_RESUME_ACTION } from '../model/bulk-return-pool-v3';
import BulkReturnEntryReopenAction from './BulkReturnEntryReopenAction.svelte';

let instance: ReturnType<typeof mount> | null = null;

function render(props: {
	showButton: boolean;
	resume?: boolean;
	blockedNotice: string | null;
	onReopen: () => void;
}) {
	instance = mount(BulkReturnEntryReopenAction, { target: document.body, props });
	flushSync();
}

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
});

describe('BulkReturnEntryReopenAction', () => {
	it('shows the reopen button and calls onReopen on click', () => {
		const onReopen = vi.fn();
		render({ showButton: true, blockedNotice: null, onReopen });

		const button = document.body.querySelector('button') as HTMLButtonElement;
		expect(button.textContent).toContain(REOPEN_LOAN_ACTION);
		expect(document.body.querySelector('[data-testid="bulk-return-reopen-blocked"]')).toBeNull();
		button.click();
		flushSync();

		expect(onReopen).toHaveBeenCalledTimes(1);
	});

	it('labels the button as a resume when a reopen already exists', () => {
		render({ showButton: true, resume: true, blockedNotice: null, onReopen: vi.fn() });

		const button = document.body.querySelector('button') as HTMLButtonElement;
		expect(button.textContent).toContain(REOPEN_LOAN_RESUME_ACTION);
		expect(button.textContent).not.toContain(REOPEN_LOAN_ACTION);
	});

	it('shows the blocked notice and no button when the reopen is withheld', () => {
		render({
			showButton: false,
			blockedNotice: 'เปิดยอดยืมกลับไม่ได้ ยอดยืมถูกปิดเป็นสูญหายแล้ว',
			onReopen: vi.fn()
		});

		expect(document.body.querySelector('button')).toBeNull();
		expect(
			document.body.querySelector('[data-testid="bulk-return-reopen-blocked"]')?.textContent?.trim()
		).toBe('เปิดยอดยืมกลับไม่ได้ ยอดยืมถูกปิดเป็นสูญหายแล้ว');
	});

	it('renders nothing when there is neither a button nor a notice', () => {
		render({ showButton: false, blockedNotice: null, onReopen: vi.fn() });

		expect(document.body.querySelector('button')).toBeNull();
		expect(document.body.querySelector('[data-testid="bulk-return-reopen-blocked"]')).toBeNull();
		expect(document.body.textContent?.trim()).toBe('');
	});
});
