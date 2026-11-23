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
	pre_registered: { label: 'Pre-registered', colorClass: '', dotClass: '' },
	arriving: { label: 'Arriving', colorClass: '', dotClass: '' },
	room_confirmed: { label: 'Room confirmed', colorClass: '', dotClass: '' },
	active: { label: 'Staying', colorClass: '', dotClass: '' },
	temporary_leave: { label: 'Temporary leave', colorClass: '', dotClass: '' },
	checked_out: { label: 'Checked out', colorClass: '', dotClass: '' },
	kiosk_registered: { label: 'Kiosk registered', colorClass: '', dotClass: '' },
	transferred: { label: 'Transferred', colorClass: '', dotClass: '' },
	deceased: { label: 'Deceased', colorClass: '', dotClass: '' },
	cancelled: { label: 'Cancelled', colorClass: '', dotClass: '' }
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

	it('asks in English, inline, for a checkout reason when the staff language is EN (#1493)', async () => {
		langState.current = 'en';
		await submitWithoutReason('checked_out');
		expect(document.body.querySelector('[role="alert"]')?.textContent).toBe('Pick one reason');
		expect(toast.error).not.toHaveBeenCalled();
	});

	it('keeps the Thai toast when the staff language is TH', async () => {
		langState.current = 'th';
		await submitWithoutReason('temporary_leave');
		expect(toast.error).toHaveBeenCalledWith('การออกชั่วคราวต้องระบุเหตุผล');
	});
});

describe('EvacueeStatusModal checkout reason (#1493)', () => {
	it('saves the picked preset with its detail as the reason', async () => {
		const onUpdateStatus = vi.fn(async () => {});
		instance = mount(EvacueeStatusModal, {
			target: document.body,
			props: { show: true, evacuee, statusConfig, onClose: () => {}, onUpdateStatus }
		});
		await settle();
		const radios = () => [...document.body.querySelectorAll<HTMLElement>('[role="radio"]')];
		radios()
			.find((el) => el.textContent?.includes('Checked out'))
			?.click();
		await settle();
		document.body.querySelector<HTMLElement>('#evacuee-status-checkout-ส่งต่อสถานพยาบาล')?.click();
		await settle();
		const detail = document.body.querySelector<HTMLTextAreaElement>(
			'#evacuee-status-checkout-detail'
		)!;
		detail.value = 'รพ.หาดใหญ่';
		detail.dispatchEvent(new Event('input', { bubbles: true }));
		await settle();
		[...document.body.querySelectorAll<HTMLButtonElement>('button')]
			.find((el) => el.textContent?.trim() === 'ยืนยัน')
			?.click();
		await settle();
		expect(onUpdateStatus).toHaveBeenCalledWith('checked_out', 'ส่งต่อสถานพยาบาล — รพ.หาดใหญ่');
	});
});

describe('EvacueeStatusModal manual override (CR-262)', () => {
	const confirmed = {
		_id: 'evacuee:test-456',
		current_stay: { status: 'room_confirmed', zone: 'Z1', since: '2026-09-02T10:00:00.000Z' }
	} as Evacuee;

	const radioLabels = () =>
		[...document.body.querySelectorAll<HTMLElement>('[role="radio"]')].map((el) =>
			el.textContent?.trim()
		);

	async function open(props: {
		canRevert?: boolean;
		evacuee?: Evacuee;
		onUpdateStatus?: () => Promise<void>;
	}) {
		instance = mount(EvacueeStatusModal, {
			target: document.body,
			props: {
				show: true,
				evacuee: confirmed,
				statusConfig,
				onClose: () => {},
				onUpdateStatus: async () => {},
				...props
			}
		});
		await settle();
	}

	const pick = async (label: string) => {
		[...document.body.querySelectorAll<HTMLElement>('[role="radio"]')]
			.find((el) => el.textContent?.includes(label))
			?.click();
		await settle();
	};

	const confirmButton = () =>
		[...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
			(el) => el.textContent?.trim() === 'ยืนยัน'
		);

	it('hides backward statuses when the viewer cannot revert (registration_staff)', async () => {
		await open({ canRevert: false });
		const labels = radioLabels();
		expect(labels).not.toContain('Pre-registered');
		expect(labels).not.toContain('Arriving');
		expect(labels).not.toContain('Staying');
		expect(labels).toContain('Room confirmed');
	});

	it('offers backward statuses to a shelter manager / system admin', async () => {
		await open({ canRevert: true });
		const labels = radioLabels();
		expect(labels).toContain('Pre-registered');
		expect(labels).toContain('Arriving');
		expect(labels).toContain('Staying');
	});

	it('requires a reason before reverting', async () => {
		const onUpdateStatus = vi.fn(async () => {});
		await open({ canRevert: true, onUpdateStatus });
		await pick('Staying');
		expect(document.body.querySelector('#evacuee-status-reason')).not.toBeNull();
		confirmButton()?.click();
		await settle();
		expect(toast.error).toHaveBeenCalledWith('การเปลี่ยนสถานะด้วยตนเองต้องระบุเหตุผล');
		expect(onUpdateStatus).not.toHaveBeenCalled();
	});

	it('passes the trimmed reason with the target status', async () => {
		const onUpdateStatus = vi.fn(async () => {});
		await open({ canRevert: true, onUpdateStatus });
		await pick('Arriving');
		const textarea = document.body.querySelector<HTMLTextAreaElement>('#evacuee-status-reason')!;
		textarea.value = '  เช็คอินผิดคน  ';
		textarea.dispatchEvent(new Event('input', { bubbles: true }));
		await settle();
		confirmButton()?.click();
		await settle();
		expect(onUpdateStatus).toHaveBeenCalledWith('arriving', 'เช็คอินผิดคน');
	});

	const stayOf = (status: Evacuee['current_stay']['status']) =>
		({
			_id: 'evacuee:test-789',
			current_stay: { status, zone: null, since: '2026-09-02T10:00:00.000Z' }
		}) as Evacuee;

	it('lets a shelter manager / system admin go from arriving back to pre-registered', async () => {
		await open({ canRevert: true, evacuee: stayOf('arriving') });
		expect(radioLabels()).toContain('Pre-registered');
	});

	it('does not offer registration_staff the intake statuses from arriving', async () => {
		await open({ canRevert: false, evacuee: stayOf('arriving') });
		expect(radioLabels()).not.toContain('Pre-registered');
		expect(radioLabels()).toContain('Staying');
	});

	it.each([
		'arriving',
		'active',
		'checked_out',
		'temporary_leave',
		'transferred',
		'deceased',
		'cancelled'
	] as const)(
		'offers a shelter manager / system admin every stay status from %s',
		async (status) => {
			await open({ canRevert: true, evacuee: stayOf(status) });
			const labels = radioLabels();
			for (const cfg of Object.values(statusConfig)) expect(labels).toContain(cfg.label);
		}
	);

	it('does not offer registration_staff anything from a terminal status', async () => {
		await open({ canRevert: false, evacuee: stayOf('deceased') });
		expect(radioLabels()).toEqual([]);
	});

	it('requires a reason for an override out of a terminal status', async () => {
		const onUpdateStatus = vi.fn(async () => {});
		await open({ canRevert: true, evacuee: stayOf('deceased'), onUpdateStatus });
		await pick('Arriving');
		confirmButton()?.click();
		await settle();
		expect(toast.error).toHaveBeenCalledWith('การเปลี่ยนสถานะด้วยตนเองต้องระบุเหตุผล');
		expect(onUpdateStatus).not.toHaveBeenCalled();
	});
});
