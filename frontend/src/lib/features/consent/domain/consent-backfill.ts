import { EVACUEE_SCHEMA_V, backfillConsent, type EvacueeConsent } from './consent';

export interface BackfillCandidate {
	_id: string;
	consent?: unknown;
	anonymized?: boolean;
	schema_v?: number;
	updated_at?: string;
}

export interface BackfillCounts {
	scanned: number;
	backfilled: number;
	skippedHasConsent: number;
	skippedAnonymized: number;
}

export type BackfilledDoc<E extends BackfillCandidate> = Omit<E, 'consent' | 'schema_v'> & {
	consent: EvacueeConsent;
	schema_v: number;
	updated_at: string;
};

export function emptyBackfillCounts(): BackfillCounts {
	return { scanned: 0, backfilled: 0, skippedHasConsent: 0, skippedAnonymized: 0 };
}

export function backfillEvacueeDoc<E extends BackfillCandidate>(
	evacuee: E,
	hasMedicalDoc: boolean,
	now: Date
): BackfilledDoc<E> | null {
	const consent = backfillConsent(evacuee, hasMedicalDoc, now);
	if (consent === null) return null;
	return {
		...evacuee,
		consent,
		schema_v: Math.max(evacuee.schema_v ?? 0, EVACUEE_SCHEMA_V),
		updated_at: now.toISOString()
	};
}

export function planConsentBackfill<E extends BackfillCandidate>(
	evacuees: readonly E[],
	medicalEvacueeIds: ReadonlySet<string>,
	now: Date
): { updates: BackfilledDoc<E>[]; counts: BackfillCounts } {
	const counts = emptyBackfillCounts();
	const updates: BackfilledDoc<E>[] = [];
	for (const evacuee of evacuees) {
		counts.scanned++;
		const updated = backfillEvacueeDoc(evacuee, medicalEvacueeIds.has(evacuee._id), now);
		if (updated) {
			counts.backfilled++;
			updates.push(updated);
		} else if (evacuee.consent !== undefined && evacuee.consent !== null) {
			counts.skippedHasConsent++;
		} else {
			counts.skippedAnonymized++;
		}
	}
	return { updates, counts };
}
