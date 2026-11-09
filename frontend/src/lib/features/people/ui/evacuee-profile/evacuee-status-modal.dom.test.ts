// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { toast } from 'svelte-sonner';
import { langState } from '$lib/states/i18n.svelte';
import type { Evacuee } from '../../domain/people';
import EvacueeStatusModal from './evacuee-status-modal.svelte';

vi.mock('svelte-sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const evacuee = {
	_id: 'evacuee:test-123',
	current_stay: { status: 'active', zone: null, since: '2026-09-02T10:00:00.000Z' }
} as Evacuee;

const statusConfig = {
	active: { label: 'Staying', colorClass: '', dotClass: '' },
	temporary_leave: { label: 'Temporary leave', colorClass: '', dotClass: '' },
	checked_out: { label: 'Checked out', colorClass: '', dotClass: '' }
};

let instance: ReturnType<typeof mount> | null = null;

async function settle() {
	flushSync();
	await tick();
	flushSync();
}

async function submitWithoutReason(status: 'temporary_leave' | 'checked_out') {
	instance = mount(EvacueeStatusModal, {
		target: document.body,
		props: { show: true, evacuee, statusConfig, onClose: () => {}, onUpdateStatus: async () => {} }
	});
	await settle();
	const radio = [...document.body.querySelectorAll<HTMLElement>('[role="radio"]')].find((el) =>
		el.textContent?.includes(statusConfig[status].label)
	);
	radio?.click();
	await settle();
	const confirm = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
		(el) => el.textContent?.trim() === (langState.current === 'en' ? 'Confirm' : 'ยืนยัน')
	);
	confirm?.click();
	await settle();
}

afterEach(async () => {
	if (instance) unmount(instance);
	instance = null;
	// bits-ui body-scroll-lock cleans up on a 24ms timer; let it run before the env tears down
	await new Promise((resolve) => setTimeout(resolve, 50));
	document.body.innerHTML = '';
	langState.current = 'th';
	vi.clearAllMocks();
});

describe('EvacueeStatusModal toasts', () => {
	it('explains in English that a temporary leave needs a reason when the staff language is EN', async () => {
		langState.current = 'en';
		await submitWithoutReason('temporary_leave');
		expect(toast.error).toHaveBeenCalledWith('A reason is required for a temporary leave');
	});

	it('explains in English that checkout needs a reason or note when the staff language is EN', async () => {
		langState.current = 'en';
		await submitWithoutReason('checked_out');
		expect(toast.error).toHaveBeenCalledWith('A reason or note is required to check out');
	});

	it('keeps the Thai toast when the staff language is TH', async () => {
		langState.current = 'th';
		await submitWithoutReason('temporary_leave');
		expect(toast.error).toHaveBeenCalledWith('การออกชั่วคราวต้องระบุเหตุผล');
	});
});
