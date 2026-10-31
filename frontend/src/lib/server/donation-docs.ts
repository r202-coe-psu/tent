import { adminRaw } from '$lib/server/couch-admin';
import type { PublicDonationDoc } from '$lib/features/donations';
import type { StoredDonationPhoto } from '$lib/features/donations/server';
import { listDonationPoints } from '$lib/features/shelters/server';
import { findMasterByCode } from '$lib/server/shelters.admin';

/**
 * Fetch all docs of a given type (by `_id` prefix) from a shelter database via
 * `_all_docs` (no view required — matches project convention).
 *
 * **Server-only** (uses admin credentials). Kept out of `features/donations/domain`
 * so the client barrel stays free of server imports (domain must be pure — no I/O).
 * Shared by `POST /api/public/v1/donations` and `GET /api/public/v1/needs`.
 */
export async function fetchDocs<T>(dbName: string, prefix: string): Promise<T[]> {
	const res = await adminRaw(
		`/${dbName}/_all_docs?include_docs=true&startkey="${prefix}"&endkey="${prefix}￰"`,
		'GET'
	);
	if (res.status >= 400) return [];
	const rows = (res.data as { rows?: { doc: T }[] })?.rows ?? [];
	return rows.map((r) => r.doc).filter(Boolean);
}

/** A CouchDB read that failed for a reason other than "database does not exist". */
export class CouchReadError extends Error {
	readonly status: number;
	constructor(dbName: string, prefix: string, status: number) {
		super(`CouchDB read failed (${status}) for ${dbName}/${prefix}`);
		this.name = 'CouchReadError';
		this.status = status;
	}
}

/**
 * The donation a donor's tracking token points at, looked up by its hash. `null` when the
 * shelter has no such booking yet — not synced from the intake buffer, or no shelter DB.
 *
 * Any other failure throws {@link CouchReadError}: read as "not synced yet" it sent donor
 * edits and cancels to FastAPI, which moved quota or told the donor the booking was syncing.
 */
export async function findByTokenHash(
	shelterDb: string,
	hash: string
): Promise<PublicDonationDoc | null> {
	const res = await adminRaw(
		`/${shelterDb}/_all_docs?include_docs=true&startkey="donation:"&endkey="donation:￰"`,
		'GET'
	);
	if (res.status === 404) return null;
	if (res.status >= 400) throw new CouchReadError(shelterDb, 'donation:', res.status);
	const rows = (res.data as { rows?: { doc: PublicDonationDoc }[] })?.rows ?? [];
	for (const r of rows) {
		if (r.doc && r.doc.type === 'donation' && r.doc.tracking_token_hash === hash) return r.doc;
	}
	return null;
}

/**
 * Fail-closed variant of {@link fetchDocs} for reads that gate a decision (e.g. how many
 * bookings a window already holds). A missing database (404) really is "no docs yet" and
 * returns `[]`; any other error status throws {@link CouchReadError} so the caller can
 * refuse instead of treating an outage as "nothing booked".
 */
export async function fetchDocsStrict<T>(dbName: string, prefix: string): Promise<T[]> {
	const res = await adminRaw(
		`/${dbName}/_all_docs?include_docs=true&startkey="${prefix}"&endkey="${prefix}￰"`,
		'GET'
	);
	if (res.status === 404) return [];
	if (res.status >= 400) throw new CouchReadError(dbName, prefix, res.status);
	const rows = (res.data as { rows?: { doc: T }[] })?.rows ?? [];
	return rows.map((r) => r.doc).filter(Boolean);
}

/**
 * True once the shelter has started taking this booking in: a `donation` ledger row points at
 * it, or a drop-off point recorded a receipt (CR-206 FR-MP-17a — a point that turned every
 * line away keys no row). From then on the donor may no longer edit or cancel it (owner
 * decision 2026-10-22, narrowing CR-174 FR-20/21), nor staff redirect or reject it: an
 * interrupted receipt would otherwise leave goods in stock for lines that moved or a booking
 * that no longer exists.
 */
export async function hasKeyedDonationStock(
	dbName: string,
	donation: { _id: string; point_receipts?: readonly unknown[] | null }
): Promise<boolean> {
	if ((donation.point_receipts ?? []).length > 0) return true;
	return (await keyedDonationRowIds(dbName, donation._id, 1)).length > 0;
}

/** Ids of the `donation` ledger rows pointing at this booking, at most `limit` of them. */
export async function keyedDonationRowIds(
	dbName: string,
	donationId: string,
	limit: number
): Promise<string[]> {
	const res = await adminRaw(`/${dbName}/_find`, 'POST', {
		// `item_id` is in the selector only so CouchDB picks `ledger-type-refid-itemid-reason-idx`
		// (shelter-access-design.ts): without it the query scans the whole shelter DB.
		selector: {
			type: 'stock_ledger',
			ref_id: donationId,
			item_id: { $gt: null },
			reason: 'donation'
		},
		fields: ['_id'],
		limit
	});
	if (res.status >= 400) {
		throw new CouchReadError(dbName, 'stock_ledger (ref_id)', res.status);
	}
	return ((res.data as { docs?: { _id: string }[] }).docs ?? []).map((doc) => doc._id);
}

/** A drop-off point as staff set it up now — `id` and the name staff and donors read. */
export type CurrentDonationPoint = { id: string; name: string };

/**
 * The shelter's drop-off points as they are now (CR-206 FR-MP-2a): `sub_storage[]` ticked
 * `accepts_donations` with a pin, read from the registry doc — not the public projection,
 * which lags behind the worker. `[]` for an unknown shelter.
 */
export async function readCurrentDonationPoints(
	shelterCode: string
): Promise<CurrentDonationPoint[]> {
	const master = await findMasterByCode(shelterCode);
	return listDonationPoints(master ?? undefined).map((point) => ({
		id: point.id,
		name: point.name.trim()
	}));
}

/** The refusal a donor gets once the shelter has started taking the goods in. */
export const GOODS_IN_STOCK_ERROR = {
	success: false,
	error: 'GOODS_IN_STOCK',
	message: 'ศูนย์เริ่มรับของของใบนี้เข้าคลังแล้ว — แก้ไขหรือยกเลิกไม่ได้ กรุณาติดต่อศูนย์'
} as const;

/**
 * The photo docs a booking names, read one by one by `_id` from the booking's shelter DB
 * (CR-175 FR-10 — no index needed). `null` where the shelter has no such doc. Sizes come
 * from the stored attachments, which only the upload BFF wrote. Any read failure other
 * than 404 throws {@link CouchReadError}: the booking must not pass a check it never ran.
 */
export async function readDonationPhotos(
	dbName: string,
	ids: readonly string[]
): Promise<(StoredDonationPhoto | null)[]> {
	return Promise.all(
		ids.map(async (id) => {
			const res = await adminRaw(`/${dbName}/${encodeURIComponent(id)}`, 'GET');
			if (res.status === 404) return null;
			if (res.status !== 200) throw new CouchReadError(dbName, id, res.status);
			const doc = res.data as {
				type?: string;
				purpose?: string;
				donation_id?: string;
				_attachments?: Record<string, { length?: number }>;
			};
			if (doc.type !== 'image') return null;
			const bytes = Object.values(doc._attachments ?? {}).reduce(
				(sum, a) => sum + (a.length ?? 0),
				0
			);
			return { purpose: doc.purpose, donation_id: doc.donation_id, bytes };
		})
	);
}
