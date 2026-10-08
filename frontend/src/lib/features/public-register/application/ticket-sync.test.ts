import { beforeEach, describe, expect, it, vi } from 'vitest';
import { syncStoredTicketStatuses } from './ticket-sync';
import { checkTicketStatus } from '../data/public-register.api';
import { getStoredTickets, removeStoredTicket } from '../data/ticket-storage';

vi.mock('../data/public-register.api', () => ({ checkTicketStatus: vi.fn() }));
vi.mock('../data/ticket-storage', () => ({
	getStoredTickets: vi.fn(),
	removeStoredTicket: vi.fn()
}));

const ticket = (code: string) => ({ code }) as never;

describe('syncStoredTicketStatuses', () => {
	beforeEach(() => {
		vi.mocked(checkTicketStatus).mockReset();
		vi.mocked(removeStoredTicket).mockReset();
		vi.mocked(getStoredTickets).mockReset();
		vi.mocked(getStoredTickets).mockReturnValue([ticket('A'), ticket('B')]);
	});

	it('removes only tickets confirmed as verified', async () => {
		vi.mocked(checkTicketStatus).mockImplementation(async (code) => ({
			success: true,
			verified: code === 'A'
		}));

		const result = await syncStoredTicketStatuses();

		expect(result).toEqual({ verified: ['A'], notFound: [] });
		expect(removeStoredTicket).toHaveBeenCalledTimes(1);
		expect(removeStoredTicket).toHaveBeenCalledWith('A');
	});

	it('keeps pending tickets', async () => {
		vi.mocked(checkTicketStatus).mockResolvedValue({
			success: true,
			verified: false,
			status: 'open'
		});

		const result = await syncStoredTicketStatuses();

		expect(result).toEqual({ verified: [], notFound: [] });
		expect(removeStoredTicket).not.toHaveBeenCalled();
	});

	it('reports notFound tickets but never removes them', async () => {
		vi.mocked(checkTicketStatus).mockResolvedValue({
			success: true,
			verified: false,
			notFound: true
		});

		const result = await syncStoredTicketStatuses();

		expect(result).toEqual({ verified: [], notFound: ['A', 'B'] });
		expect(removeStoredTicket).not.toHaveBeenCalled();
	});

	it('keeps tickets when the status check fails (upstream error result or thrown)', async () => {
		vi.mocked(checkTicketStatus)
			.mockResolvedValueOnce({ success: false, verified: false, error: 'STATUS_UNAVAILABLE' })
			.mockRejectedValueOnce(new Error('network down'));

		const result = await syncStoredTicketStatuses();

		expect(result).toEqual({ verified: [], notFound: [] });
		expect(removeStoredTicket).not.toHaveBeenCalled();
	});

	it('returns empty result when nothing is stored', async () => {
		vi.mocked(getStoredTickets).mockReturnValue([]);

		const result = await syncStoredTicketStatuses();

		expect(result).toEqual({ verified: [], notFound: [] });
		expect(checkTicketStatus).not.toHaveBeenCalled();
	});
});
