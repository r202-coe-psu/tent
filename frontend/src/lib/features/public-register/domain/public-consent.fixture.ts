import type { ConsentDecision } from '$lib/features/consent/server';
import type { PublicConsentBody } from './public-consent';

export const WEB_CONSENT_STAMP = {
	ref: 'CS-7K3QZ9MD',
	given_at: '2026-10-25T03:15:00.000Z',
	notice_version: '2026-10-25'
} as const;

/** A confirmed web block for `memberCount` members keyed `m0`, `m1`, …; full mode by default. */
export function webConsentBody(
	memberCount: number,
	decision: Partial<ConsentDecision> = {}
): PublicConsentBody {
	const shared = { guardian_for: [], verbal: false, ...WEB_CONSENT_STAMP };
	const consent =
		decision.mode === 'basic'
			? { mode: 'basic', ...shared, ...decision }
			: { mode: 'full', health: true, search_visible: true, ...shared, ...decision };
	return {
		consent: consent as ConsentDecision,
		consent_member_keys: Array.from({ length: memberCount }, (_, i) => `m${i}`)
	};
}
