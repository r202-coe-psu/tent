/**
 * T-31.10 demo — Scenario 2 (illustrative, formula-direct).
 *
 * Scenario 1 (real seeded data) never exercises the ok/gap/surplus branches because `have` is
 * always null with today's real data (the resolveHave stock-mapping seam — see the demo doc's
 * Known Limitation). This script calls the REAL `calculateResources()` with hand-picked `have`
 * values to prove those branches work. Not wired to any DB — pure domain call, no I/O.
 *
 * Usage: pnpm tsx --tsconfig .svelte-kit/tsconfig.json scripts/demo/t31-scenario-2-illustrative.ts
 */
import {
	calculateResources,
	type ResourceInput
} from '$lib/features/resource-calc/domain/calc.formula';

const OCCUPANCY = 10;
const AS_OF = new Date().toISOString();

const resources: ResourceInput[] = [
	{ key: 'water_l_per_person_day', kind: 'multiply', ratio: '15', have: '100' }, // need 150 > have 100 -> gap
	{ key: 'drinking_water_l_per_person_day', kind: 'multiply', ratio: '3', have: '50' }, // need 30 < have 50 -> surplus
	{ key: 'cooking_water_l_per_person_day', kind: 'multiply', ratio: '6', have: '60' }, // need 60 = have 60 -> ok
	{ key: 'people_per_toilet_female', kind: 'divide', ratio: '20', have: '0' }, // need 1 > have 0 -> gap
	{ key: 'people_per_tap', kind: 'divide', ratio: '80', have: '1' }, // need 1 = have 1 -> ok
	{ key: 'people_per_volunteer', kind: 'divide', ratio: '50', have: '2' } // need 1 < have 2 -> surplus
];

const results = calculateResources({ occupancy: OCCUPANCY, as_of: AS_OF, resources });

console.log(`occupancy=${OCCUPANCY}\n`);
for (const r of results) {
	console.log(
		`${r.key.padEnd(32)} kind=${r.kind.padEnd(8)} need=${String(r.need).padStart(4)} have=${String(r.have).padStart(4)} -> status=${r.status}`
	);
}
