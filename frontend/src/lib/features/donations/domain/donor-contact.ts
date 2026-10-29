import { maskLastName } from '$lib/utils/mask';
import { maskLookupPhone } from './tracking';

/**
 * Donor contact as the back-office lists show it: masked by default, the full value only on
 * the detail view and only after the staff member asks for it (#821). The masking happens on
 * the server (FR-10) — the list route sends these forms, never the full value.
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

/** `xxx-xxx-1234` — the one phone mask of the feature (`maskLookupPhone`, #931; CR FR-5). */
export function maskDonorPhone(phone: string | null | undefined): string {
	return maskLookupPhone(phone ?? '');
}

/** Same form as backend `mask_email`: `s***i@example.com`, `a***@b.th`. */
export function maskDonorEmail(email: string | null | undefined): string | null {
	if (!email) return null;
	// Not an address (old data, or a LINE id / number typed into the field): show nothing of it.
	if (!email.includes('@')) return '***';
	const at = email.indexOf('@');
	const local = email.slice(0, at);
	const masked = local.length <= 2 ? `${local.slice(0, 1)}***` : `${local[0]}***${local.at(-1)}`;
	return `${masked}${email.slice(at)}`;
}
