import { describe, expect, it } from 'vitest';
import type { Evacuee, Household, Movement } from '$lib/features/people/domain/people';
import { buildPeople, type PeopleBuildConfig } from './people-builder';
import { initStagingFaker } from './people-faker';

const SEED = 4242;

function config(overrides: Partial<PeopleBuildConfig> = {}): PeopleBuildConfig {
	return {
		shelterCode: 'SH009',
		idPrefix: 'seed-bulk',
		padWidth: 6,
		zones: ['Z1', 'Z2', 'Z3'],
		faker: initStagingFaker(SEED),
		vulnerableGroupCode: (key) => key,
		transferDestCode: 'SH001',
		allowPets: true,
		...overrides
	};
}

/** Docs carry wall-clock timestamps; everything else must be reproducible. */
function stable(docs: unknown): unknown {
	return JSON.parse(JSON.stringify(docs).replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/g, 'TS'));
}

function build(total: number, overrides: Partial<PeopleBuildConfig> = {}) {
	return buildPeople(config(overrides), { personIndex: 0, householdIndex: 0 }, total, total);
}

const ofType = <T extends { type: string }>(docs: Array<{ type: string }>, type: string) =>
	docs.filter((d) => d.type === type) as T[];

describe('buildPeople', () => {
	it('is deterministic for a fixed faker seed', () => {
		const first = build(60);
		const second = build(60);
		expect(stable(second.docs)).toEqual(stable(first.docs));
	});

	it('builds exactly the requested number of evacuees, split into households', () => {
		const { docs, personIndex, householdIndex } = build(75);
		const evacuees = ofType<Evacuee>(docs, 'evacuee');
		const households = ofType<Household>(docs, 'household');

		expect(evacuees).toHaveLength(75);
		expect(personIndex).toBe(75);
		expect(householdIndex).toBe(households.length);
		for (const hh of households) {
			expect(evacuees.filter((e) => e.household_id === hh._id).length).toBeGreaterThan(0);
		}
	});

	it('uses the bulk id scheme: prefix, slug and 6-digit padding', () => {
		const { docs } = build(5);
		expect(docs[0]._id).toBe('household:seed-bulk:sh009:hh-000000');
		const evacuees = ofType<Evacuee>(docs, 'evacuee');
		expect(evacuees.map((e) => e._id).slice(0, 2)).toEqual([
			'evacuee:seed-bulk:sh009:000000',
			'evacuee:seed-bulk:sh009:000001'
		]);
		for (const m of ofType<Movement>(docs, 'movement')) {
			expect(m._id).toMatch(/^movement:seed-bulk:sh009:\d{6}-(in|leave|out|xfer|dec|room)$/);
		}
	});

	it('uses the staging id scheme when configured with its prefix and 4-digit padding', () => {
		const { docs } = build(5, { idPrefix: 'seed-st', padWidth: 4 });
		expect(docs[0]._id).toBe('household:seed-st:sh009:hh-0000');
		expect(ofType<Evacuee>(docs, 'evacuee')[0]._id).toBe('evacuee:seed-st:sh009:0000');
	});

	it('links every movement and evacuee to documents that exist in the same build', () => {
		const { docs } = build(200);
		const evacueeIds = new Set(ofType<Evacuee>(docs, 'evacuee').map((e) => e._id));
		const householdIds = new Set(ofType<Household>(docs, 'household').map((h) => h._id));

		expect(ofType<Movement>(docs, 'movement').length).toBeGreaterThan(0);
		for (const m of ofType<Movement>(docs, 'movement')) expect(evacueeIds).toContain(m.evacuee_id);
		for (const e of ofType<Evacuee>(docs, 'evacuee'))
			expect(householdIds).toContain(e.household_id);
		for (const h of ofType<Household>(docs, 'household'))
			expect(evacueeIds).toContain(h.head_evacuee_id);
	});

	it('produces the same docs whether built in one piece or resumed from a cursor', () => {
		const whole = build(120);

		const cfg = config();
		const firstPiece = buildPeople(cfg, { personIndex: 0, householdIndex: 0 }, 40, 120);
		const secondPiece = buildPeople(
			cfg,
			{ personIndex: firstPiece.personIndex, householdIndex: firstPiece.householdIndex },
			120,
			120
		);

		// A piece ends on a household boundary, so it may run past the requested stop.
		expect(firstPiece.personIndex).toBeGreaterThanOrEqual(40);
		expect(stable([...firstPiece.docs, ...secondPiece.docs])).toEqual(stable(whole.docs));
	});

	it('moves transferred evacuees to the configured destination shelter', () => {
		const { docs } = build(400, { transferDestCode: 'SH777' });
		const transfers = ofType<Movement>(docs, 'movement').filter((m) => m.action === 'transfer_out');
		expect(transfers.length).toBeGreaterThan(0);
		for (const t of transfers)
			expect(t.destination).toEqual({ kind: 'shelter', shelter_code: 'SH777' });
	});

	it('gives no household pets when the shelter does not allow them', () => {
		const { docs } = build(300, { allowPets: false });
		for (const h of ofType<Household>(docs, 'household')) expect(h.pets).toEqual([]);
	});

	it('throws when a vulnerable group key cannot be resolved', () => {
		const missing = (key: string): string => {
			throw new Error(`vulnerable_group "${key}" missing`);
		};
		expect(() => build(300, { vulnerableGroupCode: missing })).toThrow(/vulnerable_group/);
	});
});
