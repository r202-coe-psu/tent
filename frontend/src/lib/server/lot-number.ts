import { adminRaw } from '$lib/server/couch-admin';
import type { AuthorContext } from '$lib/db/model';
import {
	lotSeedFindBody,
	parseLotSeedMax,
	reserveLotNos,
	type LotCounterConnector,
	type LotCounterRecord
} from '$lib/features/operations/server';

/** {@link LotCounterConnector} over the admin credential (`adminRaw`) for one shelter DB. */
export function createAdminLotCounterConnector(dbName: string): LotCounterConnector {
	return {
		async get(id, opts) {
			const query = opts?.rev ? `?rev=${encodeURIComponent(opts.rev)}` : '?conflicts=true';
			const res = await adminRaw(`/${dbName}/${encodeURIComponent(id)}${query}`, 'GET');
			if (res.status === 404) return null;
			if (res.status >= 400) throw new Error(`lot_counter read failed (${res.status})`);
			return res.data as LotCounterRecord;
		},
		async put(doc) {
			const res = await adminRaw(`/${dbName}/${encodeURIComponent(doc._id)}`, 'PUT', doc);
			if (res.status === 409) return { ok: false, conflict: true };
			if (res.status >= 400) throw new Error(`lot_counter write failed (${res.status})`);
			return { ok: true };
		},
		async seedMax(stamp) {
			const res = await adminRaw(`/${dbName}/_find`, 'POST', lotSeedFindBody(stamp));
			// Never assume 0 on a failed lookup — that would hand out numbers already on the ledger.
			if (res.status >= 400) throw new Error(`lot_no lookup failed (${res.status})`);
			const docs = (res.data as { docs?: { lot?: { lot_no?: string } }[] } | null)?.docs ?? [];
			return parseLotSeedMax(docs, stamp);
		}
	};
}

/**
 * Reserve `count` lot numbers `L-YYMMDD-XXX` for a shelter DB from its `lot_counter` doc
 * (CR-244). **Server-only** (admin credentials). Throws on failure — no fallback to `001`.
 */
export async function allocateLotNos(
	dbName: string,
	count: number,
	ctx: AuthorContext,
	when: Date = new Date()
): Promise<string[]> {
	return reserveLotNos({ connector: createAdminLotCounterConnector(dbName), ctx, count, when });
}
