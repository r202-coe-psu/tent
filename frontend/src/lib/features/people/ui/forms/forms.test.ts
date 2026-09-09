import { describe, it, expect, afterEach } from 'vitest';
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
import { languageStore } from '$lib/stores/language.svelte';

describe('Shared Form Sub-components for Evacuee Intake and Profile (Issue #205)', () => {
	afterEach(() => {
		languageStore.setLanguage('th');
	});

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
			expect(result.body).toContain('ชาย');
			expect(result.body).toContain('หญิง');
			expect(result.body).toContain('value="male"');
			expect(result.body).toContain('value="female"');
			// Gender radios only — no third "อื่น" option in the radio group.
			expect(result.body).not.toContain('value="other"');
		});

		it('renders English placeholders and options when locale is en', () => {
			languageStore.setLanguage('en');
			const result = render(PersonalInfoFields, {
				props: {
					first_name: 'Somchai',
					last_name: 'Meesuk',
					phone: '0812345678',
					birth_year: '2535',
					age: '35',
					gender: 'male',
					religion: 'buddhist',
					country: 'THAILAND',
					person_id: { cardType: 'national_id', number: '' }
				}
			});
			expect(result.body).toContain('First Name');
			expect(result.body).toContain('Last Name');
			expect(result.body).toContain('Given name');
			expect(result.body).toContain('e.g. Meesuk');
			expect(result.body).toContain('Nickname (optional)');
			expect(result.body).toContain('Male');
			expect(result.body).toContain('Female');
			expect(result.body).toContain('Thai National ID');
			expect(result.body).toContain('13 digits');
			expect(result.body).toContain('Buddhist');
			expect(result.body).toContain('C.E.');
			expect(result.body).toContain('B.E.');
			expect(result.body).toContain('No phone number');
			expect(result.body).toContain('Thailand');
			expect(result.body).toContain('Nationality');
			expect(result.body).not.toContain('ชื่อจริง');
			expect(result.body).not.toContain('เช่น มีสุข');
			expect(result.body).not.toContain('ไม่มีเบอร์โทรศัพท์');
			expect(result.body).not.toContain('เลข 13 หลัก');
			expect(result.body).not.toContain('>ไทย<');
		});

		it('shows religion label defaulting to ไม่ระบุ (options live in Select portal)', () => {
			const result = render(PersonalInfoFields, {
				props: {
					religion: 'unknown',
					phone: '0812345678'
				}
			});
			expect(result.body).toContain('ศาสนา');
			expect(result.body).toContain('ไม่ระบุ');
			// Closed Select SSR only renders the trigger — no portal items / no「อื่นๆ」trigger.
			expect(result.body).not.toMatch(/ศาสนา[\s\S]{0,400}อื่น\s*ๆ/);
		});

		it('maps legacy religion other to ไม่ระบุ on the trigger', () => {
			const result = render(PersonalInfoFields, {
				props: {
					religion: 'other',
					phone: '0812345678'
				}
			});
			expect(result.body).toContain('ไม่ระบุ');
		});

		it('shows BE/CE calendar toggle labels', () => {
			const result = render(PersonalInfoFields, {
				props: {
					birth_year: 2535,
					phone: '0812345678'
				}
			});
			expect(result.body).toMatch(/พ\.ศ\.|ค\.ศ\./);
		});

		it('hides no-phone checkbox when hideNoPhone is set', () => {
			const result = render(PersonalInfoFields, {
				props: {
					hideNoPhone: true,
					phone: '0812345678'
				}
			});
			expect(result.body).not.toContain('ไม่มีเบอร์โทรศัพท์');
		});

		it('shows no-phone checkbox by default (onsite / non-head)', () => {
			const result = render(PersonalInfoFields, {
				props: {
					hideNoPhone: false,
					phone: ''
				}
			});
			expect(result.body).toContain('ไม่มีเบอร์โทรศัพท์');
		});

		it('sets card-number maxlength from selected card type', () => {
			const national = render(PersonalInfoFields, {
				props: {
					person_id: { cardType: 'national_id', number: '' }
				}
			});
			expect(national.body).toMatch(/id="card-number"[^>]*maxlength="13"/);

			const passport = render(PersonalInfoFields, {
				props: {
					person_id: { cardType: 'passport', number: '' }
				}
			});
			expect(passport.body).toMatch(/id="card-number"[^>]*maxlength="9"/);

			const other = render(PersonalInfoFields, {
				props: {
					person_id: { cardType: 'other', number: '' }
				}
			});
			expect(other.body).toMatch(/id="card-number"/);
			expect(other.body).not.toMatch(/id="card-number"[^>]*maxlength=/);
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

		it('shows required asterisks when required is true', () => {
			const result = render(EmergencyContactFields, {
				props: {
					name: '',
					phone: '',
					relation: '',
					required: true
				}
			});
			expect(result.body).toContain('aria-required="true"');
			expect(result.body).toContain('<span class="text-destructive">*</span>');
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
		it('renders housing type, landmark, and address fields', () => {
			const result = render(HouseholdAddressFields, {
				props: {
					housing_type: 'owned_house',
					residence_landmark: 'ใกล้สะพาน',
					address_no: '99/1',
					village_no: 'หมู่ 5',
					province: 'สงขลา',
					district: 'หาดใหญ่',
					subdistrict: 'คอหงส์',
					postal_code: '90110'
				}
			});
			expect(result.body).toContain('ประเภทที่อยู่อาศัย');
			expect(result.body).toContain('จุดสังเกตที่อยู่');
			expect(result.body).toContain('บ้านเลขที่');
			expect(result.body).toContain('หมู่ที่ / ตรอก / ซอย / ถนน');
			expect(result.body).toContain('99/1');
			expect(result.body).toContain('ใกล้สะพาน');
		});

		it('hides address_no when housing_type is homeless', () => {
			const result = render(HouseholdAddressFields, {
				props: {
					housing_type: 'homeless',
					residence_landmark: 'ใต้สะพาน',
					address_no: '99/1',
					village_no: 'หมู่ 5',
					province: 'สงขลา',
					district: 'หาดใหญ่',
					subdistrict: 'คอหงส์',
					postal_code: '90110'
				}
			});
			expect(result.body).toContain('จุดสังเกตที่อยู่');
			expect(result.body).not.toContain('id="address-no"');
			expect(result.body).not.toContain('บ้านเลขที่');
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
		it('renders conditions, medications, allergies, notes, and care track without triage or blood group (CR-106)', () => {
			const result = render(HealthMedicalFields, {
				props: {
					conditions: 'เบาหวาน',
					medications: 'Metformin',
					allergies: 'ไม่มี',
					medical_notes: 'ติดตามความดัน',
					care_track: 'normal'
				}
			});
			expect(result.body).toContain('โรคประจำตัว');
			expect(result.body).toContain('ยาที่ใช้ประจำ');
			expect(result.body).toContain('ประวัติการแพ้');
			expect(result.body).toContain('แนวทางดูแล');
			expect(result.body).not.toContain('หมู่เลือด');
			expect(result.body).not.toContain('Triage');
			expect(result.body).not.toContain('สถานะการส่งต่อ');
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

		it('shows EWAR surveillance quarantine recommendation without deprecated triage text', () => {
			const result = render(ZoneSelectionFields, {
				props: {
					selected_zone: '',
					ewar_symptoms: ['acute_respiratory', 'fever'],
					shelter_zones: [
						{ code: 'Z-01', name: 'โซน A - ทั่วไป', type: 'general' },
						{ code: 'Z-Q', name: 'โซนกักตัว', type: 'quarantine' }
					]
				}
			});
			expect(result.body).toContain('แนะนำสำหรับผู้มีอาการเฝ้าระวัง (กักตัว)');
			expect(result.body).not.toContain('triage');
		});
	});
});
