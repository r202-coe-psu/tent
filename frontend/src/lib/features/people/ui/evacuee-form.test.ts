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

import EvacueeForm from './evacuee-form.svelte';
import EvacueeRegistration from './evacuee-registration.svelte';

describe('EvacueeForm Station 1 wizard (CR-106)', () => {
	it('renders 3 steps without zoning or EWAR', () => {
		const result = render(EvacueeForm, {
			props: {
				onsubmit: vi.fn(),
				enableMedicalScreening: false
			}
		});

		expect(result.body).toContain('ขั้น 1 จาก 3');
		expect(result.body).not.toContain('จัดสรรพื้นที่');
		expect(result.body).not.toContain('คัดกรองสุขภาพ');
	});

	it('still 3 steps when medical screening flag is on (zoning never at S1)', () => {
		const result = render(EvacueeForm, {
			props: {
				onsubmit: vi.fn(),
				enableMedicalScreening: true
			}
		});

		expect(result.body).toContain('ขั้น 1 จาก 3');
	});

	it('step 1 registration includes special needs', () => {
		const result = render(EvacueeForm, {
			props: {
				onsubmit: vi.fn(),
				step: 1,
				enableMedicalScreening: true
			}
		});

		expect(result.body).toContain('กลุ่มเปราะบางและความต้องการพิเศษ');
	});

	it('includes SpecialNeedsFields in Registration allowing special needs selection', () => {
		const result = render(EvacueeRegistration, {
			props: {
				onsubmit: vi.fn(),
				initialInput: {
					first_name: 'สมศรี',
					last_name: 'มีสุข',
					special_needs: ['ใช้วีลแชร์']
				}
			}
		});

		expect(result.body).toContain('กลุ่มเปราะบางและความต้องการพิเศษ');
		expect(result.body).toContain('ใช้วีลแชร์');
		expect(result.body).toContain('ผู้ป่วยติดเตียง');
	});

	it('always renders emergency contact fields even when draft has no contact', () => {
		const result = render(EvacueeRegistration, {
			props: {
				onsubmit: vi.fn(),
				initialInput: {
					first_name: 'สมศรี',
					last_name: 'มีสุข',
					emergency_contact: undefined
				}
			}
		});

		expect(result.body).toContain('ข้อมูลติดต่อฉุกเฉิน (Emergency Contact)');
		expect(result.body).toContain('ชื่อผู้ติดต่อ');
		expect(result.body).toContain('เบอร์โทรศัพท์');
		expect(result.body).toContain('ความสัมพันธ์');
		expect(result.body).toContain('id="emergency-name"');
		expect(result.body).toContain('id="emergency-phone"');
		expect(result.body).toContain('id="emergency-relation"');
	});
});
