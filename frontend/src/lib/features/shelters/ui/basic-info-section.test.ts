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

describe('BasicInfoSection external shelter (CR-252 FR-8/9/19)', () => {
	function renderWith(data: Record<string, unknown>, props: Record<string, unknown> = {}) {
		const formData = writable({ name: 'x', operation_status: 'standby', ...data });
		const form = {
			form: formData,
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
		return render(BasicInfoSection, {
			props: { form, formData: formData as unknown as SuperFormData<Shelter>, ...props }
		}).body;
	}

	it('shows the External switch to a system_admin creating a shelter', () => {
		expect(renderWith({}, { isSystemAdmin: true, isEdit: false })).toContain('is-external-switch');
	});

	it.each([
		['a non-admin creating', { isSystemAdmin: false, isEdit: false }],
		['a system_admin editing', { isSystemAdmin: true, isEdit: true }]
	])('hides the External switch from %s', (_n, props) => {
		expect(renderWith({}, props)).not.toContain('is-external-switch');
	});

	it('an external form keeps the URL input, hides policy-ish basics, locks the type on edit', () => {
		const body = renderWith(
			{ is_external: true, operation_status: 'unknown', external_url: null },
			{ isSystemAdmin: true, isEdit: true }
		);
		expect(body).toContain('ลิงก์ไปยังระบบต้นทาง');
		expect(body).toContain('ความจุสูงสุด');
		expect(body).toContain('external-locked-note');
		expect(body).toContain('ประเภทอาคาร');
		expect(body).not.toContain('จำนวนชั้น');
		expect(body).not.toContain('ระดับโครงการ');
		expect(body).not.toContain('คุณสมบัติการปฏิบัติการ');
		expect(body).not.toContain('ข้อมูลบุคลากรหลัก');
		expect(body).toContain('ที่อยู่ตามเขตการปกครอง');
		expect(body).toContain('ผู้จัดการศูนย์');
	});

	it('a regular form shows no URL input and keeps the operational basics', () => {
		const body = renderWith({ is_external: false }, { isSystemAdmin: true, isEdit: false });
		expect(body).not.toContain('ลิงก์ไปยังระบบต้นทาง');
		expect(body).toContain('ระดับโครงการ');
		expect(body).toContain('คุณสมบัติการปฏิบัติการ');
	});
});
