import type { DonationSlotMode } from '$lib/features/operations';
import type { SlotAvailability } from '../domain/compute-slots';

/**
 * Windows a shelter still has room for on one date, in one queue — `dropoff` (the
 * donor drives up) or `pickup` (the shelter's vehicle goes out).
 *
 * Read through the SvelteKit BFF (`/api/public/v1/donations/slots`) — `donation_slot`
 * lives in the shelter's CouchDB and is not projected to Mongo, so the public plane
 * reaches it the same way the SLOT_FULL re-check in `POST /api/public/v1/donations`
 * does: server-side, with admin credentials, never from the browser.
 */
export async function fetchDonationSlots(
	shelterCode: string,
	date: string,
	mode: DonationSlotMode
): Promise<SlotAvailability[]> {
	const code = shelterCode.trim().toUpperCase();
	if (!code || !date) return [];

	const params = new URLSearchParams({ shelter_code: code, date, mode });
	const res = await fetch(`/api/public/v1/donations/slots?${params}`);
	if (!res.ok) throw new Error('ไม่สามารถโหลดช่วงเวลาจองคิวได้');

	const body = await res.json().catch(() => null);
	const slots = (body as { slots?: unknown })?.slots;
	return Array.isArray(slots) ? (slots as SlotAvailability[]) : [];
}
