import { ConflictError, NotFoundError } from '$lib/utils/errors';
import { couchDbFetch, findDocs, getDocWithConflicts, putDocStrict } from '$lib/db/couch-db';
import { lotSeedFindBody, parseLotSeedMax } from '../domain/operations';
import type { LotCounterConnector, LotCounterRecord } from './lot-reservation';

/**
 * Connector over the staff session path (`/couch` proxy, user cookie) — used by the kitchen and
 * stock-page repositories. VDU decides who may write the counter (FR-13).
 */
export function createSessionLotCounterConnector(dbName: string): LotCounterConnector {
	return {
		async get(id, opts) {
			if (opts?.rev) {
				try {
					return await couchDbFetch<LotCounterRecord>(
						dbName,
						`/${encodeURIComponent(id)}?rev=${encodeURIComponent(opts.rev)}`
					);
				} catch (err) {
					if (err instanceof NotFoundError) return null;
					throw err;
				}
			}
			return getDocWithConflicts<LotCounterRecord & { _id: string }>(dbName, id);
		},
		async put(doc) {
			try {
				await putDocStrict(dbName, doc as LotCounterRecord & { _id: string });
				return { ok: true };
			} catch (err) {
				// Only a real HTTP 409 is a stale `_rev`; every other failure must surface (FR-8).
				if (err instanceof ConflictError && err.httpStatus === 409) {
					return { ok: false, conflict: true };
				}
				throw err;
			}
		},
		async seedMax(stamp) {
			const rows = await findDocs<{ lot?: { lot_no?: string } }>(dbName, lotSeedFindBody(stamp));
			return parseLotSeedMax(rows, stamp);
		}
	};
}
