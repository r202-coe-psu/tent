import { json } from '@sveltejs/kit';
import { donationIpLimiter } from '$lib/server/security/rate-limiter';
import { fastapiBaseUrl, fastapiServiceHeaders } from '$lib/server/fastapi';

/** Flatten FastAPI `{ errors: [detail] }` into `{ error }` for the donor UI. */
function unwrapFastapiError(body: unknown): Record<string, unknown> {
	if (typeof body !== 'object' || body === null) return { error: 'Search failed' };
	const envelope = body as { errors?: unknown[] };
	const detail = Array.isArray(envelope.errors) ? envelope.errors[0] : undefined;
	if (typeof detail === 'object' && detail !== null) return detail as Record<string, unknown>;
	if (typeof detail === 'string') return { error: detail };
	return body as Record<string, unknown>;
}

/**
 * POST /api/public/v1/donations/track-search
 * CR-052 §2.6 — booking_ref (DN-…) + phone → tracking_token
 */
export const POST = async ({ request, getClientAddress }) => {
	try {
		const payload = await request.json();
		const bookingRef =
			typeof payload.booking_ref === 'string' ? payload.booking_ref.trim() : '';
		const phone = typeof payload.phone === 'string' ? payload.phone.trim() : '';

		if (!bookingRef || !phone) {
			return json(
				{ success: false, error: 'booking_ref and phone are required' },
				{ status: 400 }
			);
		}

		const ip = getClientAddress();
		if (!donationIpLimiter.check(ip)) {
			return json({ success: false, error: 'RATE_LIMITED' }, { status: 429 });
		}

		const res = await fetch(`${fastapiBaseUrl()}/public/v1/donations/track-search`, {
			method: 'POST',
			headers: fastapiServiceHeaders({ 'Content-Type': 'application/json' }),
			body: JSON.stringify({ booking_ref: bookingRef, phone })
		});
		const body = await res.json().catch(() => ({}));
		if (!res.ok) {
			return json(unwrapFastapiError(body), { status: res.status });
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
