import { json } from '@sveltejs/kit';
import { fastapiBaseUrl, fastapiServiceHeaders, unwrapFastapiError } from '$lib/server/fastapi';

/**
 * POST /api/public/v1/donations/track-search
 * CR-052 §2.6 — booking_ref (DN-…) + phone → tracking_token
 */
export const POST = async ({ request }) => {
	try {
		const payload = await request.json();
		const bookingRef = typeof payload.booking_ref === 'string' ? payload.booking_ref.trim() : '';
		const phone = typeof payload.phone === 'string' ? payload.phone.trim() : '';

		if (!bookingRef || !phone) {
			return json({ success: false, error: 'booking_ref and phone are required' }, { status: 400 });
		}

		const res = await fetch(`${fastapiBaseUrl()}/public/v1/donations/track-search`, {
			method: 'POST',
			headers: fastapiServiceHeaders({ 'Content-Type': 'application/json' }),
			body: JSON.stringify({ booking_ref: bookingRef, phone })
		});
		const body = await res.json().catch(() => ({}));
		if (!res.ok) {
			return json(unwrapFastapiError(body, 'Search failed'), { status: res.status });
		}

		return json({
			success: true,
			trackingToken: body.tracking_token,
			bookingRef: body.booking_ref
		});
	} catch {
		return json({ success: false, error: 'Internal Server Error' }, { status: 500 });
	}
};
