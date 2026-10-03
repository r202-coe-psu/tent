import { describe, it, expect } from 'vitest';
import { nextTicketNo } from './ticket-no';

describe('nextTicketNo', () => {
	it('starts at 0001 when no tickets exist yet', () => {
		expect(nextTicketNo([], 'kitchen')).toBe('TKT-KITCHEN-0001');
	});

	it('continues after the highest existing sequence for the type', () => {
		expect(
			nextTicketNo(['TKT-KITCHEN-0001', 'TKT-KITCHEN-0003', 'TKT-KITCHEN-0002'], 'kitchen')
		).toBe('TKT-KITCHEN-0004');
	});

	it('ignores ticket numbers from other requisition types', () => {
		expect(nextTicketNo(['TKT-FOOD-0099', 'TKT-KITCHEN-0001'], 'kitchen')).toBe('TKT-KITCHEN-0002');
	});

	it('ignores malformed/non-numeric suffixes', () => {
		expect(nextTicketNo(['TKT-KITCHEN-abcd', 'TKT-KITCHEN-0005'], 'kitchen')).toBe(
			'TKT-KITCHEN-0006'
		);
	});
});
