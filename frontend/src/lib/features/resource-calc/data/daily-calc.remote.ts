/**
 * T-31.4 — remote (CouchDB) implementation of the daily resource-calc repository.
 *
 * Reads the three calc inputs through peer BARRELS only (never raw peer docs, never
 * a whole-collection `_all_docs` scan of another feature):
 *   - occupancy       → `people`      (active/present headcount)
 *   - effective ratio → `sop-ratios`  (`getActiveSopProfile`: override ?? master)
 *   - stock balance   → `operations`  (`getBalance`)
 * feeds them to the pure engine (`resource-calc/domain`), then persists a
 * snapshot-locked, deterministically-keyed `daily_calc:{date}` doc.
 */
import { couchDbFetch, getDoc, putDoc } from '$lib/db/couch-db';
import { getShelterDb } from '$lib/db/shelter';
import { makeDoc, now, type AuthorContext } from '$lib/db/model';
import { peopleRepository, type Evacuee } from '$lib/features/people';
import { operationsRepository } from '$lib/features/operations';
import { getActiveSopProfile, SOP_RATIO_KIND, type SopRatioKey } from '$lib/features/sop-ratios';
import { createAuditEntry } from '$lib/features/shared';
import { calculateResources, FORMULA_V, type ResourceInput } from '../domain/calc.formula';
import {
	dailyCalcDocSchema,
	DAILY_CALC_SCHEMA_VERSION,
	type DailyCalcDoc
} from '../domain/calc.schema';
import {
	dailyCalcDocId,
	isDailyCalcRecord,
	type DailyCalcRecord,
	type DailyCalcRepository
} from './daily-calc.repository';

/** Minimal shape of a bounded `_all_docs?include_docs=true` response. */
interface AllDocsResponse {
	rows: Array<{ id: string; doc?: unknown }>;
}

/** Count of evacuees physically present (`active`) — the occupancy input (T-06 denormalized stay). */
export function countActive(evacuees: Evacuee[]): number {
	return evacuees.filter((e) => e.current_stay?.status === 'active').length;
}

/**
 * Turn the effective SOP ratios + stock balance into the engine's per-resource inputs,
 * and capture the ratio/stock snapshots frozen at calc time.
 *
 * SEAM — the SOP-ratio-key → stock-item / facility-count mapping is not yet specified
 * (docs/data TBD). Until it lands, `have` is a best-effort direct lookup by ratio key;
 * unmapped resources resolve to `null` and the engine reports `data_status:'stock_unsynced'`
 * rather than a false zero. `threshold` ratios are quality ceilings, not quantities, so they
 * carry no `have`. Replace `resolveHave` once the mapping is defined.
 */
function resolveHave(
	key: SopRatioKey,
	kind: (typeof SOP_RATIO_KIND)[SopRatioKey],
	stock: Map<string, string>
): number | null {
	if (kind === 'threshold') return null;
	const raw = stock.get(key);
	if (raw == null) return null;
	// daily_calc still snapshots IEEE numbers (CR-038 follow-up); coerce at boundary
	const n = Number(raw);
	return Number.isFinite(n) ? n : null;
}

function buildResources(
	ratios: Record<SopRatioKey, string>,
	stock: Map<string, string>
): {
	resources: ResourceInput[];
	ratioSnapshot: Record<string, number>;
	stockSnapshot: Record<string, number | null>;
} {
	const resources: ResourceInput[] = [];
	const ratioSnapshot: Record<string, number> = {};
	const stockSnapshot: Record<string, number | null> = {};

	for (const key of Object.keys(ratios) as SopRatioKey[]) {
		const ratioStr = ratios[key];
		const ratio = Number(ratioStr);
		const kind = SOP_RATIO_KIND[key];
		const have = resolveHave(key, kind, stock);
		resources.push({ key, kind, ratio, have });
		ratioSnapshot[key] = ratio;
		stockSnapshot[key] = have;
	}

	return { resources, ratioSnapshot, stockSnapshot };
}

export class DailyCalcRemoteRepository implements DailyCalcRepository {
	constructor(private readonly dbName: string = getShelterDb()) {}

	async get(date: string): Promise<DailyCalcRecord | null> {
		return getDoc<DailyCalcRecord>(this.dbName, dailyCalcDocId(date));
	}

	async runOnDemand(date: string, ctx: AuthorContext): Promise<DailyCalcRecord> {
		const asOf = now();

		// 1. Read all three inputs through peer barrels (parallel).
		const [evacuees, active, stock] = await Promise.all([
			peopleRepository().listEvacuees(),
			getActiveSopProfile(),
			operationsRepository().getBalance()
		]);

		if (!active) {
			throw new Error(
				'No active SOP profile (master/override) for this shelter — cannot compute daily resource calc'
			);
		}

		const occupancy = countActive(evacuees);
		const { resources, ratioSnapshot, stockSnapshot } = buildResources(active.ratios, stock);

		// 2. Pure engine.
		const results = calculateResources({ occupancy, as_of: asOf, resources });

		// 3. Snapshot-locked body — validated against the domain schema before persisting.
		const body: DailyCalcDoc = dailyCalcDocSchema.parse({
			formula_v: FORMULA_V,
			sop_profile_version: active.version,
			ratio_snapshot: ratioSnapshot,
			occupancy_snapshot: occupancy,
			as_of: asOf,
			stock_snapshot: stockSnapshot,
			results
		});

		// 4. Deterministic id → idempotent write.
		const existing = await this.get(date);

		// 4a. Preserve the losing revision into audit:retro_edit BEFORE overwriting, so a
		//     retroactive recalculation is durable and never silently lossy.
		if (existing) {
			const audit = createAuditEntry(
				{
					action: 'retro_edit',
					target_type: 'daily_calc',
					target_id: existing._id,
					reason: `Recalculated daily resource snapshot for ${date}`,
					context: {
						overwritten_rev: existing._rev ?? null,
						previous: {
							formula_v: existing.formula_v,
							sop_profile_version: existing.sop_profile_version,
							occupancy_snapshot: existing.occupancy_snapshot,
							as_of: existing.as_of,
							results: existing.results
						}
					}
				},
				ctx
			);
			await putDoc(this.dbName, audit);
		}

		// 4b. Mint (create) or overwrite (carry _rev + created_at, bump updated_at) the record.
		const record: DailyCalcRecord = existing
			? { ...existing, ...body, updated_at: now() }
			: makeDoc('daily_calc', DAILY_CALC_SCHEMA_VERSION, body, ctx, date);

		return putDoc(this.dbName, record);
	}

	async listRange(from: string, to: string): Promise<DailyCalcRecord[]> {
		// Bounded range over the deterministic ids — NOT a whole-collection scan.
		const startkey = JSON.stringify(dailyCalcDocId(from));
		const endkey = JSON.stringify(`${dailyCalcDocId(to)}\ufff0`);
		const res = await couchDbFetch<AllDocsResponse>(
			this.dbName,
			`/_all_docs?include_docs=true&startkey=${encodeURIComponent(startkey)}&endkey=${encodeURIComponent(endkey)}`
		);
		return res.rows
			.map((r) => r.doc)
			.filter(isDailyCalcRecord)
			.sort((a, b) => a._id.localeCompare(b._id));
	}
}

let singleton: DailyCalcRepository | null = null;
let singletonDbName: string | null = null;

export function dailyCalcRepository(): DailyCalcRepository {
	const currentDb = getShelterDb();
	if (!singleton || singletonDbName !== currentDb) {
		singleton = new DailyCalcRemoteRepository(currentDb);
		singletonDbName = currentDb;
	}
	return singleton;
}
