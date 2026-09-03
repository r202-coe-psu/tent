import { describe, it, expect, vi } from 'vitest';
import { readable } from 'svelte/store';
import { render } from 'svelte/server';

vi.mock('$app/stores', () => ({
	page: readable({ url: new URL('http://localhost') }),
	navigating: readable(null),
	updated: readable(false)
}));

vi.mock('@tanstack/svelte-query', () => ({
	createQuery: () => ({ data: undefined, isLoading: false, isError: false, refetch: vi.fn() }),
	createMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
	useQueryClient: () => ({ invalidateQueries: vi.fn() })
}));

import RegistrationShell from './registration-shell.svelte';
import EvacueeRegistration from './evacuee-registration.svelte';

describe('RegistrationShell Station 1 single-page (CR-106 / FR-03b-H)', () => {
	it('renders scroll-spy chips and sticky save without wizard steps', () => {
		const result = render(RegistrationShell, {
			props: {
				mode: 'walk-in',
				onsubmit: vi.fn(),
				enableMedicalScreening: false
			}
		});

		expect(result.body).toContain('ข้อมูลประจำตัว');
		expect(result.body).toContain('ครอบครัว');
		expect(result.body).toContain('ข้อมูลติดต่อฉุกเฉิน');
		expect(result.body).toContain('ความต้องการพิเศษ');
		expect(result.body).toContain('บันทึก');
		expect(result.body).not.toContain('กลุ่มเปราะบาง');
		expect(result.body).not.toContain('ขั้น 1 จาก 3');
		expect(result.body).not.toContain('จัดสรรพื้นที่');
		expect(result.body).not.toContain('คัดกรองสุขภาพ');
	});

	it('orders scroll-spy chips: photo, identity, household, emergency, special needs', () => {
		const result = render(RegistrationShell, {
			props: {
				mode: 'walk-in',
				onsubmit: vi.fn(),
				enableMedicalScreening: false
			}
		});

		const photo = result.body.indexOf('ภาพถ่ายใบหน้า');
		const identity = result.body.indexOf('ข้อมูลประจำตัว');
		const household = result.body.indexOf('ครอบครัว');
		const emergency = result.body.indexOf('ข้อมูลติดต่อฉุกเฉิน');
		const special = result.body.indexOf('ความต้องการพิเศษ');

		expect(photo).toBeGreaterThan(-1);
		expect(identity).toBeGreaterThan(photo);
		expect(household).toBeGreaterThan(identity);
		expect(emergency).toBeGreaterThan(household);
		expect(special).toBeGreaterThan(emergency);
	});

	it('defaults unlinked mode to Residence form without keep/create/join/solo chips', () => {
		const result = render(RegistrationShell, {
			props: {
				mode: 'walk-in',
				onsubmit: vi.fn(),
				enableMedicalScreening: false
			}
		});

		expect(result.body).toContain('ครอบครัว');
		expect(result.body).toContain('บ้านเลขที่');
		expect(result.body).toContain('เข้าร่วม');
		expect(result.body).not.toContain('คงครัวเรือนเดิม');
		expect(result.body).not.toContain('สร้างใหม่');
		expect(result.body).not.toContain('คนเดียว');
		expect(result.body).not.toContain('ครัวเรือนนี้มีในระบบแล้วหรือยัง');
	});

	it('shows linked-mode summary with keep / change residence / leave+create / join other', () => {
		const result = render(RegistrationShell, {
			props: {
				mode: 'report-in',
				enableMedicalScreening: true,
				initialEvacuee: {
					_id: 'evacuee:1',
					type: 'evacuee',
					first_name: 'สมศรี',
					last_name: 'มีสุข',
					gender: 'female',
					phone: null,
					household_id: 'household:1',
					special_needs: [],
					current_stay: { status: 'pre_registered', zone: null, since: '2026-01-01T00:00:00.000Z' },
					schema_v: 9
				} as never
			}
		});

		expect(result.body).toContain('คงครอบครัวเดิม');
		expect(result.body).toContain('เปลี่ยนที่อยู่');
		expect(result.body).toContain('ออกแล้วสร้างใหม่');
		expect(result.body).toContain('เข้าร่วมครอบครัวอื่น');
		expect(result.body).toContain('ความต้องการพิเศษ');
		expect(result.body).not.toContain('กลุ่มเปราะบาง');
		expect(result.body).not.toContain('คนเดียว');
	});

	it('shows emergency contact required asterisk on the section, not the nav chip', () => {
		const result = render(RegistrationShell, {
			props: {
				mode: 'walk-in',
				onsubmit: vi.fn(),
				enableMedicalScreening: false
			}
		});

		expect(result.body).toContain('> ข้อมูลติดต่อฉุกเฉิน</button>');
		expect(result.body).toContain('id="reg-section-emergency"');
		expect(result.body).toMatch(
			/id="reg-section-emergency"[\s\S]*?ข้อมูลติดต่อฉุกเฉิน[\s\S]*?<span class="text-destructive">\*<\/span>/
		);
	});

	it('registration section still includes special needs', () => {
		const result = render(EvacueeRegistration, {
			props: {
				onsubmit: vi.fn(),
				hideActions: true,
				initialInput: {
					first_name: 'สมศรี',
					last_name: 'มีสุข',
					special_needs: ['ใช้วีลแชร์']
				}
			}
		});

		expect(result.body).toContain('ความต้องการพิเศษ');
		expect(result.body).not.toContain('กลุ่มเปราะบาง');
		expect(result.body).toContain('ใช้วีลแชร์');
	});

	it('hides section E when allow flags are off and there is no existing household data', () => {
		const result = render(RegistrationShell, {
			props: {
				mode: 'walk-in',
				onsubmit: vi.fn(),
				enableMedicalScreening: false
			}
		});
		expect(result.body).not.toContain('สัตว์เลี้ยง/ทรัพย์สิน');
		expect(result.body).not.toContain('เป็นของทั้งครอบครัว');
	});
});
