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

describe('EvacueeForm Wizard Modular Intake with Screening Toggle (Issue #206)', () => {
	it('renders 6 steps when enableMedicalScreening is false (small shelter unified flow)', () => {
		const result = render(EvacueeForm, {
			props: {
				onsubmit: vi.fn(),
				enableMedicalScreening: false
			}
		});

		expect(result.body).toContain('ขั้น 1 จาก 6');
		expect(result.body).toContain('จัดสรรพื้นที่');
	});

	it('renders 5 steps when enableMedicalScreening is true (modular 3-station pipeline)', () => {
		const result = render(EvacueeForm, {
			props: {
				onsubmit: vi.fn(),
				enableMedicalScreening: true
			}
		});

		expect(result.body).toContain('ขั้น 1 จาก 5');
		// Step 6 (จัดสรรพื้นที่) should not be in the steps list
		expect(result.body).not.toContain('ขั้น 1 จาก 6');
	});

	it('renders Step 3 registration with SpecialNeedsFields and PersonalInfoFields', () => {
		const result = render(EvacueeForm, {
			props: {
				onsubmit: vi.fn(),
				step: 3,
				enableMedicalScreening: true
			}
		});

		expect(result.body).toContain('ข้อมูลประจำตัว');
		expect(result.body).toContain('กลุ่มเปราะบางและความต้องการพิเศษ');
	});

	it('includes SpecialNeedsFields in Registration Step 3 allowing special needs selection', () => {
		const result = render(EvacueeRegistration, {
			props: {
				onsubmit: vi.fn(),
				onBack: vi.fn(),
				initialInput: {
					first_name: 'สมศรี',
					last_name: 'มีสุข',
					special_needs: ['ใช้วีลแชร์']
				}
			}
		});

		// Special needs section and badges from SpecialNeedsFields
		expect(result.body).toContain('กลุ่มเปราะบางและความต้องการพิเศษ');
		expect(result.body).toContain('ใช้วีลแชร์');
		expect(result.body).toContain('ผู้ป่วยติดเตียง');
	});
});
