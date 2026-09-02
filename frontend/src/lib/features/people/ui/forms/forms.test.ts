import { describe, it, expect } from 'vitest';
import { render } from 'svelte/server';
import {
	PersonalInfoFields,
	SpecialNeedsFields,
	EmergencyContactFields,
	EwarSymptomsFields,
	HouseholdAddressFields,
	PetAssetVehicleFields,
	HealthMedicalFields,
	ZoneSelectionFields,
	SPECIAL_NEEDS_COMMON_TAGS
} from './index.js';

describe('Shared Form Sub-components for Evacuee Intake and Profile (Issue #205)', () => {
	describe('Module Exports', () => {
		it('exports all 8 required form sub-components and constants', () => {
			expect(PersonalInfoFields).toBeDefined();
			expect(SpecialNeedsFields).toBeDefined();
			expect(EmergencyContactFields).toBeDefined();
			expect(EwarSymptomsFields).toBeDefined();
			expect(HouseholdAddressFields).toBeDefined();
			expect(PetAssetVehicleFields).toBeDefined();
			expect(HealthMedicalFields).toBeDefined();
			expect(ZoneSelectionFields).toBeDefined();
			expect(SPECIAL_NEEDS_COMMON_TAGS).toBeDefined();
			expect(SPECIAL_NEEDS_COMMON_TAGS).toContain('ใช้วีลแชร์');
			expect(SPECIAL_NEEDS_COMMON_TAGS).toContain('ผู้ป่วยติดเตียง');
		});
	});

	describe('Personal Info Fields (personal-info-fields.svelte)', () => {
		it('instantiates and renders cleanly with default and bound props', () => {
			const result = render(PersonalInfoFields, {
				props: {
					first_name: 'สมศรี',
					last_name: 'มีสุข',
					phone: '0812345678',
					birth_year: '2530',
					age: '39',
					gender: 'female',
					religion: 'buddhist',
					country: 'THAILAND'
				}
			});
			expect(result.body).toContain('ชื่อ');
			expect(result.body).toContain('นามสกุล');
			expect(result.body).toContain('สมศรี');
			expect(result.body).toContain('มีสุข');
		});
	});

	describe('Special Needs Fields (special-needs-fields.svelte)', () => {
		it('renders common tags and custom tags correctly', () => {
			const result = render(SpecialNeedsFields, {
				props: {
					special_needs: ['ใช้วีลแชร์', 'ต้องการอาหารเฉพาะ']
				}
			});
			expect(result.body).toContain('ใช้วีลแชร์');
			expect(result.body).toContain('ผู้ป่วยติดเตียง');
			expect(result.body).toContain('ใช้ออกซิเจน');
			expect(result.body).toContain('หญิงตั้งครรภ์');
			expect(result.body).toContain('ทารก/เด็กเล็ก');
			expect(result.body).toContain('ผู้พิการทางการมองเห็น');
			expect(result.body).toContain('ผู้พิการทางการได้ยิน');
			expect(result.body).toContain('มีภาวะพึ่งพิงสูง');
			expect(result.body).toContain('ต้องการอาหารเฉพาะ');
		});
	});

	describe('Emergency Contact Fields (emergency-contact-fields.svelte)', () => {
		it('renders name, phone, and relation inputs cleanly', () => {
			const result = render(EmergencyContactFields, {
				props: {
					name: 'สมหมาย มีสุข',
					phone: '0899999999',
					relation: 'บิดา'
				}
			});
			expect(result.body).toContain('ชื่อผู้ติดต่อ');
			expect(result.body).toContain('เบอร์โทรศัพท์');
			expect(result.body).toContain('ความสัมพันธ์');
			expect(result.body).toContain('สมหมาย มีสุข');
		});
	});

	describe('EWAR Symptoms Fields (ewar-symptoms-fields.svelte)', () => {
		it('renders symptoms checklist and temperature_c input', () => {
			const result = render(EwarSymptomsFields, {
				props: {
					symptoms: ['fever', 'cough'],
					temperature_c: 37.5
				}
			});
			expect(result.body).toContain('อาการเฝ้าระวัง');
			expect(result.body).toContain('37.5');
		});
	});

	describe('Household Address Fields (household-address-fields.svelte)', () => {
		it('renders address_no, village_no, province, district, subdistrict, postal_code', () => {
			const result = render(HouseholdAddressFields, {
				props: {
					address_no: '99/1',
					village_no: 'หมู่ 5',
					province: 'สงขลา',
					district: 'หาดใหญ่',
					subdistrict: 'คอหงส์',
					postal_code: '90110'
				}
			});
			expect(result.body).toContain('บ้านเลขที่');
			expect(result.body).toContain('หมู่ที่ / ตรอก / ซอย / ถนน');
			expect(result.body).toContain('99/1');
		});
	});

	describe('Pet Asset Vehicle Fields (pet-asset-vehicle-fields.svelte)', () => {
		it('renders vehicles, valuables, and pets lists', () => {
			const result = render(PetAssetVehicleFields, {
				props: {
					vehicles: [{ type: 'car', license_plate: 'กก 1234' }],
					valuables: 'กระเป๋าเดินทาง 2 ใบ',
					pets: [{ species: 'dog', count: 1, notes: 'เจ้าด่าง', has_cage: true }]
				}
			});
			expect(result.body).toContain('ยานพาหนะ');
			expect(result.body).toContain('สัมภาระและสิ่งของมีค่า');
			expect(result.body).toContain('สัตว์เลี้ยงที่นำมาด้วย');
			expect(result.body).toContain('กระเป๋าเดินทาง 2 ใบ');
		});
	});

	describe('Health Medical Fields (health-medical-fields.svelte)', () => {
		it('renders blood group, conditions, medications, allergies, notes, and triage level', () => {
			const result = render(HealthMedicalFields, {
				props: {
					blood_group: 'B',
					conditions: 'เบาหวาน',
					medications: 'Metformin',
					allergies: 'ไม่มี',
					medical_notes: 'ติดตามความดัน',
					triage_level: 'green'
				}
			});
			expect(result.body).toContain('หมู่เลือด');
			expect(result.body).toContain('โรคประจำตัว');
			expect(result.body).toContain('ยาที่ใช้ประจำ');
			expect(result.body).toContain('ประวัติการแพ้');
			expect(result.body).toContain('Triage');
		});
	});

	describe('Zone Selection Fields (zone-selection-fields.svelte)', () => {
		it('renders zone options with recommended zone indication', () => {
			const result = render(ZoneSelectionFields, {
				props: {
					selected_zone: 'Z-01',
					shelter_zones: [
						{ code: 'Z-01', name: 'โซน A - ทั่วไป', type: 'general' },
						{ code: 'Z-02', name: 'โซน B - เปราะบาง', type: 'vulnerable' }
					]
				}
			});
			expect(result.body).toContain('โซน A - ทั่วไป');
			expect(result.body).toContain('โซน B - เปราะบาง');
		});
	});
});
