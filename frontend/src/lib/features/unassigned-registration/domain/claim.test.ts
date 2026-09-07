import { describe, expect, it } from 'vitest';
import { defaultSelectedMemberIds, toggleMemberSelection } from './claim';
import type { OpenMemberHit } from './search';

const member = (id: string, first: string): OpenMemberHit => ({
	reserved_evacuee_id: id,
	status: 'open',
	first_name: first,
	last_name: 'ใจดี',
	gender: 'male',
	phone: null,
	person_id: null,
	country: 'THAILAND',
	vulnerable_groups: [],
	special_needs: []
});

describe('claim selection helpers', () => {
	it('defaults to selecting every open member', () => {
		expect(
			defaultSelectedMemberIds([member('evacuee:a', 'สมชาย'), member('evacuee:b', 'สมหญิง')])
		).toEqual(['evacuee:a', 'evacuee:b']);
	});

	it('toggles member ids without mutating the prior selection', () => {
		const base = ['evacuee:a'];
		expect(toggleMemberSelection(base, 'evacuee:b', true)).toEqual(['evacuee:a', 'evacuee:b']);
		expect(base).toEqual(['evacuee:a']);
		expect(toggleMemberSelection(['evacuee:a', 'evacuee:b'], 'evacuee:a', false)).toEqual([
			'evacuee:b'
		]);
	});
});
