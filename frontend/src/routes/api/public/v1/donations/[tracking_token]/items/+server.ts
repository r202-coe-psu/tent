import { json } from '@sveltejs/kit';
import { donationEditLimiter } from '$lib/server/security/rate-limiter';
import { adminRaw } from '$lib/server/couch-admin';
import { putAsPublicWriter } from '$lib/server/couch-public-writer';
import { sha256Hex } from '$lib/db/hash';
import { fastapiBaseUrl, fastapiServiceHeaders } from '$lib/server/fastapi';
import {
	carryItemIds,
	computeNeeds,
	isDonorEditable,
	pickCampaignForItems
} from '$lib/features/donations';
import type { DonationRevision, PublicDonationDoc } from '$lib/features/donations';
import { fetchDocs } from '$lib/server/donation-docs';
import type { DonationCampaign, StockLedger } from '$lib/features/operations';

function shelterDbFromToken(token: string): string | null {
	const match = token.match(/^TX-([A-Z0-9]+)-/);
	if (!match) return null;
	const code = match[1] === 'DON' ? 'SH001' : match[1];
	return `shelter_${code.toLowerCase()}`;
}

async function findByTokenHash(shelterDb: string, hash: string): Promise<PublicDonationDoc | null> {
	const res = await adminRaw(
		`/${shelterDb}/_all_docs?include_docs=true&startkey="donation:"&endkey="donation:￰"`,
		'GET'
	);
	if (res.status >= 400) return null;
	const rows = (res.data as { rows?: { doc: PublicDonationDoc }[] })?.rows ?? [];
	for (const r of rows) {
		if (r.doc && r.doc.type === 'donation' && r.doc.tracking_token_hash === hash) return r.doc;
	}
	return null;
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
export const PATCH = async ({ params, request, getClientAddress }) => {
	try {
		const { tracking_token } = params;
		if (!tracking_token) {
			return json({ success: false, error: 'Tracking token is required' }, { status: 400 });
		}

		const payload = await request.json();
		if (!Array.isArray(payload.items) || payload.items.length === 0) {
			return json({ success: false, error: 'items is required' }, { status: 400 });
		}

		const ip = getClientAddress();
		if (!donationEditLimiter.check(ip)) {
			return json({ success: false, error: 'RATE_LIMITED' }, { status: 429 });
		}

		const shelterDb = shelterDbFromToken(tracking_token);
		if (!shelterDb) {
			return json({ success: false, error: 'Invalid tracking token format' }, { status: 400 });
		}
		const trackingTokenHash = await sha256Hex(tracking_token);

		// Check the system of record before moving anything. FastAPI guards on the intake
		// buffer, which follows CouchDB a few seconds behind; refusing here first means a
		// donor whose booking staff just picked up never has quota moved and rolled back.
		const latestDoc = await findByTokenHash(shelterDb, trackingTokenHash);
		if (latestDoc && !isDonorEditable(latestDoc.status)) {
			return json(
				{ success: false, error: `Cannot edit a donation in status "${latestDoc.status}"` },
				{ status: 400 }
			);
		}

		// Restore any item_id the client dropped before anything is measured or moved.
		// FastAPI does the same repair, but only after this check has already run — a bare
		// line used to read as untracked here, sail through, and then be reserved against
		// the identity FastAPI restored a moment later.
		const resolvedItems: typeof payload.items = latestDoc
			? carryItemIds(payload.items, latestDoc.items ?? [])
			: payload.items;

		// The same headroom check the create route makes. Without it an edit answers only
		// to the atomic counter, which caps reserved_qty at qty_target and knows nothing
		// about the warehouse — a booking was raised to 100 against a 100-piece target the
		// shelter already held 80 of. Skipped before the donation reaches CouchDB, a window
		// of one inbound poll, because until then there is no record to measure against.
		if (latestDoc?.campaign_id) {
			const [campaigns, donations, stockLedgers] = await Promise.all([
				fetchDocs<DonationCampaign>(shelterDb, 'donation_campaign:').then((docs) =>
					docs.filter((c) => c && c.type === 'donation_campaign' && c.status === 'open')
				),
				fetchDocs<PublicDonationDoc>(shelterDb, 'donation:').then((docs) =>
					docs.filter((d) => d && d.type === 'donation')
				),
				fetchDocs<StockLedger>(shelterDb, 'stock_ledger:').then((docs) =>
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
				body: JSON.stringify({ items: resolvedItems })
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

		const { items, revision, revisions } = apiBody as {
			items: NonNullable<PublicDonationDoc['items_declared']>;
			revision: DonationRevision;
			revisions: number;
		};

		// Still only in the buffer — inbound will carry the new items and the log across.
		if (!latestDoc) {
			return json({ success: true, message: 'Donation items updated', revisions });
		}

		latestDoc.items = items;
		latestDoc.revisions = [...(latestDoc.revisions ?? []), revision];
		latestDoc.schema_v = 4;
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

		return json({ success: true, message: 'Donation items updated', revisions });
	} catch (e) {
		console.error(e);
		return json({ success: false, error: 'Internal Server Error' }, { status: 500 });
	}
};
