import { describe, expect, it } from 'vitest';
import cases from '../../../../../../packages/tent-model/contracts/evacuee-consent.cases.json';
import {
	CONSENT_CHANNELS,
	CONSENT_GIVERS,
	CONSENT_MODES,
	EVACUEE_SCHEMA_V,
	evacueeConsentSchema
} from './consent';

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
});
