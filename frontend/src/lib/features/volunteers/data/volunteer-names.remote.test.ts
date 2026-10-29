import { beforeEach, describe, expect, it, vi } from 'vitest';

const couch = await vi.hoisted(async () => {
	const { createInMemoryCouch } = await import('$lib/testing/in-memory-couch');
	return createInMemoryCouch();
});

vi.mock('$lib/db/couch-db', () => couch.couchDbModule);
vi.mock('$lib/db/shelter', () => ({
	getShelterDb: (code = 'SH001') => `shelter_${code.toLowerCase()}`
}));

import type { AuthorContext } from '$lib/db/model';
import { makeVolunteer, type VolunteerInput } from '../domain/volunteer.schema';
import { getVolunteerNamesByIds, uniqueVolunteerIds } from './volunteer-names.remote';

const ctx: AuthorContext = { shelterCode: 'SH001', createdBy: 'tester' };

let code = 0;
function seed(first_name: string): string {
	code += 1;
	const input: VolunteerInput = {
		first_name,
		last_name: 'ใจดี',
		phone: '0812345678',
		skills: ['ขับรถ'],
		source: 'walk_in',
		national_id: null
	};
	const doc = makeVolunteer(input, ctx, { volunteer_code: `V-${String(code).padStart(3, '0')}` });
	couch.store.set(doc._id, doc as never);
	return doc._id;
}

describe('getVolunteerNamesByIds', () => {
	beforeEach(() => {
		couch.reset();
	});

	it('requests a name-only projection through _find with an _id $in selector', async () => {
		const a = seed('สมชาย');

		await getVolunteerNamesByIds([a]);

		expect(couch.findQueries).toEqual([
			{
				dbName: 'shelter_sh001',
				selector: { _id: { $gte: a, $lte: a, $in: [a] } },
				fields: ['_id', 'first_name', 'last_name'],
				limit: 1
			}
		]);
	});

	it('returns only the requested volunteers and only name fields', async () => {
		const a = seed('สมชาย');
		const b = seed('สมหญิง');
		seed('ไม่ได้ขอ');

		const out = await getVolunteerNamesByIds([a, b]);

		expect(out.map((r) => r._id).sort()).toEqual([a, b].sort());
		expect(out.find((r) => r._id === a)).toEqual({
			_id: a,
			first_name: 'สมชาย',
			last_name: 'ใจดี'
		});
		for (const record of out) {
			expect(Object.keys(record).sort()).toEqual(['_id', 'first_name', 'last_name']);
		}
	});

	it('ignores ids without the volunteer prefix and omits missing docs', async () => {
		const a = seed('สมชาย');

		const out = await getVolunteerNamesByIds([a, 'evacuee:x', 'volunteer:missing']);

		expect(out.map((r) => r._id)).toEqual([a]);
		const sorted = [a, 'volunteer:missing'].sort();
		expect(couch.findQueries[0].selector).toEqual({
			_id: { $gte: sorted[0], $lte: sorted[1], $in: sorted }
		});
	});

	it('reads the named shelter database and skips the read for an empty id list', async () => {
		const a = seed('สมชาย');

		await getVolunteerNamesByIds([a], 'SH007');
		expect(couch.findQueries[0].dbName).toBe('shelter_sh007');

		couch.findQueries.length = 0;
		expect(await getVolunteerNamesByIds(['evacuee:x'])).toEqual([]);
		expect(couch.findQueries).toEqual([]);
	});

	it('reads the ids in chunks of 100 keys with limit equal to the chunk length', async () => {
		const ids = Array.from({ length: 230 }, (_, i) => `volunteer:${String(i).padStart(4, '0')}`);

		await getVolunteerNamesByIds(ids);

		const sizes = couch.findQueries.map((q) => (q.selector._id as { $in: string[] }).$in.length);
		expect(sizes).toEqual([100, 100, 30]);
		expect(couch.findQueries.map((q) => q.limit)).toEqual(sizes);
	});

	it('bounds each chunk with $gte = first id and $lte = last id next to $in', async () => {
		const ids = Array.from({ length: 230 }, (_, i) => `volunteer:${String(i).padStart(4, '0')}`);

		await getVolunteerNamesByIds([...ids].reverse());

		const sorted = [...ids].sort();
		const expected = [sorted.slice(0, 100), sorted.slice(100, 200), sorted.slice(200)];
		expect(couch.findQueries.map((q) => q.selector)).toEqual(
			expected.map((chunk) => ({ _id: { $gte: chunk[0], $lte: chunk.at(-1), $in: chunk } }))
		);
	});
});

describe('uniqueVolunteerIds', () => {
	it('dedupes, sorts and drops other prefixes', () => {
		expect(uniqueVolunteerIds(['volunteer:b', 'volunteer:a', 'volunteer:b', 'evacuee:c'])).toEqual([
			'volunteer:a',
			'volunteer:b'
		]);
	});
});
