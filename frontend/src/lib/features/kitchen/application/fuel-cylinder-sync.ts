import type { AuthorContext } from '$lib/db/model';
import { kitchenRepository } from '../data/kitchen.remote';

const inFlight = new Map<string, Promise<number>>();

export interface EnsureFuelCylindersOptions {
	capacityKg?: string;
	burnRateKgPerHour?: string;
	timeMultiplier?: string;
}

function nextFreeCode(used: Set<string>, start: number): { code: string; next: number } {
	let seq = start;
	while (used.has(`LPG-${String(seq).padStart(2, '0')}`)) seq += 1;
	return { code: `LPG-${String(seq).padStart(2, '0')}`, next: seq + 1 };
}

/**
 * Tops up `fuel_cylinder` docs for an item_master until there are at least
 * `targetCount` of them. Idempotent: always re-reads the live cylinder list
 * and only creates the shortfall, so repeated calls converge instead of
 * double-creating. Calls for the same item are serialised within the tab.
 * Returns how many cylinders were created.
 */
export function ensureFuelCylinders(
	itemMasterId: string,
	targetCount: number,
	ctx: AuthorContext,
	options: EnsureFuelCylindersOptions = {}
): Promise<number> {
	const previous = inFlight.get(itemMasterId) ?? Promise.resolve(0);
	const run = previous
		.catch(() => 0)
		.then(async () => {
			const repo = kitchenRepository();
			const cylinders = await repo.listFuelCylinders();
			const existing = cylinders.filter((c) => c.item_master_id === itemMasterId).length;
			const missing = Math.max(0, Math.floor(targetCount) - existing);
			const used = new Set(cylinders.map((c) => c.cylinder_code.toUpperCase()));
			let seq = 1;
			for (let i = 0; i < missing; i++) {
				const { code, next } = nextFreeCode(used, seq);
				used.add(code);
				seq = next;
				// No initial refill: a cylinder with zero gas_ledger entries is
				// already full by definition (gasCylinderBalance starts at capacity).
				await repo.createFuelCylinder(
					{
						item_master_id: itemMasterId,
						cylinder_code: code,
						name: `ถังแก๊ส ${code}`,
						capacity_kg: options.capacityKg ?? '15',
						burn_rate_kg_per_hour: options.burnRateKgPerHour ?? '0.5',
						time_multiplier: options.timeMultiplier ?? '1',
						deactivated: false
					},
					ctx
				);
			}
			return missing;
		});
	inFlight.set(itemMasterId, run);
	void run.finally(() => {
		if (inFlight.get(itemMasterId) === run) inFlight.delete(itemMasterId);
	});
	return run;
}
