import { json } from '@sveltejs/kit';
import { adminRaw } from '$lib/server/couch-admin';
import { putAsPublicWriter } from '$lib/server/couch-public-writer';
import { sha256Hex } from '$lib/db/hash';
import { fastapiBaseUrl, fastapiServiceHeaders } from '$lib/server/fastapi';
import {
	carryItemIds,
	computeNeeds,
	donationItemEditGate,
	pickCampaignForItems
} from '$lib/features/donations/server';
import type { DonationRevision, PublicDonationDoc } from '$lib/features/donations';
import {
	CouchReadError,
	fetchDocsStrict,
	findByTokenHash,
	GOODS_IN_STOCK_ERROR,
	hasKeyedDonationStock,
	readCurrentDonationPoints
} from '$lib/server/donation-docs';
import type { DonationCampaign, StockLedger } from '$lib/features/operations';
import { DONATION_SCHEMA_V } from '$lib/features/operations/server';
import { createAuditEntry } from '$lib/features/shared';

function shelterCodeFromToken(token: string): string | null {
	const match = token.match(/^TX-([A-Z0-9]+)-/);
	if (!match) return null;
	return match[1] === 'DON' ? 'SH001' : match[1];
}

function shelterDbFromToken(token: string): string | null {
	const code = shelterCodeFromToken(token);
	return code ? `shelter_${code.toLowerCase()}` : null;
}

type PointLine = { drop_off_point_id?: unknown };

/**
 * CR-206 FR-MP-2a, FR-MP-4 — the point each edited line keeps. The dialog sends a point for
 * every line (FR-MP-15); one the shelter no longer offers (unticked or deleted since the
 * booking) becomes `null` rather than an error, and a booking that is not a self drop-off
 * keeps none. Points are read from the shelter doc in CouchDB, not the public projection.
 * A line sent without the key is left as it came.
 */
async function withOfferedPoints<T extends PointLine>(
	items: T[],
	shelterCode: string | null,
	picksPoints: boolean
): Promise<T[]> {
	const named = items.some(
		(item) => typeof item.drop_off_point_id === 'string' && item.drop_off_point_id !== ''
	);
	const offered =
		picksPoints && named && shelterCode
			? new Set((await readCurrentDonationPoints(shelterCode)).map((point) => point.id))
			: new Set<string>();
	return items.map((item) => {
		if (!item || typeof item !== 'object' || !('drop_off_point_id' in item)) return item;
		const id = item.drop_off_point_id;
		return { ...item, drop_off_point_id: typeof id === 'string' && offered.has(id) ? id : null };
	});
}

/**
 * Donor edits the items on their own booking (CR-080).
 *
 * Order matters and is the opposite of cancelling. A cancel cannot be refused, so the
 * BFF writes CouchDB and lets the worker release the quota when the change comes round
 * the feed. An edit *can* be refused — the target may have filled since the page
 * loaded — and the donor has to hear that in the same request. So the quota moves
 * first, at FastAPI, and CouchDB is written only once that succeeded.
 *
 * FastAPI owns `reserved_qty` and cannot reach CouchDB; this route owns the CouchDB
 * document and cannot reach the counter. Neither half can do the other's, which is why
 * this is two steps rather than one. If the second step fails after the first
 * succeeded, the counter is briefly ahead of the document — `donation-quota
 * recalculate` recomputes from CouchDB and settles it (CR-061).
 */
export const PATCH = async ({ params, request }) => {
	try {
		const { tracking_token } = params;
		if (!tracking_token) {
			return json({ success: false, error: 'Tracking token is required' }, { status: 400 });
		}

		const payload = await request.json();
		if (!Array.isArray(payload.items) || payload.items.length === 0) {
			return json({ success: false, error: 'items is required' }, { status: 400 });
		}

		const shelterDb = shelterDbFromToken(tracking_token);
		if (!shelterDb) {
			return json({ success: false, error: 'Invalid tracking token format' }, { status: 400 });
		}
		const trackingTokenHash = await sha256Hex(tracking_token);

		// Check the system of record before moving anything. FastAPI guards on the intake
		// buffer, which follows CouchDB a few seconds behind; refusing here first means a
		// donor whose booking staff just reviewed never has quota moved and rolled back.
		const latestDoc = await findByTokenHash(shelterDb, trackingTokenHash);
		const gate = latestDoc && donationItemEditGate(latestDoc.status, latestDoc.items ?? []);
		if (gate === 'already_reviewed') {
			return json({ success: false, error: 'ALREADY_REVIEWED' }, { status: 400 });
		}
		if (latestDoc && gate === 'closed') {
			return json(
				{ success: false, error: `Cannot edit a donation in status "${latestDoc.status}"` },
				{ status: 400 }
			);
		}
		// Goods already keyed: moving lines would re-number them under the stock rows.
		if (latestDoc && (await hasKeyedDonationStock(shelterDb, latestDoc))) {
			return json(GOODS_IN_STOCK_ERROR, { status: 409 });
		}

		// Each line's drop-off point, checked against what the shelter offers now (FR-MP-2a).
		// Before the booking reaches CouchDB its delivery method is unknown here; FastAPI
		// clears the points of a parcel or a pickup itself (FR-MP-4).
		let pointedItems: typeof payload.items;
		try {
			pointedItems = await withOfferedPoints(
				payload.items,
				latestDoc?.shelter_code ?? shelterCodeFromToken(tracking_token),
				!latestDoc || latestDoc.logistics?.delivery_method === 'self_dropoff'
			);
		} catch (e) {
			// The registry could not be read: nothing has moved yet, so the donor may retry.
			console.error(e);
			return json({ success: false, error: 'DONATION_UNAVAILABLE' }, { status: 503 });
		}

		// Restore any item_id the client dropped before anything is measured or moved.
		// FastAPI does the same repair, but only after this check has already run — a bare
		// line used to read as untracked here, sail through, and then be reserved against
		// the identity FastAPI restored a moment later.
		const resolvedItems: typeof payload.items = latestDoc
			? carryItemIds(pointedItems, latestDoc.items ?? [])
			: pointedItems;

		// The same headroom check the create route makes. Without it an edit answers only
		// to the atomic counter, which caps reserved_qty at qty_target and knows nothing
		// about the warehouse — a booking was raised to 100 against a 100-piece target the
		// shelter already held 80 of. Skipped before the donation reaches CouchDB, a window
		// of one inbound poll, because until then there is no record to measure against.
		// Strict reads: an unreadable ledger is not an empty one — that read as headroom and
		// let the edit past the target. A failed read answers 503 before any quota moves.
		if (latestDoc?.campaign_id) {
			const [campaigns, donations, stockLedgers] = await Promise.all([
				fetchDocsStrict<DonationCampaign>(shelterDb, 'donation_campaign:').then((docs) =>
					docs.filter((c) => c && c.type === 'donation_campaign' && c.status === 'open')
				),
				fetchDocsStrict<PublicDonationDoc>(shelterDb, 'donation:').then((docs) =>
					docs.filter((d) => d && d.type === 'donation')
				),
				fetchDocsStrict<StockLedger>(shelterDb, 'stock_ledger:').then((docs) =>
					docs.filter((l) => l && l.type === 'stock_ledger')
				)
			]);

			// Measure against a world without this booking, so its own current quantity is
			// headroom rather than something it competes with.
			const others = donations.filter((d) => d._id !== latestDoc._id);
			const { campaignRemaining } = computeNeeds(campaigns, others, stockLedgers);
			const mine = campaignRemaining.get(latestDoc.campaign_id) ?? new Map<string, string>();

			const fits = pickCampaignForItems(new Map([[latestDoc.campaign_id, mine]]), resolvedItems);
			if (!fits.ok) {
				return json({ success: false, error: 'NEED_FULL', item_id: fits.itemId }, { status: 409 });
			}
		}

		const apiRes = await fetch(
			`${fastapiBaseUrl()}/public/v1/donations/${encodeURIComponent(tracking_token)}/items`,
			{
				method: 'PATCH',
				headers: fastapiServiceHeaders({ 'Content-Type': 'application/json' }),
				// Staff decide lines in CouchDB, which FastAPI cannot read: send the booking as it
				// is now, for FastAPI's own review gate and the line keys it holds (CR-196).
				body: JSON.stringify({
					items: resolvedItems,
					...(latestDoc
						? { current_items: latestDoc.items ?? [], current_status: latestDoc.status }
						: {})
				})
			}
		);
		const apiBody = await apiRes.json().catch(() => ({}));
		if (!apiRes.ok) {
			const detail = Array.isArray((apiBody as { errors?: unknown[] }).errors)
				? (apiBody as { errors: unknown[] }).errors[0]
				: apiBody;
			return json(
				typeof detail === 'object' && detail !== null
					? { success: false, ...detail }
					: { success: false, error: 'Could not update the donation' },
				{ status: apiRes.status }
			);
		}

		const { items, revision, revisions, status, auto_approved_lines } = apiBody as {
			items: NonNullable<PublicDonationDoc['items']>;
			revision: DonationRevision;
			revisions: number;
			/** The booking's status after the lines were re-reviewed (FR-18b). */
			status?: PublicDonationDoc['status'];
			/** Lines approved by the campaign rule in this edit (FR-26). */
			auto_approved_lines?: number[];
		};

		// Still only in the buffer — inbound will carry the new items and the log across.
		if (!latestDoc) {
			return json({ success: true, message: 'Donation items updated', revisions });
		}

		latestDoc.items = items;
		latestDoc.revisions = [...(latestDoc.revisions ?? []), revision];
		if (status) latestDoc.status = status;
		latestDoc.schema_v = Math.max(latestDoc.schema_v ?? 0, DONATION_SCHEMA_V);
		latestDoc.updated_at = new Date().toISOString();

		let writeRes: { status: number; data: unknown };
		try {
			writeRes = await putAsPublicWriter(shelterDb, latestDoc._id, latestDoc);
		} catch {
			return json({ success: false, error: 'Server configuration error.' }, { status: 500 });
		}

		if (writeRes.status === 409) {
			// The quota already moved. Say so plainly rather than implying nothing happened.
			return json(
				{
					success: false,
					error:
						'บันทึกไม่สำเร็จเพราะรายการถูกแก้จากที่อื่นพอดี กรุณารีเฟรชแล้วตรวจสอบจำนวนอีกครั้ง'
				},
				{ status: 409 }
			);
		}
		if (writeRes.status !== 201 && writeRes.status !== 200) {
			return json({ success: false, error: 'Database update failed' }, { status: 500 });
		}

		// FR-26 — the lines the campaign rule approved in this edit get the same audit the
		// worker writes at booking time. After the PUT: no audit for an edit that did not land.
		if (auto_approved_lines && auto_approved_lines.length > 0) {
			const audit = createAuditEntry(
				{
					action: 'manual_adjust',
					target_type: 'donation',
					target_id: latestDoc._id,
					reason: `อนุมัติรายการในแคมเปญอัตโนมัติหลังผู้บริจาคแก้รายการ (${latestDoc.booking_ref ?? latestDoc._id})`,
					context: {
						booking_ref: latestDoc.booking_ref ?? null,
						approved_by: 'system',
						rule: 'campaign_line',
						lines: auto_approved_lines
					}
				},
				{ shelterCode: latestDoc.shelter_code, createdBy: 'system' }
			);
			// The edit has landed: a lost audit is logged, never turned into an error the
			// donor retries — a retry would move the quota at FastAPI a second time.
			try {
				const auditRes = await adminRaw(`/${shelterDb}/_bulk_docs`, 'POST', { docs: [audit] });
				// `_bulk_docs` answers 201 with a refused row inside.
				const refused =
					Array.isArray(auditRes.data) &&
					auditRes.data.some((row) => typeof row === 'object' && row !== null && 'error' in row);
				if (auditRes.status >= 400 || refused)
					console.error('donation auto-approve audit failed', auditRes.data);
			} catch (e) {
				console.error('donation auto-approve audit failed', e);
			}
		}

		return json({ success: true, message: 'Donation items updated', revisions, status });
	} catch (e) {
		if (e instanceof CouchReadError) {
			console.error(e);
			return json({ success: false, error: 'DONATION_UNAVAILABLE' }, { status: 503 });
		}
		console.error(e);
		return json({ success: false, error: 'Internal Server Error' }, { status: 500 });
	}
};
