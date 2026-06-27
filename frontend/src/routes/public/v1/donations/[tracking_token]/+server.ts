import { json } from '@sveltejs/kit';
import { getDonationByHash } from '$lib/server/mongodb';
import { sha256Hex } from '$lib/db/hash';

export const GET = async ({ params }) => {
	try {
		const { tracking_token } = params;
		if (!tracking_token) {
			return json({ success: false, error: 'Tracking token is required' }, { status: 400 });
		}

		// Compute hash to look up in database (prevents IDOR)
		const tokenHash = await sha256Hex(tracking_token);
		const donation = await getDonationByHash(tokenHash);

		if (!donation) {
			return json({ success: false, error: 'Donation record not found' }, { status: 404 });
		}

		// Return status and details WITHOUT PII (donor name, phone, email etc.)
		return json({
			success: true,
			donation: {
				status: donation.status,
				shelter_code: donation.shelter_code,
				items: donation.items,
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

