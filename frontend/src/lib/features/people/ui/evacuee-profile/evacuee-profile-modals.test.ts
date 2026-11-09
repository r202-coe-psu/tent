import { describe, expect, it, vi } from 'vitest';
import type { Component } from 'svelte';
import { readable } from 'svelte/store';
import { render } from 'svelte/server';
import { langState } from '$lib/states/i18n.svelte';
import type { Evacuee, Household } from '../../domain/people';
import EvacueeStatusModal from './evacuee-status-modal.svelte';
import EvacueeZoneModal from './evacuee-zone-modal.svelte';
import EvacueeEmergencyModal from './evacuee-emergency-modal.svelte';
import EvacueeAssetsModal from './evacuee-assets-modal.svelte';
import EvacueeAddressModal from './evacuee-address-modal.svelte';
import EvacueePersonalModal from './evacuee-personal-modal.svelte';
import EvacueeHealthModal from './evacuee-health-modal.svelte';

// superForm reads the SvelteKit page store, which does not exist outside a request.
vi.mock('$app/stores', () => ({
	page: readable({
		url: new URL('http://localhost/'),
		params: {},
		route: { id: null },
		status: 200,
		error: null,
		data: {},
		form: undefined,
		state: {}
	}),
	navigating: readable(null),
	updated: Object.assign(readable(false), { check: async () => false })
}));

// The health modal's master-data queries need a QueryClient; serve empty results instead.
vi.mock('$lib/features/master-data', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/master-data')>()),
	useMasterData: () => ({ data: { items: [] }, isPending: false, isLoading: false })
}));

const THAI = /[฀-๿]/;

const evacuee: Evacuee = {
	_id: 'evacuee:test-123',
	_rev: '1-abc',
	type: 'evacuee',
	schema_v: 9,
	first_name: 'Anna',
	last_name: 'Schmidt',
	gender: 'female',
	age: 40,
	country: 'GERMANY',
	phone: null,
	vulnerable_groups: [],
	special_needs: [],
	current_stay: { status: 'temporary_leave', zone: null, since: '2026-09-02T10:00:00.000Z' },
	privacy: { search_excluded: false },
	registered_via: 'staff',
	household_id: null,
	shelter_code: 'SH001',
	created_at: '2026-09-02T10:00:00.000Z',
	created_by: 'staff-1',
	updated_at: '2026-09-02T10:00:00.000Z'
} as Evacuee;

const household: Household = {
	_id: 'household:test-123',
	_rev: '1-abc',
	type: 'household',
	schema_v: 9,
	label: 'Schmidt family',
	head_evacuee_id: null,
	status: 'checked_in',
	shelter_code: 'SH001',
	checkout_destination: null,
	municipality_zone: null,
	community: null,
	pets: [],
	assets: null,
	vehicles: [],
	address_no: null,
	village_no: null,
	subdistrict: null,
	district: null,
	province: null,
	postal_code: null,
	created_at: '2026-09-02T10:00:00.000Z',
	created_by: 'staff-1',
	updated_at: '2026-09-02T10:00:00.000Z'
};

function renderIn<P extends Record<string, unknown>>(
	language: 'th' | 'en',
	component: Component<P>,
	props: P
) {
	const previous = langState.current;
	langState.current = language;
	try {
		return render(component, { props }).body;
	} finally {
		langState.current = previous;
	}
}

const noop = () => {};
const noopAsync = async () => {};

describe('EvacueeStatusModal', () => {
	const props = {
		show: true,
		evacuee,
		statusConfig: {
			temporary_leave: { label: 'Temporary leave', colorClass: '', dotClass: '' }
		},
		onClose: noop,
		onUpdateStatus: noopAsync
	};

	it('shows English title, reason field and buttons and no Thai when the staff language is EN', () => {
		const body = renderIn('en', EvacueeStatusModal, props);
		expect(body).toContain('Edit stay status');
		expect(body).toContain('Reason');
		expect(body).toContain('Enter a reason, e.g. temporarily back home / moved out');
		expect(body).toContain('Cancel');
		expect(body).toContain('Confirm');
		expect(body).not.toMatch(THAI);
	});

	it('keeps the Thai text when the staff language is TH', () => {
		const body = renderIn('th', EvacueeStatusModal, props);
		expect(body).toContain('แก้ไขสถานะการพักพิง (Stay status)');
		expect(body).toContain('สถานะการพักพิง');
		expect(body).toContain('เหตุผล');
		expect(body).toContain('ระบุเหตุผล เช่น กลับบ้านชั่วคราว / ย้ายออก');
		expect(body).toContain('ยกเลิก');
		expect(body).toContain('ยืนยัน');
	});
});

describe('EvacueeZoneModal', () => {
	const props = {
		show: true,
		evacuee,
		shelterZones: [],
		onClose: noop,
		onUpdateZone: noopAsync
	};

	it('shows English title and buttons and no Thai when the staff language is EN', () => {
		const body = renderIn('en', EvacueeZoneModal, props);
		expect(body).toContain('Change stay zone');
		expect(body).toContain('Cancel');
		expect(body).toContain('Confirm zone change');
		expect(body).not.toMatch(THAI);
	});

	it('keeps the Thai text when the staff language is TH', () => {
		const body = renderIn('th', EvacueeZoneModal, props);
		expect(body).toContain('ย้ายโซนที่พัก (Change stay zone)');
		expect(body).toContain('ยกเลิก');
		expect(body).toContain('ยืนยันย้ายโซน');
	});
});

describe('EvacueeEmergencyModal', () => {
	const props = { show: true, evacuee, onClose: noop, onSave: noopAsync };

	it('shows English title and buttons when the staff language is EN', () => {
		const body = renderIn('en', EvacueeEmergencyModal, props);
		expect(body).toContain('Edit emergency contact');
		expect(body).toContain('aria-label="Close"');
		expect(body).toContain('Cancel');
		expect(body).toContain('Save contact');
		expect(body).not.toMatch(THAI);
	});

	it('keeps the Thai text when the staff language is TH', () => {
		const body = renderIn('th', EvacueeEmergencyModal, props);
		expect(body).toContain('แก้ไขผู้ติดต่อฉุกเฉิน');
		expect(body).toContain('aria-label="ปิด"');
		expect(body).toContain('ยกเลิก');
		expect(body).toContain('บันทึกผู้ติดต่อ');
	});
});

describe('EvacueeAssetsModal', () => {
	const props = { show: true, household, onClose: noop, onSave: noopAsync };

	it('shows English title and buttons when the staff language is EN', () => {
		const body = renderIn('en', EvacueeAssetsModal, props);
		expect(body).toContain('Edit assets and pets');
		expect(body).toContain('Cancel');
		expect(body).toContain('>Save<');
		// The embedded PetAssetVehicleFields still holds Thai (its own slice); check the modal's own
		// header and footer around it.
		const own = body.split('overflow-y-auto pr-1')[0] + body.slice(body.lastIndexOf('pt-4'));
		expect(own).not.toMatch(THAI);
	});

	it('keeps the Thai text when the staff language is TH', () => {
		const body = renderIn('th', EvacueeAssetsModal, props);
		expect(body).toContain('แก้ไขทรัพย์สินและสัตว์เลี้ยง (Assets &amp; Pets)');
		expect(body).toContain('ยกเลิก');
		expect(body).toContain('บันทึกข้อมูล');
	});
});

describe('EvacueeAddressModal', () => {
	const props = { show: true, household, onClose: noop, onSave: noopAsync };

	it('shows English title, own field labels and buttons when the staff language is EN', () => {
		const body = renderIn('en', EvacueeAddressModal, props);
		expect(body).toContain('Edit family address');
		expect(body).toContain('aria-label="Close"');
		expect(body).toContain('Municipal zone');
		expect(body).toContain('placeholder="Enter the municipal zone..."');
		expect(body).toContain('Community');
		expect(body).toContain('Cancel');
		expect(body).toContain('Save');
		expect(body).not.toMatch(THAI);
	});

	it('keeps the Thai text when the staff language is TH', () => {
		const body = renderIn('th', EvacueeAddressModal, props);
		expect(body).toContain('แก้ไขที่อยู่ครอบครัว');
		expect(body).toContain('เขตเทศบาล');
		expect(body).toContain('placeholder="ระบุเขตเทศบาล..."');
		expect(body).toContain('ชุมชน');
		expect(body).toContain('ยกเลิก');
		expect(body).toContain('บันทึกข้อมูล');
	});
});

describe('EvacueePersonalModal', () => {
	const props = { show: true, evacuee, onClose: noop, onSave: noopAsync };

	it('shows English title, subtitle and buttons when the staff language is EN', () => {
		const body = renderIn('en', EvacueePersonalModal, props);
		expect(body).toContain('Edit personal information');
		expect(body).toContain('Identity details and main contact information');
		expect(body).toContain('Photo');
		expect(body).toContain('Choose photo');
		expect(body).toContain('Save personal information');
		expect(body).not.toMatch(THAI);
	});

	it('keeps the Thai text when the staff language is TH', () => {
		const body = renderIn('th', EvacueePersonalModal, props);
		expect(body).toContain('แก้ไขข้อมูลส่วนบุคคล');
		expect(body).toContain('ข้อมูลระบุตัวตนและช่องทางติดต่อหลัก');
		expect(body).toContain('รูปถ่าย');
		expect(body).toContain('เลือกรูป');
		expect(body).toContain('บันทึกข้อมูลส่วนบุคคล');
	});
});

describe('EvacueeHealthModal', () => {
	const props = {
		show: true,
		evacuee,
		medical: null,
		screening: null,
		onClose: noop,
		onSave: noopAsync
	};

	it('shows English title, section headings and buttons when the staff language is EN', () => {
		const body = renderIn('en', EvacueeHealthModal, props);
		expect(body).toContain('Edit health information');
		expect(body).toContain('1. Health history and care track');
		expect(body).toContain('2. Vulnerable groups');
		expect(body).toContain('3. Special needs');
		expect(body).toContain('4. Epidemiological surveillance symptoms (EWAR)');
		expect(body).toContain('Cancel');
		expect(body).toContain('Save');
		expect(body).not.toMatch(THAI);
	});

	it('keeps the Thai text when the staff language is TH', () => {
		const body = renderIn('th', EvacueeHealthModal, props);
		expect(body).toContain('แก้ไขข้อมูลสุขภาพ (Station 2 Occupant Screening)');
		expect(body).toContain('1. ประวัติสุขภาพและแนวทางดูแล (Health History &amp; Care Track)');
		expect(body).toContain('2. กลุ่มเปราะบาง (Vulnerable Groups)');
		expect(body).toContain('3. ความต้องการพิเศษ (Special needs)');
		expect(body).toContain('ยกเลิก');
		expect(body).toContain('บันทึกข้อมูล');
	});
});
