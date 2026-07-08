import { json } from '@sveltejs/kit';
import { adminRaw } from '$lib/server/couch-admin';
import { putAsPublicWriter } from '$lib/server/couch-public-writer';
import { sha256Hex } from '$lib/db/hash';
import { donationIpLimiter } from '$lib/server/security/rate-limiter';
import type { PublicDonationDoc } from '$lib/features/donations';

// resolve shelter db จาก token (format: TX-{SHELTER_CODE}-{UUID}; legacy TX-DON-... → SH001)
function shelterDbFromToken(token: string): string | null {
	const match = token.match(/^TX-([A-Z0-9]+)-/);
	if (!match) return null;
	const code = match[1] === 'DON' ? 'SH001' : match[1];
	return `shelter_${code.toLowerCase()}`;
}

// donation _id = donation:{ulid} → ค้นด้วย tracking_token_hash (schema.md §2.3 index (tracking_token_hash))
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

export const GET = async ({ params, getClientAddress }) => {
	try {
		const { tracking_token } = params;
		if (!tracking_token) {
			return json({ success: false, error: 'Tracking token is required' }, { status: 400 });
		}

		const ip = getClientAddress();
		if (!donationIpLimiter.check(ip)) {
			return json({ success: false, error: 'RATE_LIMITED' }, { status: 429 });
		}

		const shelterDb = shelterDbFromToken(tracking_token);
		if (!shelterDb) {
			return json({ success: false, error: 'Invalid tracking token format' }, { status: 400 });
		}
		const trackingTokenHash = await sha256Hex(tracking_token);

		const donation = await findByTokenHash(shelterDb, trackingTokenHash);
		if (!donation) {
			return json({ success: false, error: 'Donation record not found' }, { status: 404 });
		}

		// Mask PII; ห้าม echo phone/phone_hash สู่ public (schema.md §2.3)
		const rawDonor = donation.donor ?? ({} as PublicDonationDoc['donor']);
		const maskedDonor: Record<string, unknown> = {};
		if (rawDonor.name) maskedDonor.name = rawDonor.name.substring(0, 1) + '***';
		if (rawDonor.line_id && rawDonor.line_id.length >= 3) {
			maskedDonor.line_id = rawDonor.line_id.substring(0, 2) + '***';
		}
		if (rawDonor.email && rawDonor.email.includes('@')) {
			const parts = rawDonor.email.split('@');
			maskedDonor.email = parts[0].substring(0, 2) + '***@' + parts[1];
		}

		return json({
			success: true,
			donation: {
				status: donation.status,
				booking_ref: donation.booking_ref,
				shelter_code: donation.shelter_code,
				donor: maskedDonor,
				items: (donation.items || donation.items_declared || []).map((i) => ({
					free_text: i.free_text || ('item_name' in i ? i.item_name : undefined),
					category: i.category,
					qty: i.qty,
					unit: i.unit,
					condition: i.condition,
					note: i.note
				})),
				logistics: donation.logistics,
				received_summary: donation.received_summary || null,
				created_at: donation.created_at,
				expires_at: donation.expires_at
			}
		});
	} catch {
		return json({ success: false, error: 'Internal Server Error' }, { status: 500 });
	}
};

export const PATCH = async ({ params, request, getClientAddress }) => {
	try {
		const { tracking_token } = params;
		if (!tracking_token) {
			return json({ success: false, error: 'Tracking token is required' }, { status: 400 });
		}

		const payload = await request.json();
		if (!payload.courier_tracking_no) {
			return json({ success: false, error: 'courier_tracking_no is required' }, { status: 400 });
		}

		const ip = getClientAddress();
		if (!donationIpLimiter.check(ip)) {
			return json({ success: false, error: 'RATE_LIMITED' }, { status: 429 });
		}

		const shelterDb = shelterDbFromToken(tracking_token);
		if (!shelterDb) {
			return json({ success: false, error: 'Invalid tracking token format' }, { status: 400 });
		}
		const trackingTokenHash = await sha256Hex(tracking_token);

		const latestDoc = await findByTokenHash(shelterDb, trackingTokenHash);
		if (!latestDoc) {
			return json({ success: false, error: 'Donation record not found' }, { status: 404 });
		}

		if (!latestDoc.logistics || latestDoc.logistics.delivery_method !== 'parcel') {
			return json(
				{
					success: false,
					error: 'Courier tracking number can only be updated for parcel deliveries'
				},
				{ status: 400 }
			);
		}

		latestDoc.logistics.courier_tracking_no = payload.courier_tracking_no;
		latestDoc.updated_at = new Date().toISOString();

		let writeRes: { status: number; data: unknown };
		try {
			writeRes = await putAsPublicWriter(shelterDb, latestDoc._id, latestDoc);
		} catch {
			return json({ success: false, error: 'Server configuration error.' }, { status: 500 });
		}

		if (writeRes.status === 409) {
			return json(
				{
					success: false,
					error: 'Donation was updated elsewhere. Please refresh and try again.'
				},
				{ status: 409 }
			);
		}
		if (writeRes.status !== 201 && writeRes.status !== 200) {
			return json({ success: false, error: 'Database update failed' }, { status: 500 });
		}

		return json({ success: true, message: 'Courier tracking number updated' });
	} catch {
		return json({ success: false, error: 'Internal Server Error' }, { status: 500 });
	}
};
