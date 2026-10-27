import { normalizeThaiPhone } from '$lib/db/model';
import { maskLastName } from '$lib/utils/mask';
import type { PendingDonationRow } from './back-office';

/**
 * Donor contact as the back-office lists show it: masked by default, the full value only on
 * the detail view and only after the staff member asks for it (#821).
 */

/**
 * First name + masked surname, the same `****` form the kiosk and public cards use
 * (`maskLastName`, mirrors backend `mask_last_name`): "สมชาย ใจดี" → "สมชาย ใ****".
 * `donor.name` is one free-text field, so the first word is taken as the first name.
 */
export function maskDonorName(name: string | null | undefined): string {
	const [first, ...rest] = (name ?? '').trim().split(/\s+/).filter(Boolean);
	if (!first) return 'ไม่ระบุชื่อ';
	return `${first} ${maskLastName(rest.join(' '))}`.trim();
}

/**
 * `xxx-xxx-1234` — same form as backend `mask_phone` and develop's `maskLookupPhone`
 * (`domain/tracking.ts`, #931). TODO: call `maskLookupPhone` once this branch is on develop.
 */
export function maskDonorPhone(phone: string | null | undefined): string {
	const digits = (phone ?? '').replace(/\D/g, '');
	return digits.length < 4 ? 'xxx-xxx-xxxx' : `xxx-xxx-${digits.slice(-4)}`;
}

/** Same form as backend `mask_email`: `s***i@example.com`, `a***@b.th`. */
export function maskDonorEmail(email: string | null | undefined): string | null {
	if (!email || !email.includes('@')) return email ?? null;
	const at = email.indexOf('@');
	const local = email.slice(0, at);
	const masked = local.length <= 2 ? `${local.slice(0, 1)}***` : `${local[0]}***${local.at(-1)}`;
	return `${masked}${email.slice(at)}`;
}

/**
 * Whether a received donation matches the search box: booking ref, donor name, item name, or
 * phone (any run of 4+ digits, separators ignored — so "5678" and "081-234-5678" both work).
 */
export function matchesReceivedSearch(row: PendingDonationRow, query: string): boolean {
	const q = query.trim().toLowerCase();
	if (!q) return true;

	const text = [
		row.booking_ref,
		row.donor_name,
		...row.items.map((it) => it.free_text ?? it.item_id)
	]
		.filter(Boolean)
		.join(' ')
		.toLowerCase();
	if (text.includes(q)) return true;

	const digits = normalizeThaiPhone(q).replace(/\D/g, '');
	if (digits.length < 4 || !row.donor_phone) return false;
	return normalizeThaiPhone(row.donor_phone).replace(/\D/g, '').includes(digits);
}
