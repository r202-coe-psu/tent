import { describe, expect, it } from 'vitest';
import {
	BACKFILL_NOTICE_VERSION,
	EVACUEE_SCHEMA_V,
	SURFACE_CAPS,
	backfillConsent,
	bindConsent,
	consentDecisionSchemaFor,
	consentVduClause,
	evacueeConsentSchema,
	formatConsentTime,
	initialSearchVisible,
	mintConsentStamp,
	planRegistrationConsent,
	resolveRegistrationConsent,
	summarizeConsent,
	type BlockChannel,
	type ConsentDecision,
	type ConsentMember,
	type EvacueeConsent
} from './consent';
import { CONSENT_COPY, CONSENT_NOTICE_VERSION } from './consent-notice.i18n';

const stamp = {
	ref: 'CS-7K3QZ9MD',
	given_at: '2026-10-25T03:15:00.000Z',
	notice_version: CONSENT_NOTICE_VERSION
};

function full(overrides: Record<string, unknown> = {}): ConsentDecision {
	return {
		mode: 'full',
		health: true,
		search_visible: true,
		guardian_for: [],
		verbal: false,
		...stamp,
		...overrides
	} as ConsentDecision;
}

function basic(overrides: Record<string, unknown> = {}): ConsentDecision {
	return {
		mode: 'basic',
		guardian_for: [],
		verbal: false,
		...stamp,
		...overrides
	} as ConsentDecision;
}

const family: ConsentMember[] = [
	{ key: 'reg', alreadyConsented: false },
	{ key: 'kid1', alreadyConsented: false },
	{ key: 'kid2', alreadyConsented: false },
	{ key: 'adult', alreadyConsented: false }
];

function plan(
	decision: ConsentDecision,
	overrides: { channel?: BlockChannel; members?: ConsentMember[]; recordedBy?: string | null } = {}
) {
	return planRegistrationConsent(decision, {
		channel: 'staff',
		members: family,
		recordedBy: null,
		...overrides
	});
}

function byKey<T extends { key: string }>(items: readonly T[]) {
	return Object.fromEntries(items.map((item) => [item.key, item]));
}

describe('basic mode (FR-11, FR-31)', () => {
	it('records every member as no health, no search, no medical', () => {
		for (const p of plan(basic())) {
			expect(p.consent.mode).toBe('basic');
			expect(p.consent.health).toBe(false);
			expect(p.searchExcluded).toBe(true);
			expect(p.medicalAllowed).toBe(false);
		}
	});

	it('cannot carry health or search choices at all', () => {
		const schema = consentDecisionSchemaFor('staff');
		expect(schema.safeParse(basic()).success).toBe(true);
		expect(schema.safeParse(basic({ health: true })).success).toBe(false);
		expect(schema.safeParse(basic({ search_visible: true })).success).toBe(false);
	});
});

describe('full mode (FR-30, FR-32)', () => {
	it('maps the search choice onto privacy.search_excluded', () => {
		expect(plan(full({ search_visible: true })).every((p) => !p.searchExcluded)).toBe(true);
		expect(plan(full({ search_visible: false })).every((p) => p.searchExcluded)).toBe(true);
	});

	it('keeps the health choice on the consent and gates medical on it', () => {
		const yes = plan(full({ health: true }));
		expect(yes.every((p) => p.consent.health && p.medicalAllowed)).toBe(true);
		const no = plan(full({ health: false }));
		expect(no.every((p) => !p.consent.health && !p.medicalAllowed)).toBe(true);
		expect(no.every((p) => p.consent.mode === 'full')).toBe(true);
	});
});

describe('who gave consent (FR-33)', () => {
	it('maps registrant to self, picked members to guardian and the rest to household_member', () => {
		const plans = byKey(plan(full({ guardian_for: ['kid1', 'kid2'] })));
		expect(plans.reg.consent.given_by).toBe('self');
		expect(plans.kid1.consent.given_by).toBe('guardian');
		expect(plans.kid2.consent.given_by).toBe('guardian');
		expect(plans.adult.consent.given_by).toBe('household_member');
	});

	it('gives every member the same ref, timestamp and notice version', () => {
		const consents = plan(full({ guardian_for: ['kid1'] })).map((p) => p.consent);
		expect(new Set(consents.map((c) => c.ref)).size).toBe(1);
		expect(new Set(consents.map((c) => c.given_at)).size).toBe(1);
		expect(consents.every((c) => c.notice_version === CONSENT_NOTICE_VERSION)).toBe(true);
	});

	it('binds the registrant evacuee id as giver for everyone but the registrant', () => {
		const writes = resolveRegistrationConsent(
			full({ guardian_for: ['kid1'] }),
			family.map((m) => ({ ...m, evacueeId: `evacuee:${m.key}` })),
			{ channel: 'staff', recordedBy: null }
		);
		expect(writes.get('reg')?.consent.giver_evacuee_id).toBeNull();
		expect(writes.get('kid1')?.consent.giver_evacuee_id).toBe('evacuee:reg');
		expect(writes.get('adult')?.consent.giver_evacuee_id).toBe('evacuee:reg');
	});

	it('produces only consents the persisted schema accepts', () => {
		const decisions = [basic(), full(), full({ health: false, search_visible: false })];
		for (const decision of decisions) {
			const writes = resolveRegistrationConsent(
				{ ...decision, guardian_for: ['kid1'] },
				family.map((m) => ({ ...m, evacueeId: `evacuee:${m.key}` })),
				{ channel: 'web', recordedBy: null }
			);
			for (const write of writes.values()) {
				expect(evacueeConsentSchema.safeParse(write.consent).success).toBe(true);
			}
		}
	});

	it('binds null for a self consent', () => {
		const [self] = plan(full());
		expect(bindConsent(self, 'evacuee:reg').consent.giver_evacuee_id).toBeNull();
	});

	it('rejects a guardian key that is not a member or is the registrant', () => {
		expect(() => plan(full({ guardian_for: ['ghost'] }))).toThrow();
		expect(() => plan(full({ guardian_for: ['reg'] }))).toThrow();
	});
});

describe('already consented members (FR-41)', () => {
	it('skips them entirely', () => {
		const members = family.map((m) => (m.key === 'kid1' ? { ...m, alreadyConsented: true } : m));
		const keys = plan(full(), { members }).map((p) => p.key);
		expect(keys).toEqual(['reg', 'kid2', 'adult']);
	});

	it('plans nothing when everyone has consent', () => {
		const members = family.map((m) => ({ ...m, alreadyConsented: true }));
		expect(plan(full(), { members })).toEqual([]);
	});

	it('still treats members[0] as the giver when the registrant is already consented', () => {
		const members = family.map((m) => (m.key === 'reg' ? { ...m, alreadyConsented: true } : m));
		const writes = resolveRegistrationConsent(
			full(),
			members.map((m) => ({ ...m, evacueeId: `evacuee:${m.key}` })),
			{ channel: 'staff', recordedBy: null }
		);
		expect(writes.has('reg')).toBe(false);
		expect(writes.get('kid1')?.consent.given_by).toBe('household_member');
		expect(writes.get('kid1')?.consent.giver_evacuee_id).toBe('evacuee:reg');
	});
});

describe('verbal recording per channel', () => {
	it('records the staff user when ticked on the staff channel', () => {
		const plans = plan(full({ verbal: true }), { recordedBy: 'USR-0427' });
		expect(plans.every((p) => p.consent.recorded_verbally_by === 'USR-0427')).toBe(true);
	});

	it('ignores the staff user when the box is not ticked', () => {
		const plans = plan(full(), { recordedBy: 'USR-0427' });
		expect(plans.every((p) => p.consent.recorded_verbally_by === null)).toBe(true);
	});

	it('requires a staff user for a verbal consent', () => {
		expect(() => plan(full({ verbal: true }))).toThrow();
	});

	it('refuses verbal consent on web and kiosk', () => {
		for (const channel of ['web', 'kiosk'] as const) {
			expect(() => plan(full({ verbal: true }), { channel, recordedBy: 'USR-0427' })).toThrow();
			expect(consentDecisionSchemaFor(channel).safeParse(full({ verbal: true })).success).toBe(
				false
			);
		}
	});

	it('refuses guardian picks on kiosk but not on web or staff', () => {
		const decision = full({ guardian_for: ['kid1'] });
		expect(() => plan(decision, { channel: 'kiosk' })).toThrow();
		expect(consentDecisionSchemaFor('kiosk').safeParse(decision).success).toBe(false);
		for (const channel of ['web', 'staff'] as const) {
			expect(consentDecisionSchemaFor(channel).safeParse(decision).success).toBe(true);
			expect(() => plan(decision, { channel })).not.toThrow();
		}
	});

	it('stamps the channel it was recorded on', () => {
		for (const channel of ['staff', 'web'] as const) {
			expect(plan(full(), { channel }).every((p) => p.consent.channel === channel)).toBe(true);
		}
		const kiosk = plan(full(), { channel: 'kiosk', members: [family[0]] });
		expect(kiosk[0].consent.channel).toBe('kiosk');
	});

	it('exposes the caps the surfaces share', () => {
		expect(SURFACE_CAPS).toEqual({
			staff: { guardian: true, verbal: true },
			web: { guardian: true, verbal: false },
			kiosk: { guardian: false, verbal: false }
		});
	});
});

describe('decision schema', () => {
	it('rejects unknown keys and a malformed ref', () => {
		const schema = consentDecisionSchemaFor('staff');
		expect(schema.safeParse(full({ extra: 1 })).success).toBe(false);
		expect(schema.safeParse(full({ ref: 'CS-123' })).success).toBe(false);
	});
});

describe('mintConsentStamp', () => {
	it('mints CS- plus 8 Crockford characters with the notice version and clock', () => {
		const now = new Date('2026-10-25T03:15:00.000Z');
		const minted = mintConsentStamp(now);
		expect(minted.ref).toMatch(/^CS-[0-9A-HJKMNP-TV-Z]{8}$/);
		expect(minted.given_at).toBe('2026-10-25T03:15:00.000Z');
		expect(minted.notice_version).toBe(CONSENT_NOTICE_VERSION);
	});

	it('mints a different ref for every confirm, even within one millisecond', () => {
		const now = new Date();
		const refs = new Set(Array.from({ length: 50 }, () => mintConsentStamp(now).ref));
		expect(refs.size).toBe(50);
	});
});

describe('initialSearchVisible (FR-12)', () => {
	it('starts ticked for new people', () => {
		expect(initialSearchVisible([])).toBe(true);
		expect(initialSearchVisible([{ search_excluded: false }, { search_excluded: false }])).toBe(
			true
		);
	});

	it('starts unticked when anyone was opted out already', () => {
		expect(initialSearchVisible([{ search_excluded: false }, { search_excluded: true }])).toBe(
			false
		);
	});
});

describe('formatConsentTime', () => {
	it('shows Buddhist-era date and Bangkok time', () => {
		expect(formatConsentTime('2026-10-25T03:15:00.000Z')).toBe('25/10/2569 10:15 น.');
	});

	it('shows 00 for the first hour, not 24', () => {
		expect(formatConsentTime('2026-10-24T17:05:00.000Z')).toBe('25/10/2569 00:05 น.');
	});

	it('falls back to the raw value for an invalid timestamp', () => {
		expect(formatConsentTime('not a date')).toBe('not a date');
	});
});

describe('summarizeConsent (spec §5)', () => {
	function consentOf(overrides: Record<string, unknown> = {}): EvacueeConsent {
		return {
			mode: 'full',
			health: true,
			...stamp,
			channel: 'staff',
			recorded_verbally_by: null,
			given_by: 'self',
			giver_evacuee_id: null,
			...overrides
		} as EvacueeConsent;
	}

	it('lists the base rows for a full consent', () => {
		const summary = summarizeConsent(consentOf(), false);
		expect(summary.title).toBe(CONSENT_COPY.result.titleFull);
		expect(summary.footer).toBe(CONSENT_COPY.result.withdrawNote);
		expect(summary.rows.map((r) => r.key)).toEqual([
			'mode',
			'general',
			'health',
			'search',
			'time',
			'ref'
		]);
		const rows = byKey(summary.rows);
		expect(rows.mode.value).toBe(CONSENT_COPY.summary.modeFull);
		expect(rows.general.consented).toBe(true);
		expect(rows.health.consented).toBe(true);
		expect(rows.search.consented).toBe(true);
		expect(rows.time.value).toBe('25/10/2569 10:15 น.');
		expect(rows.ref).toMatchObject({ value: 'CS-7K3QZ9MD', mono: true });
	});

	it('reports basic mode with everything declined', () => {
		const summary = summarizeConsent(consentOf({ mode: 'basic', health: false }), true);
		expect(summary.title).toBe(CONSENT_COPY.result.titleBasic);
		const rows = byKey(summary.rows);
		expect(rows.mode.value).toBe(CONSENT_COPY.summary.modeBasic);
		expect(rows.general.consented).toBe(false);
		expect(rows.health.consented).toBe(false);
		expect(rows.search.consented).toBe(false);
	});

	it('derives the search row from the current privacy flag', () => {
		expect(byKey(summarizeConsent(consentOf(), true).rows).search.consented).toBe(false);
		expect(byKey(summarizeConsent(consentOf(), false).rows).search.consented).toBe(true);
	});

	it('shows guardian and staff rows only when there is something to show', () => {
		const verbal = consentOf({ recorded_verbally_by: 'USR-0427' });
		const summary = summarizeConsent(verbal, false, {
			guardianNames: ['ด.ญ.ปิยดา', 'ด.ช.ภูมิ'],
			staff: { name: 'สมชาย', userId: 'USR-0427' }
		});
		const rows = byKey(summary.rows);
		expect(rows.guardian.value).toBe('ด.ญ.ปิยดา, ด.ช.ภูมิ');
		expect(rows.verbal.value).toBe('สมชาย (USR-0427)');
		expect(byKey(summarizeConsent(verbal, false).rows).verbal.value).toBe('USR-0427');
		expect(
			summarizeConsent(consentOf(), false, { guardianNames: [] }).rows.map((r) => r.key)
		).not.toContain('guardian');
	});
});

describe('backfillConsent (FR-50, FR-51)', () => {
	const now = new Date('2026-11-01T00:00:00.000Z');

	it('grants full mode with health following the medical doc', () => {
		const withMedical = backfillConsent({}, true, now);
		const without = backfillConsent({}, false, now);
		expect(withMedical).toMatchObject({
			mode: 'full',
			health: true,
			given_by: 'backfill',
			giver_evacuee_id: null,
			recorded_verbally_by: null,
			channel: 'backfill',
			notice_version: BACKFILL_NOTICE_VERSION,
			given_at: '2026-11-01T00:00:00.000Z'
		});
		expect(without?.health).toBe(false);
		expect(evacueeConsentSchema.safeParse(withMedical).success).toBe(true);
	});

	it('mints a fresh ref per person', () => {
		expect(backfillConsent({}, false, now)?.ref).not.toBe(backfillConsent({}, false, now)?.ref);
	});

	it('skips evacuees that already have consent or are anonymized', () => {
		expect(backfillConsent({ consent: { mode: 'basic' } }, false, now)).toBeNull();
		expect(backfillConsent({ anonymized: true }, false, now)).toBeNull();
	});

	it('is idempotent when fed its own output', () => {
		const first = backfillConsent({}, true, now);
		expect(backfillConsent({ consent: first }, true, now)).toBeNull();
	});
});

describe('consentVduClause (FR-34)', () => {
	const run = new Function('newDoc', consentVduClause()) as (doc: unknown) => void;
	const goodConsent = {
		mode: 'full',
		health: true,
		ref: 'CS-7K3QZ9MD',
		given_at: '2026-10-25T03:15:00.000Z',
		given_by: 'self',
		giver_evacuee_id: null,
		recorded_verbally_by: null,
		channel: 'staff',
		notice_version: '2026-10-25'
	};
	const evacuee = (consent: unknown, privacy: unknown = { search_excluded: false }) => ({
		type: 'evacuee',
		consent,
		privacy
	});

	function forbidden(doc: unknown): string | null {
		try {
			run(doc);
			return null;
		} catch (e) {
			// A crash inside the clause (TypeError etc.) must fail the test, not count as a rejection.
			if (typeof (e as { forbidden?: unknown })?.forbidden !== 'string') throw e;
			return (e as { forbidden: string }).forbidden;
		}
	}

	it('accepts valid consents', () => {
		expect(forbidden(evacuee(goodConsent))).toBeNull();
		expect(forbidden(evacuee({ ...goodConsent, health: false }))).toBeNull();
		expect(
			forbidden(
				evacuee(
					{ ...goodConsent, mode: 'basic', health: false, channel: 'kiosk' },
					{ search_excluded: true }
				)
			)
		).toBeNull();
		expect(
			forbidden(evacuee({ ...goodConsent, given_by: 'guardian', giver_evacuee_id: 'evacuee:01JA' }))
		).toBeNull();
		expect(
			forbidden(
				evacuee({
					...goodConsent,
					given_by: 'backfill',
					channel: 'backfill',
					notice_version: 'backfill'
				})
			)
		).toBeNull();
	});

	it('accepts everything the policy and backfill produce', () => {
		const members = family.map((m) => ({ ...m, evacueeId: `evacuee:${m.key}` }));
		for (const decision of [basic(), full(), full({ health: false, search_visible: false })]) {
			const writes = resolveRegistrationConsent({ ...decision, guardian_for: ['kid1'] }, members, {
				channel: 'web',
				recordedBy: null
			});
			for (const write of writes.values()) {
				const privacy = { search_excluded: write.searchExcluded };
				expect(forbidden(evacuee(write.consent, privacy))).toBeNull();
			}
		}
		expect(forbidden(evacuee(backfillConsent({}, true, new Date())))).toBeNull();
	});

	it('rejects the channel couplings the zod schema also rejects', () => {
		const coupling = 'consent channel backfill and given_by backfill must go together';
		expect(forbidden(evacuee({ ...goodConsent, channel: 'backfill' }))).toBe(coupling);
		expect(forbidden(evacuee({ ...goodConsent, given_by: 'backfill', channel: 'staff' }))).toBe(
			coupling
		);
		expect(
			forbidden(evacuee({ ...goodConsent, channel: 'kiosk', recorded_verbally_by: 'staff1' }))
		).toBe('consent verbal recording is only possible on the staff channel');
	});

	it('ignores other doc types and evacuees without consent', () => {
		expect(forbidden({ type: 'household', consent: 'junk' })).toBeNull();
		expect(forbidden({ type: 'evacuee', privacy: { search_excluded: false } })).toBeNull();
	});

	it('rejects basic mode with health or without search_excluded', () => {
		const basicConsent = { ...goodConsent, mode: 'basic', health: false };
		expect(forbidden(evacuee({ ...basicConsent, health: true }, { search_excluded: true }))).toBe(
			'consent basic mode cannot have health consent'
		);
		const needsExcluded = 'consent basic mode requires privacy.search_excluded';
		expect(forbidden(evacuee(basicConsent, { search_excluded: false }))).toBe(needsExcluded);
		expect(forbidden(evacuee(basicConsent, undefined))).toBe(needsExcluded);
	});

	it('rejects bad giver coupling', () => {
		expect(forbidden(evacuee({ ...goodConsent, giver_evacuee_id: 'evacuee:01JA' }))).toBe(
			'consent giver_evacuee_id must be null for self'
		);
		expect(forbidden(evacuee({ ...goodConsent, given_by: 'guardian' }))).toBe(
			'consent giver_evacuee_id must be an evacuee id for guardian'
		);
		expect(
			forbidden(
				evacuee({ ...goodConsent, given_by: 'household_member', giver_evacuee_id: 'person:1' })
			)
		).toBe('consent giver_evacuee_id must be an evacuee id for household_member');
	});

	it('rejects malformed values', () => {
		const bad: [Record<string, unknown>, string][] = [
			[{ ref: 'cs-7k3qz9md' }, 'consent ref is invalid'],
			[{ ref: 'CS-7K3QZ9MI' }, 'consent ref is invalid'],
			[{ mode: 'partial' }, 'consent mode is invalid'],
			[{ given_by: 'parent' }, 'consent given_by is invalid'],
			[{ channel: 'phone' }, 'consent channel is invalid'],
			[{ health: 'yes' }, 'consent health must be boolean'],
			[{ given_at: 'yesterday' }, 'consent given_at is invalid'],
			[{ given_at: '2026-10-25' }, 'consent given_at is invalid'],
			[{ given_at: '2026-10-25T03:15:00' }, 'consent given_at is invalid'],
			[{ given_at: '2026-02-30T03:15:00Z' }, 'consent given_at is invalid'],
			[{ notice_version: '' }, 'consent notice_version is invalid'],
			[{ recorded_verbally_by: '' }, 'consent recorded_verbally_by is invalid']
		];
		for (const [override, message] of bad) {
			expect(forbidden(evacuee({ ...goodConsent, ...override }))).toBe(message);
		}
	});

	it('accepts offset timestamps zod accepts', () => {
		for (const given_at of ['2026-10-25T03:15Z', '2026-10-25T10:15:00+07:00']) {
			expect(forbidden(evacuee({ ...goodConsent, given_at }))).toBeNull();
		}
	});

	it('rejects a missing key and a non-object consent', () => {
		const { notice_version, ...missing } = goodConsent;
		void notice_version;
		expect(forbidden(evacuee(missing))).toBe('consent missing notice_version');
		for (const junk of [null, 'full', []]) {
			expect(forbidden(evacuee(junk))).toBe('consent must be an object');
		}
	});

	it('rethrows crashes instead of reading them as rejections', () => {
		const crashing = {
			type: 'evacuee',
			get consent(): never {
				throw new TypeError('boom');
			}
		};
		expect(() => forbidden(crashing)).toThrow(TypeError);
	});
});

describe('EVACUEE_SCHEMA_V', () => {
	it('is the version that introduced consent', () => {
		expect(EVACUEE_SCHEMA_V).toBe(15);
	});
});
