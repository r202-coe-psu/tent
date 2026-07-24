/**
 * T-34.3 — Referral redaction for data privacy (FR-48/NFR-5 compliance)
 *
 * Pure TypeScript — No I/O, No PouchDB, No Svelte.
 * Ensures medical info (notes/reason for hospital targets) and PII are redacted
 * when accessed outside internal shelter manager/staff scopes (e.g. public, FAM, EOC).
 */

import type { Referral, ReferralStatus, ReferralTimeline, ReferralType } from './referral.schema';

export type ReferralScope = 'internal' | 'public' | 'fam' | 'eoc';

export interface RedactedReferral {
	_id: string;
	type: 'referral';
	status: ReferralStatus;
	referral_type?: ReferralType;
	to_shelter_code?: string;
	urgency: 'normal' | 'urgent';
	to_org?: {
		kind?: 'hospital' | 'social_services' | 'other';
		name?: string;
		contact?: string;
	};
	shelter_code: string;
	created_at: string;
	updated_at: string;
	timeline: ReferralTimeline;
	reason?: string;
	response_reason?: string;
	notes?: string;
	evacuee_id?: string;
	national_id?: string;
}

/**
 * Redacts referral document based on the request's authorization scope.
 * - 'internal': returns the full, unmodified Referral document.
 * - 'public' | 'fam' | 'eoc': redacts sensitive fields.
 */
export function redactForScope(doc: Referral, scope: ReferralScope): Referral | RedactedReferral {
	if (scope === 'internal') {
		return doc;
	}

	const isHospital = doc.referral_type === 'medical-emergency' || doc.to_org?.kind === 'hospital';

	// Base redacted object
	const redacted: RedactedReferral = {
		_id: doc._id,
		type: doc.type,
		status: doc.status,
		referral_type: doc.referral_type,
		to_shelter_code: doc.to_shelter_code,
		urgency: doc.urgency,
		to_org: doc.to_org
			? {
					kind: doc.to_org.kind
				}
			: undefined,
		shelter_code: doc.shelter_code,
		created_at: doc.created_at,
		updated_at: doc.updated_at,
		timeline: doc.timeline
	};

	if (isHospital) {
		// Medical emergency: completely redact medical details and contact
		return redacted;
	} else {
		// Non-hospital: share reason/notes/org details, strip evacuee PII
		if (redacted.to_org && doc.to_org) {
			redacted.to_org.name = doc.to_org.name;
			redacted.to_org.contact = doc.to_org.contact;
		}
		redacted.reason = doc.reason;
		redacted.response_reason = doc.response_reason;
		redacted.notes = doc.notes;
		return redacted;
	}
}
