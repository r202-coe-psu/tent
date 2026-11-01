import type { ConsentDecision } from '$lib/features/consent/server';
import type { PublicConsentBody } from './public-consent';

export const WEB_CONSENT_STAMP = {
	ref: 'CS-7K3QZ9MD',
	given_at: '2026-10-25T03:15:00.000Z',
	notice_version: '2026-10-25'
} as const;

export function webConsentBody(
	memberCount: number,
	decision: Partial<ConsentDecision> = {}
): PublicConsentBody {
	const consent: ConsentDecision = {
		mode: 'full',
		health: true,
		search_visible: true,
		guardian_for: [],
		verbal: false,
		...WEB_CONSENT_STAMP,
		...decision
	};
	return {
		consent,
		consent_member_keys: Array.from({ length: memberCount }, (_, i) => `m${i}`)
	};
}
