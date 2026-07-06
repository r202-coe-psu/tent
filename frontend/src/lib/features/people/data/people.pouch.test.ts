// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import PouchDB from 'pouchdb-browser';
import memory from 'pouchdb-adapter-memory';

PouchDB.plugin(memory);

// Must declare before vi.mock — closures capture the reference, not the value.
let testDb: PouchDB.Database;

vi.mock('$lib/db/shelter', () => ({
	SHELTER_CODE: 'SH001',
	SHELTER_DB: 'shelter_sh001',
	shelterDb: () => testDb
}));

vi.mock('$lib/db/pouch', () => ({
	namedLocalDb: () => testDb
}));

import { PeoplePouchRepository } from './people.pouch';
import type { EvacueeInput } from '../domain/people';

const ctx = { shelterCode: 'SH001', createdBy: 'tester' };

/** A valid evacuee input — factory fills the remaining fields from schema defaults. */
function evInput(over: Partial<EvacueeInput> = {}): EvacueeInput {
	return {
		first_name: 'Somchai',
		last_name: 'Jaidee',
		gender: 'male',
		phone: '0812345678',
		...over
	};
}

describe('PeoplePouchRepository', () => {
	let repo: PeoplePouchRepository;

	beforeEach(() => {
		testDb = new PouchDB(`test-${Math.random().toString(36).slice(2)}`, { adapter: 'memory' });
		repo = new PeoplePouchRepository();
	});

	afterEach(async () => {
		await testDb.destroy();
	});

	describe('createEvacuee', () => {
		it('persists the evacuee and returns it with an _id, _rev and correct type', async () => {
			const saved = await repo.createEvacuee(evInput(), ctx);

			expect(saved.type).toBe('evacuee');
			expect(saved._id).toMatch(/^evacuee:/);
			expect(saved._rev).toBeDefined();
			expect(saved.shelter_code).toBe('SH001');
			expect(saved.created_by).toBe('tester');

			const fetched = await repo.getEvacuee(saved._id);
			expect(fetched?.first_name).toBe('Somchai');
			// Envelope defaults applied by the factory.
			expect(fetched?.current_stay.status).toBe('registered');
			expect(fetched?.privacy.search_excluded).toBe(false);
		});

		it('writes a linked medical doc when medical fields are present', async () => {
			const saved = await repo.createEvacuee(
				evInput({ medical_conditions: ['diabetes'], medical_allergies: ['penicillin'] }),
				ctx
			);

			const medicals = await repo.listMedicals();
			expect(medicals).toHaveLength(1);
			expect(medicals[0].evacuee_id).toBe(saved._id);
			expect(medicals[0].conditions).toEqual(['diabetes']);
			expect(medicals[0].allergies).toEqual(['penicillin']);
		});

		it('does NOT write a medical doc when no medical fields are supplied', async () => {
			await repo.createEvacuee(evInput(), ctx);
			expect(await repo.listMedicals()).toHaveLength(0);
		});
	});

	describe('searchEvacuees', () => {
		beforeEach(async () => {
			await repo.createEvacuee(
				evInput({
					first_name: 'Somchai',
					last_name: 'Jaidee',
					phone: '0812345678',
					person_id: { cardType: 'national_id', number: '1103700123456' }
				}),
				ctx
			);
			await repo.createEvacuee(
				evInput({ first_name: 'Malee', last_name: 'Suksan', phone: '0899999999' }),
				ctx
			);
		});

		it('returns [] for an empty query', async () => {
			expect(await repo.searchEvacuees('   ')).toEqual([]);
		});

		it('matches on full name (case-insensitive)', async () => {
			const hits = await repo.searchEvacuees('SOMCHAI jaidee');
			expect(hits).toHaveLength(1);
			expect(hits[0].first_name).toBe('Somchai');
		});

		it('matches on phone ignoring formatting characters', async () => {
			const hits = await repo.searchEvacuees('081-234-5678');
			expect(hits).toHaveLength(1);
			expect(hits[0].phone).toBe('0812345678');
		});

		it('matches on the national ID number', async () => {
			const hits = await repo.searchEvacuees('00123');
			expect(hits).toHaveLength(1);
			expect(hits[0].person_id?.number).toBe('1103700123456');
		});

		it('excludes evacuees flagged privacy.search_excluded', async () => {
			const saved = await repo.createEvacuee(evInput({ first_name: 'Hidden' }), ctx);
			saved.privacy.search_excluded = true;
			await repo.updateEvacuee(saved);

			expect(await repo.searchEvacuees('Hidden')).toEqual([]);
		});
	});

	describe('updateEvacuee', () => {
		it('persists an edited field via a read-modify-write on the current _rev', async () => {
			const saved = await repo.createEvacuee(evInput(), ctx);
			const updated = await repo.updateEvacuee({ ...saved, first_name: 'Changed' });

			expect(updated._rev).not.toBe(saved._rev);
			const fetched = await repo.getEvacuee(saved._id);
			expect(fetched?.first_name).toBe('Changed');
		});
	});

	describe('listEvacueesPaginated', () => {
		it('slices the full list by page/pageSize', async () => {
			await repo.createEvacuee(evInput({ first_name: 'A' }), ctx);
			await repo.createEvacuee(evInput({ first_name: 'B' }), ctx);
			await repo.createEvacuee(evInput({ first_name: 'C' }), ctx);

			const page1 = await repo.listEvacueesPaginated(1, 2);
			expect(page1.total).toBe(3);
			expect(page1.totalPages).toBe(2);
			expect(page1.page).toBe(1);
			expect(page1.items).toHaveLength(2);

			const page2 = await repo.listEvacueesPaginated(2, 2);
			expect(page2.items).toHaveLength(1);
		});
	});

	describe('household + screening', () => {
		it('creates and reads back a household', async () => {
			const hh = await repo.createHousehold({ label: 'Baan Jaidee' }, ctx);
			expect(hh.type).toBe('household');

			expect(await repo.listHouseholds()).toHaveLength(1);
			expect((await repo.getHousehold(hh._id))?.label).toBe('Baan Jaidee');
		});

		it('creates and lists a screening', async () => {
			const ev = await repo.createEvacuee(evInput(), ctx);
			await repo.createScreening(
				{ evacuee_id: ev._id, symptoms: ['high_fever'], track: 'fast_track' },
				ctx
			);

			const screenings = await repo.listScreenings();
			expect(screenings).toHaveLength(1);
			expect(screenings[0].evacuee_id).toBe(ev._id);
			expect(screenings[0].track).toBe('fast_track');
		});
	});
});
