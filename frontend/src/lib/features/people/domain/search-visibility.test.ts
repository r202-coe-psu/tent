// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
	CONSENT_NOTICE_VERSION,
	EVACUEE_SCHEMA_V,
	mintConsentStamp,
	type EvacueeConsent
} from '$lib/features/consent/server';
import { createEvacuee, type Evacuee } from './people';
import { planSearchVisibilityChange, showingNeedsFullNotice } from './search-visibility';

const ctx = { shelterCode: 'SH001', createdBy: 'staff01' };
const AT = new Date('2026-10-30T04:00:00.000Z');

function consentOf(mode: 'full' | 'basic'): EvacueeConsent {
	return {
		mode,
		health: false,
		...mintConsentStamp(new Date('2026-10-01T03:00:00.000Z')),
		notice_version: '2026-10-01',
		channel: 'staff',
		given_by: 'guardian',
		giver_evacuee_id: 'evacuee:01GIVER',
		recorded_verbally_by: 'staff01'
	} as EvacueeConsent;
}

function person(over: Partial<Evacuee> = {}): Evacuee {
	const base = createEvacuee(
		{
			first_name: 'สมชาย',
			last_name: 'ใจดี',
			gender: 'male',
			phone: '0812345678',
			country: 'THAILAND',
			person_id: { cardType: 'anonymous', number: '' }
		} as Parameters<typeof createEvacuee>[0],
		ctx,
		null
	);
	return { ...base, ...over };
}

describe('planSearchVisibilityChange', () => {
	it('hides a visible person and records the change in the audit entry', () => {
		const ev = person({ privacy: { search_excluded: false }, consent: consentOf('full') });
		const plan = planSearchVisibilityChange(ev, false, ctx, AT);

		expect(plan?.evacuee.privacy.search_excluded).toBe(true);
		expect(plan?.evacuee.consent).toEqual(ev.consent);
		expect(plan?.audit).toMatchObject({
			type: 'audit',
			action: 'privacy_change',
			target_type: 'evacuee',
			target_id: ev._id,
			context: { search_excluded: { from: false, to: true } }
		});
		expect(plan?.audit.reason).not.toBe('');
		expect(plan?.audit.context).not.toHaveProperty('consent_mode');
	});

	it('shows a basic-consent person by upgrading consent to full with a fresh acknowledgement', () => {
		const ev = person({ privacy: { search_excluded: true }, consent: consentOf('basic') });
		const plan = planSearchVisibilityChange(ev, true, ctx, AT);

		expect(plan?.evacuee.privacy.search_excluded).toBe(false);
		expect(plan?.evacuee.schema_v).toBe(EVACUEE_SCHEMA_V);
		expect(plan?.evacuee.consent).toMatchObject({
			mode: 'full',
			health: false,
			notice_version: CONSENT_NOTICE_VERSION,
			given_at: AT.toISOString(),
			ref: ev.consent?.ref,
			given_by: 'guardian',
			giver_evacuee_id: 'evacuee:01GIVER',
			channel: 'staff'
		});
		expect(plan?.audit.context).toEqual({
			search_excluded: { from: true, to: false },
			consent_mode: { from: 'basic', to: 'full' }
		});
	});

	it('shows a full-consent person who was hidden without touching consent', () => {
		const ev = person({ privacy: { search_excluded: true }, consent: consentOf('full') });
		const plan = planSearchVisibilityChange(ev, true, ctx, AT);

		expect(plan?.evacuee.privacy.search_excluded).toBe(false);
		expect(plan?.evacuee.consent).toEqual(ev.consent);
		expect(plan?.audit.context).toEqual({ search_excluded: { from: true, to: false } });
	});

	it('returns null when the visibility already matches', () => {
		const hidden = person({ privacy: { search_excluded: true }, consent: consentOf('basic') });
		const shown = person({ privacy: { search_excluded: false } });
		expect(planSearchVisibilityChange(hidden, false, ctx, AT)).toBeNull();
		expect(planSearchVisibilityChange(shown, true, ctx, AT)).toBeNull();
	});

	it('flips privacy only on a doc without consent', () => {
		const legacy = { ...person({ privacy: { search_excluded: false } }) } as Partial<Evacuee>;
		delete legacy.consent;
		const plan = planSearchVisibilityChange(legacy as Evacuee, false, ctx, AT);

		expect(plan?.evacuee.privacy.search_excluded).toBe(true);
		expect(plan?.evacuee).not.toHaveProperty('consent');
	});

	it('bumps updated_at on the evacuee', () => {
		const ev = person({ updated_at: '2020-01-01T00:00:00.000Z' });
		expect(planSearchVisibilityChange(ev, false, ctx, AT)?.evacuee.updated_at).not.toBe(
			ev.updated_at
		);
	});
});

describe('showingNeedsFullNotice', () => {
	it('is true only when showing a hidden basic-consent person', () => {
		const basic = person({ privacy: { search_excluded: true }, consent: consentOf('basic') });
		expect(showingNeedsFullNotice(basic, true)).toBe(true);
		expect(showingNeedsFullNotice(basic, false)).toBe(false);
		expect(
			showingNeedsFullNotice(
				person({ privacy: { search_excluded: true }, consent: consentOf('full') }),
				true
			)
		).toBe(false);
	});
});
