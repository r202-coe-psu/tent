import { describe, expect, it } from 'vitest';
import {
	DISTRIBUTE_NOTE_MAX,
	isCustomDestination,
	listDestinationOptions
} from './distribute-destination';

describe('listDestinationOptions (CR-143 FR-E2)', () => {
	it('lists storage points first, then active zones, in form order', () => {
		expect(
			listDestinationOptions({
				storagePoints: [{ name: 'ครัวกลาง' }, { name: 'ห้องพยาบาล' }],
				zones: [
					{ name: 'โซน A', status: 'active' },
					{ name: 'โซน B', status: 'active' }
				]
			})
		).toEqual(['ครัวกลาง', 'ห้องพยาบาล', 'โซน A', 'โซน B']);
	});

	it('skips closed zones, blank names and duplicates (trimmed)', () => {
		expect(
			listDestinationOptions({
				storagePoints: [{ name: ' ครัวกลาง ' }, { name: '  ' }],
				zones: [
					{ name: 'ครัวกลาง', status: 'active' },
					{ name: 'โซน C', status: 'closed' },
					{ name: 'โซน D' }
				]
			})
		).toEqual(['ครัวกลาง', 'โซน D']);
	});

	it('is empty when the shelter has neither storage points nor zones', () => {
		expect(listDestinationOptions({ storagePoints: [], zones: [] })).toEqual([]);
		expect(listDestinationOptions({})).toEqual([]);
	});

	it('drops options too long to be saved as a note', () => {
		const long = 'ก'.repeat(DISTRIBUTE_NOTE_MAX + 1);
		expect(listDestinationOptions({ storagePoints: [{ name: long }, { name: 'ครัว' }] })).toEqual([
			'ครัว'
		]);
	});
});

describe('isCustomDestination', () => {
	const options = ['ครัวกลาง', 'โซน A'];

	it('is true only for a non-empty value that is not a chip', () => {
		expect(isCustomDestination('ที่อื่น', options)).toBe(true);
		expect(isCustomDestination('ครัวกลาง', options)).toBe(false);
		expect(isCustomDestination('', options)).toBe(false);
		expect(isCustomDestination(undefined, options)).toBe(false);
	});
});
