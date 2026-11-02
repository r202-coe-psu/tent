import { touch, type AuthorContext } from '$lib/db/model';
import { createAuditEntry, type AuditEntry } from '$lib/features/shared';
import {
	CONSENT_NOTICE_VERSION,
	EVACUEE_SCHEMA_V,
	type EvacueeConsent
} from '$lib/features/consent/server';
import type { Evacuee } from './people';

export const SEARCH_VISIBILITY_AUDIT_REASON = 'เจ้าตัวขอเปลี่ยนการแสดงในระบบค้นหาญาติ';

export type SearchVisibilityChange = { evacuee: Evacuee; audit: AuditEntry };

/** A `basic` consent cannot be shown in search (VDU), so showing it needs the full notice. */
export function showingNeedsFullNotice(evacuee: Evacuee, visible: boolean): boolean {
	return visible && evacuee.consent?.mode === 'basic' && !!evacuee.privacy?.search_excluded;
}

/**
 * Staff flip a person's relative-search visibility at the person's own request. Showing a
 * `basic`-consent person upgrades the consent to `full` in the same doc (the person acknowledged
 * the full notice), because the validator requires basic ⇒ search_excluded. Returns `null` when
 * nothing changes.
 */
export function planSearchVisibilityChange(
	evacuee: Evacuee,
	visible: boolean,
	ctx: AuthorContext,
	at: Date = new Date()
): SearchVisibilityChange | null {
	const from = !!evacuee.privacy?.search_excluded;
	const to = !visible;
	if (from === to) return null;

	const upgradesConsent = showingNeedsFullNotice(evacuee, visible);
	let next: Evacuee = { ...evacuee, privacy: { ...evacuee.privacy, search_excluded: to } };
	if (upgradesConsent && evacuee.consent) {
		const consent = {
			...evacuee.consent,
			mode: 'full',
			health: false,
			notice_version: CONSENT_NOTICE_VERSION,
			given_at: at.toISOString()
		} as EvacueeConsent;
		next = { ...next, schema_v: EVACUEE_SCHEMA_V, consent };
	}

	const audit = createAuditEntry(
		{
			action: 'privacy_change',
			target_type: 'evacuee',
			target_id: evacuee._id,
			reason: SEARCH_VISIBILITY_AUDIT_REASON,
			context: {
				search_excluded: { from, to },
				...(upgradesConsent ? { consent_mode: { from: 'basic', to: 'full' } } : {})
			},
			occurred_at: at.toISOString()
		},
		ctx
	);
	return { evacuee: touch(next), audit };
}
