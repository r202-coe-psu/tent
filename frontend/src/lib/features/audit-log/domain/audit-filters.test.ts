import { describe, expect, it } from 'vitest';
import {
	auditFilterFormFromParams,
	auditFilterFormToParams,
	auditFiltersFromForm,
	EMPTY_AUDIT_FILTER_FORM
} from './audit-filters';

describe('audit filter form', () => {
	it('reads the URL and drops invalid values', () => {
		const form = auditFilterFormFromParams(
			new URLSearchParams('action=hack&from_date=2026-11-01&to_date=yesterday&actor=sm')
		);
		expect(form).toEqual({ ...EMPTY_AUDIT_FILTER_FORM, actor: 'sm', from_date: '2026-11-01' });
	});

	it('writes only filled values back to the URL', () => {
		expect(
			auditFilterFormToParams({ ...EMPTY_AUDIT_FILTER_FORM, entity_type: 'user' }).toString()
		).toBe('entity_type=user');
	});

	it('turns Thai calendar days into a UTC range', () => {
		const filters = auditFiltersFromForm(
			{ ...EMPTY_AUDIT_FILTER_FORM, from_date: '2026-11-17', to_date: '2026-11-17' },
			null
		);
		expect(filters.from).toBe('2026-11-16T17:00:00.000Z');
		expect(filters.to).toBe('2026-11-17T16:59:59.999Z');
	});

	it('forces the manager shelter over the form value', () => {
		expect(
			auditFiltersFromForm({ ...EMPTY_AUDIT_FILTER_FORM, shelter_code: 'SH009' }, 'SH001')
				.shelter_code
		).toBe('SH001');
		expect(
			auditFiltersFromForm({ ...EMPTY_AUDIT_FILTER_FORM, shelter_code: 'SH009' }, null).shelter_code
		).toBe('SH009');
	});
});
