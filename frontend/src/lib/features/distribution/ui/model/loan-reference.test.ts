import { describe, expect, it } from 'vitest';
import { formatLoanReference, loanReferenceLine } from './loan-reference';

const log = {
	_id: 'distribution_log:01JABCDEFGHJKMNPQRSTVWXYZ0',
	distributed_at: '2026-07-04T14:30:00.000Z',
	distributed_by: 'org.couchdb.user:desk01'
};

describe('formatLoanReference', () => {
	it('builds ticket, time, distributor and short ref', () => {
		const ref = formatLoanReference(log, { ticket_no: 'TKT-SUP-1' });
		expect(ref.ticketNo).toBe('TKT-SUP-1');
		expect(ref.by).toBe('desk01');
		expect(ref.shortRef).toBe('VWXYZ0');
		expect(ref.when).toMatch(/21:30/);
		expect(ref.when).not.toContain('distribution_log');
	});

	it('omits ticket number when the ticket is unknown', () => {
		const ref = formatLoanReference(log, undefined);
		expect(ref.ticketNo).toBeUndefined();
		expect(loanReferenceLine(ref)).toMatch(/^4 .* · #VWXYZ0$/);
	});
});
