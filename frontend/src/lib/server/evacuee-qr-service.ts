/**
 * Server-issued Person QR (CR-233). The ONLY place a Person QR payload is minted (FR-EQR-15):
 * appends an entry to `evacuee_qr:{ULID}` (admin credential, FR-EQR-39) and returns
 * `evacuee:{ULID}@{hash6}`. The entry is written BEFORE the payload is returned (FR-EQR-20).
 */
import { createHash } from 'node:crypto';
import { adminRaw, ServiceError, serviceErrorFromCouch } from '$lib/server/couch-admin';
import { shelterDbName } from '$lib/server/shelter-access-design';
import { EVACUEE_ID, type EvacueeQrPrintRef, type EvacueeQrSource } from '$lib/utils/evacuee-qr';
import {
	vulnerabilityMarker,
	type MarkerScreening,
	type VulnerabilityMarker
} from '$lib/utils/vulnerability-marker';

export const EVACUEE_QR_MAX_ATTEMPTS = 5;

/**
 * A stored `prints[]` entry (schema.md §1.9). `marker` is the vulnerability level printed on that
 * card (#1301); entries written at schema_v 1 lack it and stay as-is (append-only).
 */
export type EvacueeQrPrint = EvacueeQrPrintRef & {
	printed_by: string;
	source: EvacueeQrSource;
	marker?: VulnerabilityMarker | null;
};

export type EvacueeQrDoc = {
	_id: string;
	_rev?: string;
	type: 'evacuee_qr';
	schema_v: 1 | 2;
	shelter_code: string;
	evacuee_id: string;
	prints: EvacueeQrPrint[];
	created_at: string;
	updated_at: string;
	created_by: string;
};

export type IssueEvacueeQrInput = {
	shelter_code: string;
	evacuee_id: string;
	source: EvacueeQrSource;
	printed_by: string;
};

export type IssuedEvacueeQr = {
	evacuee_id: string;
	qr_payload: string;
	printed_at: string;
	marker: VulnerabilityMarker | null;
};

/** FR-EQR-3: first 6 hex chars of SHA-1 over the UTF-8 `printed_at` string. */
export function hash6Of(printedAt: string): string {
	return createHash('sha1').update(printedAt, 'utf8').digest('hex').slice(0, 6);
}

export function evacueeQrDocId(evacueeId: string): string {
	return `evacuee_qr:${evacueeId.slice('evacuee:'.length)}`;
}

/** api-contract §2.8: a CouchDB 5xx is `DEPENDENCY_UNAVAILABLE`; other failures keep the shared mapping. */
function couchFailure(action: string, status: number, data: unknown): ServiceError {
	return status >= 500
		? new ServiceError(
				'DEPENDENCY_UNAVAILABLE',
				`Could not ${action}`,
				`CouchDB responded ${status}`
			)
		: serviceErrorFromCouch(action, status, data);
}

/** Admin read of the log doc; a missing doc is `null`. */
async function readDoc(db: string, docId: string): Promise<EvacueeQrDoc | null> {
	const res = await adminRaw(`/${db}/${encodeURIComponent(docId)}`, 'GET');
	if (res.status === 404) return null;
	if (res.status >= 400) throw couchFailure('read evacuee_qr', res.status, res.data);
	return res.data as EvacueeQrDoc;
}

/** The scan rule's input (FR-EQR-27): stored entries in append order; missing doc => []. */
export async function getEvacueeQrPrints(
	shelter_code: string,
	evacuee_id: string
): Promise<EvacueeQrPrintRef[]> {
	const doc = await readDoc(shelterDbName(shelter_code), evacueeQrDocId(evacuee_id));
	return (doc?.prints ?? []).map(({ printed_at, hash }) => ({ printed_at, hash }));
}

/**
 * New entry time + hash: `max(now, last+1ms)` (FR-EQR-17), then +1 ms until the hash is unique
 * among the person's existing entries (FR-EQR-17a). Strictly increasing is kept by construction.
 */
function nextStamp(prints: readonly EvacueeQrPrintRef[], nowMs: number) {
	const last = prints[prints.length - 1];
	let ms = nowMs;
	if (last) ms = Math.max(ms, Date.parse(last.printed_at) + 1);
	const taken = new Set(prints.map((p) => p.hash));
	for (;;) {
		const printed_at = new Date(ms).toISOString();
		const hash = hash6Of(printed_at);
		if (!taken.has(hash)) return { printed_at, hash };
		ms += 1;
	}
}

export async function issueEvacueeQr(input: IssueEvacueeQrInput): Promise<IssuedEvacueeQr> {
	const { shelter_code, evacuee_id, source, printed_by } = input;
	if (!EVACUEE_ID.test(evacuee_id)) {
		throw new ServiceError('VALIDATION', 'evacuee_id must be evacuee:{ULID}');
	}
	const db = shelterDbName(shelter_code);

	// FR-EQR-16: the evacuee must exist before anything is written.
	const ev = await adminRaw(`/${db}/${encodeURIComponent(evacuee_id)}`, 'GET');
	if (ev.status === 404) throw new ServiceError('NOT_FOUND', 'Evacuee not found');
	if (ev.status >= 400) throw couchFailure('read evacuee', ev.status, ev.data);

	// #1301: the server derives the level printed on the card (never from the request body).
	const groups = (ev.data as { vulnerable_groups?: unknown }).vulnerable_groups;
	const found = await adminRaw(`/${db}/_find`, 'POST', {
		selector: { type: 'screening', evacuee_id },
		fields: ['track', 'screened_at']
	});
	if (found.status >= 400) throw couchFailure('read screenings', found.status, found.data);
	const screenings = (found.data as { docs?: MarkerScreening[] }).docs ?? [];
	const marker = vulnerabilityMarker(
		{ vulnerable_groups: Array.isArray(groups) ? (groups as string[]) : [] },
		screenings
	);

	const docId = evacueeQrDocId(evacuee_id);
	for (let attempt = 0; attempt < EVACUEE_QR_MAX_ATTEMPTS; attempt++) {
		const existing = await readDoc(db, docId);
		// A foreign doc squatting this _id (wrong type / no prints) must fail loudly, not spread undefined.
		if (existing && (existing.type !== 'evacuee_qr' || !Array.isArray(existing.prints))) {
			throw new ServiceError('CONFLICT', 'evacuee_qr id is occupied by another document');
		}
		const stamp = nextStamp(existing?.prints ?? [], Date.now());
		const entry: EvacueeQrPrint = {
			printed_at: stamp.printed_at,
			hash: stamp.hash,
			printed_by,
			source,
			marker
		};
		const doc: EvacueeQrDoc = existing
			? {
					...existing,
					schema_v: 2,
					prints: [...existing.prints, entry],
					updated_at: stamp.printed_at
				}
			: {
					_id: docId,
					type: 'evacuee_qr',
					schema_v: 2,
					shelter_code,
					evacuee_id,
					prints: [entry],
					created_at: stamp.printed_at,
					updated_at: stamp.printed_at,
					created_by: printed_by
				};
		const res = await adminRaw(`/${db}/${encodeURIComponent(docId)}`, 'PUT', doc);
		if (res.status === 409) continue; // FR-EQR-19: re-read, re-stamp, retry
		if (res.status >= 400) throw couchFailure('issue evacuee QR', res.status, res.data);
		return {
			evacuee_id,
			qr_payload: `${evacuee_id}@${stamp.hash}`,
			printed_at: stamp.printed_at,
			marker
		};
	}
	throw new ServiceError('CONFLICT', 'Could not issue QR: too many concurrent writes, retry');
}
