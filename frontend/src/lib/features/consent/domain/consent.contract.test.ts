import { describe, expect, it } from 'vitest';
import cases from '../../../../../../packages/tent-model/contracts/evacuee-consent.cases.json';
import {
	CONSENT_CHANNELS,
	CONSENT_GIVERS,
	CONSENT_MODES,
	EVACUEE_SCHEMA_V,
	consentVduClause,
	evacueeConsentSchema
} from './consent';

/** Runs the ES5 VDU clause; returns the `forbidden` message, or null when it accepts. */
function vduVerdict(consent: unknown): string | null {
	const run = new Function('newDoc', consentVduClause()) as (doc: unknown) => void;
	try {
		// basic mode needs privacy.search_excluded (cross-field rule), so set it for every case.
		run({ type: 'evacuee', consent, privacy: { search_excluded: true } });
		return null;
	} catch (e) {
		if (typeof (e as { forbidden?: unknown })?.forbidden !== 'string') throw e;
		return (e as { forbidden: string }).forbidden;
	}
}

describe('evacuee consent contract fixture', () => {
	it('lists the same enums and schema_v as the TypeScript constants', () => {
		expect(cases.enums.modes).toEqual([...CONSENT_MODES]);
		expect(cases.enums.givers).toEqual([...CONSENT_GIVERS]);
		expect(cases.enums.channels).toEqual([...CONSENT_CHANNELS]);
		expect(cases.schema_v).toBe(EVACUEE_SCHEMA_V);
	});

	it.each(cases.valid.map((c) => [c.name, c.consent] as const))('accepts: %s', (_name, consent) => {
		expect(evacueeConsentSchema.safeParse(consent).success).toBe(true);
	});

	it.each(cases.invalid.map((c) => [c.name, c.consent] as const))(
		'rejects: %s',
		(_name, consent) => {
			expect(evacueeConsentSchema.safeParse(consent).success).toBe(false);
		}
	);

	it.each(cases.valid.map((c) => [c.name, c.consent] as const))(
		'VDU clause accepts: %s',
		(_name, consent) => {
			expect(vduVerdict(consent)).toBeNull();
		}
	);

	it.each(cases.invalid.map((c) => [c.name, c.consent] as const))(
		'VDU clause rejects: %s',
		(_name, consent) => {
			expect(vduVerdict(consent)).toMatch(/^consent /);
		}
	);
});
