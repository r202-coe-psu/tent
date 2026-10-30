import { beforeEach, describe, expect, it, vi } from 'vitest';

const couch = await vi.hoisted(async () => {
	const { createInMemoryCouch } = await import('$lib/testing/in-memory-couch');
	return createInMemoryCouch();
});

vi.mock('$lib/db/couch-db', () => couch.couchDbModule);
vi.mock('$lib/db/shelter', () => ({
	getShelterDb: (code = 'SH001') => `shelter_${code.toLowerCase()}`
}));

import { createEvacuee, type EvacueeInput } from '../domain/people';
import { getEvacueeNamesByIds, uniqueEvacueeIds } from './evacuee-names.remote';

const ctx = { shelterCode: 'SH001', createdBy: 'tester' };

function seed(input: Partial<EvacueeInput> & { first_name: string }): string {
	const doc = createEvacuee(
		{ last_name: 'ใจดี', gender: 'male', phone: '0812345678', ...input },
		ctx,
		null
	);
	couch.store.set(doc._id, doc as never);
	return doc._id;
}

describe('getEvacueeNamesByIds', () => {
	beforeEach(() => {
		couch.reset();
	});

	it('requests a name-only projection through _find with an _id $in selector', async () => {
		const a = seed({ first_name: 'สมชาย', phone: '0899999999' });
		const phoneBefore = (couch.store.get(a) as { phone?: string }).phone;
		expect(phoneBefore).toBe('0899999999');

		await getEvacueeNamesByIds([a]);

		expect(couch.findQueries).toEqual([
			{
				dbName: 'shelter_sh001',
				selector: { _id: { $gte: a, $lte: a, $in: [a] } },
				fields: ['_id', 'first_name', 'last_name', 'nickname'],
				limit: 1
			}
		]);
	});

	it('returns only the requested evacuees and only name fields', async () => {
		const a = seed({ first_name: 'สมชาย', nickname: 'ชาย' });
		const b = seed({ first_name: 'สมหญิง' });
		seed({ first_name: 'ไม่ได้ขอ' });

		const out = await getEvacueeNamesByIds([a, b]);

		expect(out.map((r) => r._id).sort()).toEqual([a, b].sort());
		for (const record of out) {
			expect(
				Object.keys(record).every((k) => ['_id', 'first_name', 'last_name', 'nickname'].includes(k))
			).toBe(true);
		}
		expect(out.find((r) => r._id === a)).toEqual({
			_id: a,
			first_name: 'สมชาย',
			last_name: 'ใจดี',
			nickname: 'ชาย'
		});
		expect(out.find((r) => r._id === b)).toEqual({
			_id: b,
			first_name: 'สมหญิง',
			last_name: 'ใจดี'
		});
	});

	it('ignores ids without the evacuee prefix and omits missing docs', async () => {
		const a = seed({ first_name: 'สมชาย' });

		const out = await getEvacueeNamesByIds([a, 'volunteer:x', 'household:y', 'evacuee:missing']);

		expect(out.map((r) => r._id)).toEqual([a]);
		const sorted = [a, 'evacuee:missing'].sort();
		expect(couch.findQueries[0].selector).toEqual({
			_id: { $gte: sorted[0], $lte: sorted[1], $in: sorted }
		});
	});

	it('reads the named shelter database and skips the read for an empty id list', async () => {
		const a = seed({ first_name: 'สมชาย' });

		await getEvacueeNamesByIds([a], 'SH007');
		expect(couch.findQueries[0].dbName).toBe('shelter_sh007');

		couch.findQueries.length = 0;
		expect(await getEvacueeNamesByIds(['volunteer:x'])).toEqual([]);
		expect(couch.findQueries).toEqual([]);
	});

	it('reads the ids in chunks of 100 keys with limit equal to the chunk length', async () => {
		const ids = Array.from({ length: 230 }, (_, i) => `evacuee:${String(i).padStart(4, '0')}`);

		await getEvacueeNamesByIds(ids);

		const sizes = couch.findQueries.map((q) => (q.selector._id as { $in: string[] }).$in.length);
		expect(sizes).toEqual([100, 100, 30]);
		expect(couch.findQueries.map((q) => q.limit)).toEqual(sizes);
	});

	it('bounds each chunk with $gte = first id and $lte = last id next to $in', async () => {
		const ids = Array.from({ length: 230 }, (_, i) => `evacuee:${String(i).padStart(4, '0')}`);

		await getEvacueeNamesByIds([...ids].reverse());

		const sorted = [...ids].sort();
		const expected = [sorted.slice(0, 100), sorted.slice(100, 200), sorted.slice(200)];
		expect(couch.findQueries.map((q) => q.selector)).toEqual(
			expected.map((chunk) => ({ _id: { $gte: chunk[0], $lte: chunk.at(-1), $in: chunk } }))
		);
	});

	it('makes the in-memory _find throw on an operator it does not support', async () => {
		await expect(
			couch.couchDbModule.findDocs('shelter_sh001', { selector: { _id: { $regex: '^evacuee:' } } })
		).rejects.toThrow('unsupported operator $regex');
	});
});

describe('uniqueEvacueeIds', () => {
	it('dedupes, sorts and drops other prefixes', () => {
		expect(uniqueEvacueeIds(['evacuee:b', 'evacuee:a', 'evacuee:b', 'volunteer:c'])).toEqual([
			'evacuee:a',
			'evacuee:b'
		]);
	});
});
