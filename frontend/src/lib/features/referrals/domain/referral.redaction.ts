/**
 * T-34.3 — Referral redaction for data privacy (FR-48/NFR-5 compliance)
 *
 * Pure TypeScript — No I/O, No PouchDB, No Svelte.
 * Ensures medical info (notes/reason for hospital targets) and PII are redacted
 * when accessed outside internal shelter manager/staff scopes (e.g. public, FAM, EOC).
 */

import type { Referral, ReferralStatus, ReferralTimeline } from './referral.schema';

export type ReferralScope = 'internal' | 'public' | 'fam' | 'eoc';

export interface RedactedReferral {
	_id: string;
	type: 'referral';
	status: ReferralStatus;
	urgency: 'normal' | 'urgent';
	to_org: {
		kind: 'hospital' | 'social_services' | 'other';
		name?: string;
		contact?: string;
	};
	shelter_code: string;
	created_at: string;
	updated_at: string;
	timeline: ReferralTimeline;
	reason?: string;
	notes?: string;
	evacuee_id?: string;
	national_id?: string; // Ensured omitted in external scopes if present
}

/**
 * Redacts referral document based on the request's authorization scope.
 * - 'internal': returns the full, unmodified Referral document.
 * - 'public' | 'fam' | 'eoc': redacts sensitive fields.
 *   - If target organisation is a hospital (medical referral):
 *     - Completely strips `reason`, `notes`, `to_org.name`, and `to_org.contact`.
 *     - Strips `evacuee_id` (PII).
 *   - For non-hospital referrals:
 *     - Strips `evacuee_id` to prevent PII leakage.
 *     - Keeps the generic reason and organisation details.
 */
export function redactForScope(doc: Referral, scope: ReferralScope): Referral | RedactedReferral {
	if (scope === 'internal') {
		return doc;
	}

	const isHospital = doc.to_org.kind === 'hospital';

	// Base redacted object
	const redacted: RedactedReferral = {
		_id: doc._id,
		type: doc.type,
		status: doc.status,
		urgency: doc.urgency,
		to_org: {
			kind: doc.to_org.kind
		},
		shelter_code: doc.shelter_code,
		created_at: doc.created_at,
		updated_at: doc.updated_at,
		timeline: doc.timeline
	};

	if (isHospital) {
		// Medical emergency: completely redact details and organisation name/contact
		// to comply with NFR-5 and FR-48.
		return redacted;
	} else {
		// Non-hospital: we can share the reason/notes, and organization details,
		// but we still strip direct evacuee identifiers (PII).
		redacted.to_org.name = doc.to_org.name;
		redacted.to_org.contact = doc.to_org.contact;
		redacted.reason = doc.reason;
		redacted.notes = doc.notes;
		return redacted;
	}
}
