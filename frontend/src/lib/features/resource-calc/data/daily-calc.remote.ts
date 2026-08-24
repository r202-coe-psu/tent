/**
 * T-31.4 — remote (CouchDB) implementation of the daily resource-calc repository.
 *
 * Reads the four calc inputs through peer BARRELS only (never raw peer docs, never
 * a whole-collection `_all_docs` scan of another feature):
 *   - occupancy       → `people`      (active/present headcount)
 *   - effective ratio → `sop-ratios`  (`getActiveSopProfile`: override ?? master)
 *   - stock balance   → `operations`  (`getBalance`)
 *   - facilities/area → `shelters`    (`getShelter`)
 * feeds them to the pure engine (`resource-calc/domain`), then persists a
 * snapshot-locked, deterministically-keyed `daily_calc:{date}` doc.
 */
import { couchDbFetch, getDoc, putDoc } from '$lib/db/couch-db';
import { getShelterDb } from '$lib/db/shelter';
import { makeDoc, now, type AuthorContext } from '$lib/db/model';
import { createAuditEntry } from '$lib/features/shared';
import { calculateResources } from '../domain/calc.formula';
import { DAILY_CALC_SCHEMA_VERSION, type DailyCalcDoc } from '../domain/calc.schema';
import { DailyCalcReadError, canonicalDailyCalcDocSchema } from './daily-calc.validation';
import {
	dailyCalcDocId,
	parseDailyCalc,
	type DailyCalcRecord,
	type DailyCalcRepository
} from './daily-calc.repository';
import { countActive, loadCalculationSnapshot } from './calculation-snapshot';

/** Minimal shape of a bounded `_all_docs?include_docs=true` response. */
interface AllDocsResponse {
	rows: Array<{ id: string; doc?: unknown }>;
}

export { countActive };

export class DailyCalcRemoteRepository implements DailyCalcRepository {
	constructor(private readonly dbName: string = getShelterDb()) {}

	async get(date: string): Promise<DailyCalcRecord | null> {
		const id = dailyCalcDocId(date);
		const raw = await getDoc<{ _id: string }>(this.dbName, id);
		if (raw === null) return null;
		const record = parseDailyCalc(raw);
		if (record._id !== id) {
			throw new DailyCalcReadError('invalid_invariant', record._id, `expected document id ${id}`);
		}
		return record;
	}

	async runOnDemand(date: string, ctx: AuthorContext): Promise<DailyCalcRecord> {
		const snapshot = await loadCalculationSnapshot(ctx.shelterCode);

		// 2. Pure engine.
		const results = calculateResources({
			occupancy: snapshot.current_occupancy,
			as_of: snapshot.as_of,
			resources: snapshot.resource_inputs
		});

		// 3. Snapshot-locked body — validated against the domain schema before persisting.
		const body: DailyCalcDoc = canonicalDailyCalcDocSchema.parse({
			formula_v: snapshot.formula_v,
			sop_profile_version: snapshot.profile.effective_version,
			ratio_source: snapshot.profile.ratio_source,
			sop_override_id: snapshot.profile.override_id,
			sop_override_version: snapshot.profile.override_version,
			ratio_snapshot: snapshot.current_ratios,
			occupancy_snapshot: snapshot.current_occupancy,
			as_of: snapshot.as_of,
			stock_snapshot: snapshot.stock_snapshot,
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
							ratio_source: existing.ratio_source,
							sop_override_id: existing.sop_override_id,
							sop_override_version: existing.sop_override_version,
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
			? { ...existing, ...body, schema_v: DAILY_CALC_SCHEMA_VERSION, updated_at: now() }
			: makeDoc('daily_calc', DAILY_CALC_SCHEMA_VERSION, body, ctx, date);

		return parseDailyCalc(await putDoc(this.dbName, record));
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
			.map((r) => {
				if (!r.doc) {
					throw new Error(`CouchDB returned an empty document for ${r.id}`);
				}
				const record = parseDailyCalc(r.doc);
				if (record._id !== r.id) {
					throw new Error(`CouchDB row/document id mismatch for ${r.id}`);
				}
				return record;
			})
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
