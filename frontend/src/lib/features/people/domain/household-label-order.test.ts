import { describe, expect, it } from 'vitest';
import { headFirst } from './household-label-order';

const people = ['a', 'b', 'c'].map((id) => ({ _id: `evacuee:${id}` }));
const ids = (list: readonly { _id: string }[]) => list.map((p) => p._id);

describe('headFirst', () => {
	it('moves the household head to the front and keeps everyone else in order', () => {
		expect(ids(headFirst(people, 'evacuee:c'))).toEqual(['evacuee:c', 'evacuee:a', 'evacuee:b']);
	});

	it('treats the first member as head when the household names none', () => {
		expect(ids(headFirst(people, null))).toEqual(['evacuee:a', 'evacuee:b', 'evacuee:c']);
	});

	it('keeps the order when the named head is not among the members', () => {
		expect(ids(headFirst(people, 'evacuee:zzz'))).toEqual(['evacuee:a', 'evacuee:b', 'evacuee:c']);
	});
});
