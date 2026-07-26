import { describe, it, expect } from 'vitest';
import { buildValidateDocUpdate } from './shelter-access-design';

describe('buildValidateDocUpdate', () => {
	it('includes audit in the allowed doc type whitelist', () => {
		const validateFn = buildValidateDocUpdate('SH001');
		expect(validateFn).toContain("'audit'");
		expect(validateFn).toMatch(
			/var allowed = \['evacuee', 'donation', 'donation_campaign', 'stock_ledger', 'donation_slot', 'audit', 'purchase'\]/
		);
	});

	// CR-032: purchase docs are written to shelter dbs, so the server-side
	// whitelist must accept them or every write is rejected as forbidden.
	it('includes purchase in the allowed doc type whitelist', () => {
		expect(buildValidateDocUpdate('SH001')).toContain("'purchase'");
	});
});
