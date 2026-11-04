import { describe, expect, it } from 'vitest';
import { EVACUEE_SCHEMA_V, evacueeConsentSchema } from './consent';
import { planConsentBackfill, type BackfillCandidate } from './consent-backfill';

const NOW = new Date('2026-10-25T03:15:00.000Z');
const LATER = new Date('2026-10-26T08:00:00.000Z');

interface TestEvacuee extends BackfillCandidate {
	type: 'evacuee';
	privacy: { search_excluded: boolean };
	medical_summary?: string;
}

function evacuee(id: string, overrides: Partial<TestEvacuee> = {}): TestEvacuee {
	return {
		_id: id,
		type: 'evacuee',
		schema_v: 14,
		updated_at: '2026-09-01T00:00:00.000Z',
		privacy: { search_excluded: false },
		...overrides
	};
}

describe('planConsentBackfill', () => {
	it('sets health from the presence of a medical doc and writes valid backfill consent', () => {
		const { updates } = planConsentBackfill(
			[evacuee('evacuee:a'), evacuee('evacuee:b')],
			new Set(['evacuee:a']),
			NOW
		);
		const [a, b] = updates;
		expect(a.consent.health).toBe(true);
		expect(b.consent.health).toBe(false);
		for (const doc of updates) {
			expect(evacueeConsentSchema.safeParse(doc.consent).success).toBe(true);
			expect(doc.consent).toMatchObject({
				mode: 'full',
				given_by: 'backfill',
				channel: 'backfill',
				notice_version: 'backfill',
				giver_evacuee_id: null,
				recorded_verbally_by: null,
				given_at: NOW.toISOString()
			});
		}
		expect(a.consent.ref).not.toBe(b.consent.ref);
	});

	it('leaves privacy and every other field untouched', () => {
		const excluded = evacuee('evacuee:x', {
			privacy: { search_excluded: true },
			medical_summary: 'asthma'
		});
		const [updated] = planConsentBackfill([excluded], new Set(['evacuee:x']), NOW).updates;
		expect(updated.privacy).toEqual({ search_excluded: true });
		expect(updated.medical_summary).toBe('asthma');
		expect(updated).toEqual({
			...excluded,
			consent: updated.consent,
			schema_v: EVACUEE_SCHEMA_V,
			updated_at: NOW.toISOString()
		});
	});

	it('does not mutate its input', () => {
		const input = evacuee('evacuee:a');
		const snapshot = structuredClone(input);
		planConsentBackfill([input], new Set(), NOW);
		expect(input).toEqual(snapshot);
	});

	it('skips anonymized evacuees and evacuees that already have consent, and counts them', () => {
		const existing = {
			mode: 'basic',
			health: false,
			ref: 'CS-7K3QZ9MD',
			given_at: '2026-10-01T00:00:00.000Z',
			notice_version: 'v1',
			channel: 'kiosk',
			given_by: 'self',
			giver_evacuee_id: null,
			recorded_verbally_by: null
		};
		const { updates, counts } = planConsentBackfill(
			[
				evacuee('evacuee:new'),
				evacuee('evacuee:anon', { anonymized: true }),
				evacuee('evacuee:has', { consent: existing, schema_v: 15 })
			],
			new Set(),
			NOW
		);
		expect(updates.map((doc) => doc._id)).toEqual(['evacuee:new']);
		expect(counts).toEqual({
			scanned: 3,
			backfilled: 1,
			skippedHasConsent: 1,
			skippedAnonymized: 1
		});
	});

	it('never lowers schema_v', () => {
		const { updates } = planConsentBackfill(
			[
				evacuee('evacuee:old', { schema_v: 9 }),
				evacuee('evacuee:missing', { schema_v: undefined }),
				evacuee('evacuee:newer', { schema_v: EVACUEE_SCHEMA_V + 3 })
			],
			new Set(),
			NOW
		);
		expect(updates.map((doc) => doc.schema_v)).toEqual([
			EVACUEE_SCHEMA_V,
			EVACUEE_SCHEMA_V,
			EVACUEE_SCHEMA_V + 3
		]);
	});

	it('is idempotent: a second run over its own output backfills nothing and changes nothing', () => {
		const first = planConsentBackfill(
			[evacuee('evacuee:a'), evacuee('evacuee:b', { anonymized: true })],
			new Set(['evacuee:a']),
			NOW
		);
		const afterFirst = [
			...first.updates,
			evacuee('evacuee:b', { anonymized: true })
		] as TestEvacuee[];
		const second = planConsentBackfill(afterFirst, new Set(['evacuee:a']), LATER);
		expect(second.updates).toEqual([]);
		expect(second.counts).toEqual({
			scanned: 2,
			backfilled: 0,
			skippedHasConsent: 1,
			skippedAnonymized: 1
		});
		expect(afterFirst[0].consent).toEqual(first.updates[0].consent);
	});
});
