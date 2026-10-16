import { describe, it, expect, vi } from 'vitest';
import { render } from 'svelte/server';
import BasicInfoSection from './basic-info-section.svelte';
import { writable } from 'svelte/store';
import type { SuperForm } from 'sveltekit-superforms';
import type { SuperFormData } from 'sveltekit-superforms/client';
import type { Shelter } from '../domain/schema';

vi.mock('../application/queries', () => ({
	useProvinces: () => ({ data: ['สงขลา'] }),
	useDistricts: () => ({ data: ['หาดใหญ่'] }),
	useSubdistricts: () => ({ data: [{ subdistrict: 'คอหงส์', zipcode: '90110' }] })
}));

vi.mock('$lib/features/master-data', () => ({
	useMasterData: () => ({ data: [] }),
	formatMasterLabel: (item: { name?: string } | null | undefined) => item?.name ?? ''
}));

vi.mock('./location-map-picker.svelte', () => ({
	default: () => ''
}));

describe('BasicInfoSection (#399 Coordinator Label)', () => {
	it('renders coordinator label as "ผู้ประสานงาน (Coordinator)" and not "EOC"', () => {
		const mockFormData = writable({
			name: 'ศูนย์ทดสอบ',
			operation_status: 'standby',
			key_personnel: {
				eoc_liaison: { name: 'นายทดสอบ', phone: '0812345678' }
			}
		});

		const mockForm = {
			form: mockFormData,
			errors: writable({}),
			constraints: writable({}),
			tainted: writable(undefined),
			submitting: writable(false),
			delayed: writable(false),
			timeout: writable(false),
			posted: writable(false),
			allErrors: writable([]),
			capture: vi.fn(),
			restore: vi.fn(),
			enhance: vi.fn(),
			message: writable(undefined)
		} as unknown as SuperForm<Shelter>;

		const result = render(BasicInfoSection, {
			props: {
				form: mockForm,
				formData: mockFormData as unknown as SuperFormData<Shelter>,
				disabled: false
			}
		});

		// Expect new label to be present
		expect(result.body).toContain('ผู้ประสานงาน (Coordinator)');

		// Expect old label with EOC to NOT be present
		expect(result.body).not.toContain('ผู้ประสานงาน EOC (EOC Liaison)');
	});
});
