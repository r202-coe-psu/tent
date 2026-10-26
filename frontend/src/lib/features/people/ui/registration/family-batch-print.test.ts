import { describe, it, expect, vi } from 'vitest';
import { render } from 'svelte/server';

vi.mock('@tanstack/svelte-query', () => ({
	createQuery: () => ({ data: undefined, isLoading: false, isError: false, refetch: vi.fn() }),
	createMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
	useQueryClient: () => ({ invalidateQueries: vi.fn() })
}));

import FamilyBatchPrint from './family-batch-print.svelte';
import type { Evacuee, Household } from '../../domain/people';

describe('FamilyBatchPrint (Station 1 completion summary)', () => {
	const member: Evacuee = {
		_id: 'evacuee:test-1',
		_rev: '1-abc',
		type: 'evacuee',
		schema_v: 9,
		first_name: 'สุนิตา',
		last_name: 'บางค้างพลู',
		gender: 'female',
		phone: '0805819561',
		person_id: null,
		country: 'THAILAND',
		vulnerable_groups: [],
		special_needs: [],
		current_stay: {
			status: 'arriving',
			zone: null,
			since: '2026-10-24T10:00:00.000Z'
		},
		privacy: { search_excluded: false },
		registered_via: 'staff',
		household_id: 'household:test-1',
		shelter_code: 'SH001',
		created_at: '2026-10-24T10:00:00.000Z',
		created_by: 'staff-1',
		updated_at: '2026-10-24T10:00:00.000Z'
	} as unknown as Evacuee;

	const household: Household = {
		_id: 'household:test-1',
		_rev: '1-abc',
		type: 'household',
		schema_v: 6,
		label: 'ครัวเรือนหนอกสีสุก',
		head_evacuee_id: 'evacuee:test-1',
		status: 'arriving',
		checkout_destination: null,
		municipality_zone: null,
		community: null,
		pets: [],
		vehicles: [],
		address_no: null,
		village_no: null,
		subdistrict: null,
		district: null,
		province: null,
		postal_code: null,
		shelter_code: 'SH001',
		created_at: '2026-10-24T10:00:00.000Z',
		created_by: 'staff-1',
		updated_at: '2026-10-24T10:00:00.000Z'
	} as unknown as Household;

	function renderSummary() {
		return render(FamilyBatchPrint, {
			props: { household, members: [member], onDone: () => {} }
		});
	}

	it('prints the person ID card for every member', () => {
		const result = renderSummary();

		expect(result.body).toContain('ลงทะเบียนสำเร็จ');
		expect(result.body).toContain('สุนิตา');
		expect(result.body).toMatch(/บัตรประจำตัว|ID Card/i);
	});

	it('does not render a handover slip alongside the ID card', () => {
		const result = renderSummary();

		expect(result.body).not.toMatch(/Handover Slip/i);
		expect(result.body).not.toContain('ใบส่งตัวผู้ประสบภัย');
		expect(result.body).not.toContain('STATION 1 -> STATION 2');
	});

	it('does not promise a handover slip in the summary subtitle', () => {
		const result = renderSummary();

		expect(result.body).toContain('Person QR');
		expect(result.body).not.toMatch(/Handover/i);
	});
});
