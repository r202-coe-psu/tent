import { describe, it, expect } from 'vitest';
import {
	readResidenceSuggestDeps,
	residenceSuggestTick
} from './residence-suggest-reactivity.svelte';

describe('residenceSuggestTick (FR-03b-H)', () => {
	const matching = {
		_id: 'household:1',
		label: 'ครอบครัวสมศรี',
		address_no: '123/45',
		village_no: 'หมู่ 2',
		subdistrict: 'คลองแห',
		district: 'หาดใหญ่',
		province: 'สงขลา'
	};

	const completeForm = {
		address_no: '123/45',
		village_no: 'หมู่ 2',
		subdistrict: 'คลองแห',
		district: 'หาดใหญ่',
		province: 'สงขลา',
		postal_code: '90110'
	};

	it('snapshots nested fields so later mutations do not rewrite prior deps', () => {
		const form = { ...completeForm };
		const snap = readResidenceSuggestDeps('create', form, [matching], false);
		expect(snap.form.address_no).toBe('123/45');
		form.address_no = '999';
		expect(snap.form.address_no).toBe('123/45');
	});

	it('returns pending while households are loading with a complete Residence', () => {
		expect(
			residenceSuggestTick(readResidenceSuggestDeps('create', completeForm, [], true))
		).toEqual({ kind: 'pending' });
	});

	it('returns matches after load when Residence is complete (exact address)', () => {
		const tick = residenceSuggestTick(
			readResidenceSuggestDeps('create', completeForm, [matching], false)
		);
		expect(tick).toEqual({ kind: 'result', matches: [matching] });
	});

	it('clears when Residence is incomplete even if households exist', () => {
		expect(
			residenceSuggestTick(
				readResidenceSuggestDeps('create', { address_no: '123' }, [matching], false)
			)
		).toEqual({ kind: 'clear' });
	});

	it('recomputes when nested fields change between snapshots (suggest regression)', () => {
		const mutable = {
			address_no: '',
			village_no: '',
			subdistrict: 'คลองแห',
			district: 'หาดใหญ่',
			province: 'สงขลา',
			postal_code: ''
		};
		expect(
			residenceSuggestTick(readResidenceSuggestDeps('create', mutable, [matching], false)).kind
		).toBe('clear');

		mutable.address_no = '123/45';
		mutable.village_no = 'หมู่ 2';
		const after = residenceSuggestTick(
			readResidenceSuggestDeps('create', mutable, [matching], false)
		);
		expect(after.kind).toBe('result');
		if (after.kind === 'result') {
			expect(after.matches.map((h) => h._id)).toEqual(['household:1']);
		}
	});
});
