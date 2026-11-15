// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { ComponentProps } from 'svelte';
import { goto } from '$app/navigation';
import KioskPreRegisteredCheckIn from './kiosk-pre-registered-check-in.svelte';
import {
	checkInSelectedMembers,
	KioskRequestError,
	lookupPreRegisteredEvacuee,
	type KioskLookupResponse
} from '../data/kiosk-check-in.api';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('../data/kiosk-check-in.api', async (importOriginal) => ({
	...(await importOriginal<typeof import('../data/kiosk-check-in.api')>()),
	lookupPreRegisteredEvacuee: vi.fn(),
	checkInSelectedMembers: vi.fn()
}));
vi.mock('../application/kiosk-label-print', () => ({
	prepareKioskQrImage: vi.fn().mockResolvedValue({ src: 'data:image/png;base64,AA==', sizeMm: 30 }),
	printKioskQrLabels: vi.fn().mockResolvedValue({ kind: 'printed', printed: 1 })
}));

const CLOSED_QUERY = '?shelter_code=SH001';

const household: KioskLookupResponse = {
	kind: 'household',
	name_masked: true,
	shelter_code: 'SH001',
	primary_evacuee_id: 'p1',
	members: [
		{
			evacuee_id: 'p1',
			first_name: 'Somchai',
			last_name: 'J***',
			gender: null,
			age: 35,
			status: 'pre_registered',
			is_primary: true,
			selectable: true
		}
	]
};

const closed = () => new KioskRequestError('ตู้ปิดให้บริการ', 403, 'KIOSK_CLOSED');

let instance: ReturnType<typeof mount> | null = null;

function mountCheckIn(props: Partial<ComponentProps<typeof KioskPreRegisteredCheckIn>> = {}) {
	instance = mount(KioskPreRegisteredCheckIn, {
		target: document.body,
		props: {
			input: { source: 'qr', token: 'tok' },
			contextQuery: CLOSED_QUERY,
			displayShelterCode: 'SH001',
			onreset: () => {},
			...props
		}
	} as never);
	flushSync();
}

beforeEach(() => {
	vi.clearAllMocks();
});
afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
});

describe('KioskPreRegisteredCheckIn when an admin closes the kiosk', () => {
	it('sends the kiosk to the closed page when the lookup is refused as closed, with no error notice', async () => {
		vi.mocked(lookupPreRegisteredEvacuee).mockRejectedValue(closed());

		mountCheckIn();

		await vi.waitFor(() =>
			expect(goto).toHaveBeenCalledWith('/kiosk/closed?shelter_code=SH001', { replaceState: true })
		);
		expect(document.body.textContent).not.toContain('ตู้ปิดให้บริการ');
	});

	it('sends the kiosk to the closed page when the check-in is refused as closed', async () => {
		vi.mocked(lookupPreRegisteredEvacuee).mockResolvedValue(household);
		vi.mocked(checkInSelectedMembers).mockRejectedValue(closed());
		mountCheckIn();
		await vi.waitFor(() => expect(document.body.textContent).toContain('เลือกสมาชิก'));

		[...document.querySelectorAll('button')]
			.find((button) => button.textContent?.includes('ยืนยัน'))
			?.click();

		await vi.waitFor(() =>
			expect(goto).toHaveBeenCalledWith('/kiosk/closed?shelter_code=SH001', { replaceState: true })
		);
	});
});
