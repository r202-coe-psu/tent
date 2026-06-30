import { json } from '@sveltejs/kit';
import { adminRaw } from '$lib/server/couch-admin';
import { sha256Hex } from '$lib/db/hash';
import { donationIpLimiter } from '$lib/server/security/rate-limiter';
import type { PublicDonationDoc } from '$lib/features/donations/domain/public-donation';

export const GET = async ({ params, getClientAddress }) => {
	try {
		const { tracking_token } = params;
		if (!tracking_token) {
			return json({ success: false, error: 'Tracking token is required' }, { status: 400 });
		}

		// Rate Limiting
		const ip = getClientAddress();
		if (!donationIpLimiter.check(ip)) {
			return json({ success: false, error: 'RATE_LIMITED' }, { status: 429 });
		}

		// Parse token to find shelter code
		// Expected format: TX-{SHELTER_CODE}-{UUID} or old format TX-DON-{UUID}
		const match = tracking_token.match(/^TX-([A-Z0-9]+)-/);
		if (!match) {
			return json({ success: false, error: 'Invalid tracking token format' }, { status: 400 });
		}
		const extracted = match[1];
		const shelterCode = extracted === 'DON' ? 'SH001' : extracted;
		const shelterDb = `shelter_${shelterCode.toLowerCase()}`;
		const trackingTokenHash = await sha256Hex(tracking_token);
		const docId = `donation:${trackingTokenHash}`;

		// Query CouchDB directly
		const res = await adminRaw(`/${shelterDb}/${encodeURIComponent(docId)}`, 'GET');
		if (res.status === 404) {
			return json({ success: false, error: 'Donation record not found' }, { status: 404 });
		}
		if (res.status !== 200) {
			console.error('Failed to fetch from CouchDB', res.data);
			return json({ success: false, error: 'Database fetch failed' }, { status: 500 });
		}

		const donation = res.data as PublicDonationDoc;

		// Check if token matches
		if (donation.tracking_token_hash && donation.tracking_token_hash !== trackingTokenHash) {
			return json({ success: false, error: 'Invalid token' }, { status: 403 });
		}

		// Mask PII before returning to public
		const maskedDonor = { ...donation.donor };
		if (maskedDonor.name) {
			maskedDonor.name = maskedDonor.name.substring(0, 1) + '***';
		}
		if (maskedDonor.phone && maskedDonor.phone.length >= 7) {
			maskedDonor.phone =
				maskedDonor.phone.substring(0, 3) +
				'-***-' +
				maskedDonor.phone.substring(maskedDonor.phone.length - 4);
		}
		if (maskedDonor.line_id && maskedDonor.line_id.length >= 3) {
			maskedDonor.line_id = maskedDonor.line_id.substring(0, 2) + '***';
		}
		if (maskedDonor.email && maskedDonor.email.includes('@')) {
			const parts = maskedDonor.email.split('@');
			maskedDonor.email = parts[0].substring(0, 2) + '***@' + parts[1];
		}

		// Return status and details with MASKED PII (donor), logistics, and booking_ref (CR-005)
		return json({
			success: true,
			donation: {
				status: donation.status,
				booking_ref: donation.booking_ref,
				shelter_code: donation.shelter_code,
				donor: maskedDonor,
				items: (donation.items || donation.items_declared || []).map((i: any) => ({
					free_text: i.free_text || i.item_name,
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
	} catch (e) {
		console.error(e);
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

		// Rate Limiting
		const ip = getClientAddress();
		if (!donationIpLimiter.check(ip)) {
			return json({ success: false, error: 'RATE_LIMITED' }, { status: 429 });
		}

		// Parse token to find shelter code
		const match = tracking_token.match(/^TX-([A-Z0-9]+)-/);
		if (!match) {
			return json({ success: false, error: 'Invalid tracking token format' }, { status: 400 });
		}
		const extracted = match[1];
		const shelterCode = extracted === 'DON' ? 'SH001' : extracted;
		const shelterDb = `shelter_${shelterCode.toLowerCase()}`;
		const trackingTokenHash = await sha256Hex(tracking_token);
		const docId = `donation:${trackingTokenHash}`;

		// Fetch latest rev from CouchDB
		const latestDocRes = await adminRaw(`/${shelterDb}/${encodeURIComponent(docId)}`, 'GET');
		if (latestDocRes.status === 404) {
			return json({ success: false, error: 'Donation record not found' }, { status: 404 });
		}
		if (latestDocRes.status !== 200) {
			console.error('Failed to fetch from CouchDB', latestDocRes.data);
			return json({ success: false, error: 'Database fetch failed' }, { status: 500 });
		}

		const latestDoc = latestDocRes.data as PublicDonationDoc;

		if (latestDoc.tracking_token_hash && latestDoc.tracking_token_hash !== trackingTokenHash) {
			return json({ success: false, error: 'Invalid token' }, { status: 403 });
		}

		if (latestDoc.logistics?.delivery_method !== 'parcel') {
			return json(
				{
					success: false,
					error: 'Courier tracking number can only be updated for parcel deliveries'
				},
				{ status: 400 }
			);
		}

		// Update CouchDB document
		if (!latestDoc.logistics) latestDoc.logistics = {};
		latestDoc.logistics.courier_tracking_no = payload.courier_tracking_no;
		latestDoc.updated_at = new Date().toISOString();

		const updateRes = await adminRaw(
			`/${shelterDb}/${encodeURIComponent(docId)}`,
			'PUT',
			latestDoc
		);
		if (updateRes.status !== 201 && updateRes.status !== 200) {
			console.error('Failed to update CouchDB', updateRes.data);
			return json({ success: false, error: 'Database update failed' }, { status: 500 });
		}

		return json({ success: true, message: 'Courier tracking number updated' });
	} catch (e) {
		console.error(e);
		return json({ success: false, error: 'Internal Server Error' }, { status: 500 });
	}
};
