/**
 * T-34.2 — Referral state-machine transitions
 *
 * Pure TypeScript — No I/O, No PouchDB, No Svelte.
 * Implements the forward-only state matrix from T-34.md §3.4.
 *
 * State matrix (valid transitions only):
 *   draft    → sent
 *   sent     → accepted | rejected
 *   accepted → closed
 *   rejected → closed
 *   closed   → (terminal — no further transitions)
 */

import type { Referral, ReferralStatus, ReferralTimeline } from './referral.schema';

// ---------------------------------------------------------------------------
// Transition matrix — source of truth for all 25 cells (5×5)
// ---------------------------------------------------------------------------

const VALID_TRANSITIONS: Record<ReferralStatus, readonly ReferralStatus[]> = {
	draft: ['sent'],
	sent: ['accepted', 'rejected'],
	accepted: ['closed'],
	rejected: ['closed'],
	closed: []
} as const;

/**
 * Returns true only for a valid forward transition per the state matrix.
 * Used by both UI (to disable buttons) and the data layer (to validate before write).
 */
export function canTransition(from: ReferralStatus, to: ReferralStatus): boolean {
	return (VALID_TRANSITIONS[from] as readonly string[]).includes(to);
}

/**
 * Apply a validated state transition to a Referral document.
 * Returns a new doc (immutable) — does NOT mutate the original.
 *
 * @throws {Error} if the transition is not permitted by the state matrix.
 */
export function applyTransition(
	doc: Referral,
	to: ReferralStatus,
	actor: string,
	nowIso: string
): Referral {
	if (!canTransition(doc.status, to)) {
		throw new Error(
			`Invalid referral transition: '${doc.status}' → '${to}'. Permitted: [${VALID_TRANSITIONS[doc.status].join(', ') || 'none'}]`
		);
	}

	const stamp = { at: nowIso, by: actor };
	const timeline: ReferralTimeline = { ...doc.timeline };

	switch (to) {
		case 'sent':
			timeline.sent = stamp;
			break;
		case 'accepted':
		case 'rejected':
			timeline.responded = stamp;
			break;
		case 'closed':
			timeline.closed = stamp;
			break;
	}

	return {
		...doc,
		status: to,
		timeline,
		updated_at: nowIso
	};
}

/**
 * Returns the list of statuses that `from` can legally transition to.
 * Useful for rendering transition button lists in the UI.
 */
export function allowedTransitions(from: ReferralStatus): readonly ReferralStatus[] {
	return VALID_TRANSITIONS[from];
}
