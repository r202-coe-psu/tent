/**
 * PDPA consent on both public pre-register paths (FR-42). The browser sends the block's decision
 * plus the members' form keys in `members` order, because `guardian_for` names form keys and the
 * member schema strips them. Pure: safe to import from `+server.ts`.
 */
import { z } from 'zod';
import {
	consentDecisionSchemaFor,
	planRegistrationConsent,
	type ConsentDecision,
	type MemberConsentPlan
} from '$lib/features/consent/server';

export const publicConsentShape = {
	consent: consentDecisionSchemaFor('web'),
	consent_member_keys: z.array(z.string().min(1)).min(1)
};

export interface PublicConsentBody {
	consent: ConsentDecision;
	consent_member_keys: string[];
}

export function planPublicConsent(body: PublicConsentBody): readonly MemberConsentPlan[] {
	return planRegistrationConsent(body.consent, {
		channel: 'web',
		recordedBy: null,
		members: body.consent_member_keys.map((key) => ({ key, alreadyConsented: false }))
	});
}

export function refinePublicConsent(
	value: PublicConsentBody & { members: readonly unknown[] },
	ctx: z.RefinementCtx
): void {
	if (value.consent_member_keys.length !== value.members.length) {
		ctx.addIssue({
			code: 'custom',
			path: ['consent_member_keys'],
			message: 'consent_member_keys must list every member'
		});
		return;
	}
	try {
		planPublicConsent(value);
	} catch (err) {
		ctx.addIssue({
			code: 'custom',
			path: ['consent'],
			message: err instanceof Error ? err.message : 'invalid consent'
		});
	}
}

/** Body check for routes whose member schema is parsed elsewhere (legacy booking shape). */
export const publicConsentBodySchema = z
	.object({ ...publicConsentShape, members: z.array(z.unknown()) })
	.superRefine(refinePublicConsent);
