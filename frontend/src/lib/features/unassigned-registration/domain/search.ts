/**
 * Unassigned Registration staff search types (CR-113 / #245).
 * Mongo central queue — not Evacuee until claim.
 */

import { z } from 'zod';

/** Full Station 1 badge copy for Unassigned Registration hits (#250 / CR-113). */
export const UNASSIGNED_QUEUE_BADGE_LABEL = 'คิวกลาง / ยังไม่ระบุศูนย์';

/** Compact badge text matching AC `[คิวกลาง]`. */
export const UNASSIGNED_QUEUE_BADGE_SHORT = 'คิวกลาง';

const personIdHitSchema = z.object({
	cardType: z.enum(['national_id', 'passport', 'pink_card', 'other', 'anonymous']),
	number: z.string().nullable()
});

/** Owner of the open-member search/claim hit shape — claim imports this. */
export const openMemberHitSchema = z.object({
	reserved_evacuee_id: z.string(),
	status: z.literal('open'),
	first_name: z.string(),
	last_name: z.string(),
	gender: z.string(),
	phone: z.string().nullable(),
	person_id: personIdHitSchema.nullable(),
	country: z.string(),
	vulnerable_groups: z.array(z.string()),
	special_needs: z.array(z.string())
});

export type PersonIdHit = z.infer<typeof personIdHitSchema>;
export type OpenMemberHit = z.infer<typeof openMemberHitSchema>;
export type OpenMemberStatus = OpenMemberHit['status'];

export interface UnassignedRegistrationSearchHit {
	id: string;
	reserved_household_id: string;
	registered_via: 'web' | 'staff';
	status: string;
	created_at: string;
	open_members: OpenMemberHit[];
}

export interface UnassignedRegistrationSearchResponse {
	results: UnassignedRegistrationSearchHit[];
}

export function formatOpenMemberName(member: OpenMemberHit): string {
	return `${member.first_name} ${member.last_name}`.trim();
}

/** True when FastAPI / BFF signal that central Mongo (or auth) is unreachable. */
export function isOnlineRequiredError(error: unknown): boolean {
	if (!error || typeof error !== 'object') return false;
	const code =
		'code' in error && typeof error.code === 'string'
			? error.code
			: 'error' in error &&
				  typeof error.error === 'object' &&
				  error.error !== null &&
				  'code' in error.error &&
				  typeof (error.error as { code: unknown }).code === 'string'
				? (error.error as { code: string }).code
				: null;
	return code === 'ONLINE_REQUIRED';
}
