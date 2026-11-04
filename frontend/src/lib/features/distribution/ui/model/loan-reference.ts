import { formatThaiDateTime } from '$lib/utils/date';

export interface LoanReferenceInput {
	_id: string;
	distributed_at: string;
	distributed_by: string;
}

export interface LoanReference {
	ticketNo?: string;
	/** Thai date + time, e.g. "4 ก.ค. 2569, 21:30". */
	when: string;
	/** Distributor id without the CouchDB user prefix (no display-name lookup is available to staff). */
	by: string;
	/** Last 6 chars of the log ULID, enough to tell two loans of one item apart. */
	shortRef: string;
}

const USER_PREFIX = /^org\.couchdb\.user:/;

export function formatLoanReference(
	log: LoanReferenceInput,
	ticket?: { ticket_no: string } | null
): LoanReference {
	return {
		ticketNo: ticket?.ticket_no,
		when: formatThaiDateTime(log.distributed_at),
		by: log.distributed_by.replace(USER_PREFIX, ''),
		shortRef: log._id.slice(-6).toUpperCase()
	};
}

/** One-line summary: "TKT-1 · 4 ก.ค. 2569, 21:30 · #ABC123". */
export function loanReferenceLine(ref: LoanReference): string {
	return [ref.ticketNo, ref.when, `#${ref.shortRef}`].filter(Boolean).join(' · ');
}
