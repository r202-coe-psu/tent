import { beforeEach, describe, expect, it, vi } from 'vitest';

const couch = await vi.hoisted(async () => {
	const { createInMemoryCouch } = await import('$lib/testing/in-memory-couch');
	return createInMemoryCouch();
});
const byIds = vi.hoisted(() => vi.fn());

vi.mock('$lib/db/couch-db', () => ({
	...couch.couchDbModule,
	allDocsByIds: (...args: unknown[]) => {
		byIds(...args);
		return (couch.couchDbModule.allDocsByIds as (...a: unknown[]) => unknown)(...args);
	}
}));
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
		byIds.mockClear();
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
		expect(byIds.mock.calls[0][1]).toEqual([a, 'evacuee:missing'].sort());
	});

	it('reads the named shelter database and skips the read for an empty id list', async () => {
		const a = seed({ first_name: 'สมชาย' });

		await getEvacueeNamesByIds([a], 'SH007');
		expect(byIds.mock.calls[0][0]).toBe('shelter_sh007');

		byIds.mockClear();
		expect(await getEvacueeNamesByIds(['volunteer:x'])).toEqual([]);
		expect(byIds).not.toHaveBeenCalled();
	});

	it('reads the ids in chunks of 100 keys', async () => {
		const ids = Array.from({ length: 230 }, (_, i) => `evacuee:${String(i).padStart(4, '0')}`);

		await getEvacueeNamesByIds(ids);

		expect(byIds.mock.calls.map((call) => (call[1] as string[]).length)).toEqual([100, 100, 30]);
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
