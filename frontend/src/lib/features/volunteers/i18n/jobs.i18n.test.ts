import { describe, expect, it } from 'vitest';
import { compareLanguages } from '$lib/features/people/ui/_constants/i18n-parity';
import { jobsI18n } from './jobs.i18n';

describe('jobsI18n', () => {
	it('has the same keys in TH and EN', () => {
		const { thKeys, enKeys } = compareLanguages(jobsI18n);
		expect(enKeys).toEqual(thKeys);
	});

	it('holds no Thai text in EN', () => {
		expect(compareLanguages(jobsI18n).thaiInEn).toEqual([]);
	});
});
