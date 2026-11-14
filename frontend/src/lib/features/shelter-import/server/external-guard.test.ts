import { describe, expect, it } from 'vitest';
import { createShelterSchema } from '$lib/features/shelters/server';
import { externalForbiddenKeysFilled } from './external-guard';

const base = {
	name: 'ศูนย์ภายนอก',
	site_kind: 'evacuation_center',
	is_external: true,
	operation_status: 'unknown',
	capacity: 100,
	facilities: {},
	common_areas: {},
	utilities: {},
	risk: {},
	zones: []
};

function parsed(extra: Record<string, unknown> = {}): Record<string, unknown> {
	const r = createShelterSchema.safeParse({ ...base, ...extra });
	if (!r.success) throw new Error(JSON.stringify(r.error.issues));
	return r.data as Record<string, unknown>;
}

describe('externalForbiddenKeysFilled', () => {
	it('accepts an external row with schema defaults only', () => {
		expect(externalForbiddenKeysFilled(parsed())).toEqual([]);
	});

	it('flags a policy / utility value on an external row', () => {
		const data = parsed();
		const filled = {
			...data,
			utilities: { ...(data.utilities as object), power_available: true, water_available: true }
		};
		const withPolicy = {
			...data,
			admission_policy: { ...(data.admission_policy as object), pet_policy: 'allowed' }
		};
		expect(
			externalForbiddenKeysFilled(filled).length + externalForbiddenKeysFilled(withPolicy).length
		).toBeGreaterThan(0);
		expect(externalForbiddenKeysFilled(withPolicy)).toContain('admission_policy');
	});
});
