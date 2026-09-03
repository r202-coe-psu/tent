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

/** Legacy wizard retained until callers migrate fully; Station 1 routes use RegistrationShell. */
describe('EvacueeForm legacy wizard (compat)', () => {
	it('still renders multi-step chrome when used directly', () => {
		const result = render(EvacueeForm, {
			props: {
				onsubmit: vi.fn(),
				enableMedicalScreening: false
			}
		});

		expect(result.body).toContain('ขั้น 1 จาก 3');
		expect(result.body).not.toContain('จัดสรรพื้นที่');
	});

	it('includes SpecialNeedsFields in Registration', () => {
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

		expect(result.body).toContain('ความต้องการพิเศษ');
		expect(result.body).not.toContain('กลุ่มเปราะบาง');
		expect(result.body).toContain('ใช้วีลแชร์');
	});

	it('always renders optional emergency contact fields even when draft has no contact', () => {
		const result = render(EvacueeRegistration, {
			props: {
				onsubmit: vi.fn(),
				initialInput: {
					first_name: 'สมศรี',
					last_name: 'มีสุข'
				}
			}
		});

		expect(result.body).toMatch(/emergency|ฉุกเฉิน/i);
		expect(result.body).not.toMatch(/ข้อมูลติดต่อฉุกเฉิน[\s\S]{0,80}\*/);
	});
});
