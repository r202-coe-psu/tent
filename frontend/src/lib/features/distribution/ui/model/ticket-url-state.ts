import type { RequisitionTicketStatus, RequisitionType } from '../../domain/food-supplies';
import {
	WORKFLOW_GROUP_MAP,
	constrainStatusesToGroup,
	type TicketSortDirection,
	type TicketWorkflowGroupId
} from './ticket-filters';
import { REQUISITION_TICKET_STATUSES } from './ticket-status';

/** Query keys owned by the ticket list. Anything else (`ticketId`, …) is left alone. */
export const TICKET_PARAM_KEYS = [
	'q',
	'type',
	'dest',
	'group',
	'status',
	'from',
	'to',
	'follow',
	'sort'
] as const;

export interface TicketUrlState {
	q: string;
	type: RequisitionType | 'all';
	dest: string | 'all';
	group: TicketWorkflowGroupId;
	status: RequisitionTicketStatus[];
	from: string;
	to: string;
	follow: boolean;
	sort: TicketSortDirection;
}

export const TICKET_URL_DEFAULTS: TicketUrlState = {
	q: '',
	type: 'all',
	dest: 'all',
	group: 'all',
	status: [],
	from: '',
	to: '',
	follow: false,
	sort: 'desc'
};

const TYPES: readonly RequisitionType[] = ['food', 'supplies'];
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `YYYY-MM-DD` of a real calendar day, else `''`. */
function parseDay(raw: string | null): string {
	const match = raw ? DATE_RE.exec(raw) : null;
	if (!match) return '';
	const [, y, m, d] = match;
	const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
	return date.toISOString().slice(0, 10) === raw ? (raw as string) : '';
}

/** Read the ticket list state; unknown or malformed values fall back to the defaults. */
export function parseTicketParams(params: URLSearchParams): TicketUrlState {
	const type = params.get('type');
	const groupRaw = params.get('group');
	const group =
		groupRaw && Object.hasOwn(WORKFLOW_GROUP_MAP, groupRaw)
			? (groupRaw as TicketWorkflowGroupId)
			: TICKET_URL_DEFAULTS.group;
	const statuses = (params.get('status') ?? '')
		.split(',')
		.filter(
			(s, i, arr): s is RequisitionTicketStatus =>
				REQUISITION_TICKET_STATUSES.includes(s as RequisitionTicketStatus) && arr.indexOf(s) === i
		);
	return {
		q: params.get('q') ?? TICKET_URL_DEFAULTS.q,
		type: TYPES.includes(type as RequisitionType)
			? (type as RequisitionType)
			: TICKET_URL_DEFAULTS.type,
		dest: params.get('dest') || TICKET_URL_DEFAULTS.dest,
		group,
		status: constrainStatusesToGroup(statuses, group),
		from: parseDay(params.get('from')),
		to: parseDay(params.get('to')),
		follow: params.get('follow') === '1',
		sort: params.get('sort') === 'asc' ? 'asc' : TICKET_URL_DEFAULTS.sort
	};
}

/** Only the non-default ticket keys. */
export function serializeTicketParams(state: TicketUrlState): URLSearchParams {
	const out = new URLSearchParams();
	if (state.q.trim()) out.set('q', state.q.trim());
	if (state.type !== TICKET_URL_DEFAULTS.type) out.set('type', state.type);
	if (state.dest !== TICKET_URL_DEFAULTS.dest) out.set('dest', state.dest);
	if (state.group !== TICKET_URL_DEFAULTS.group) out.set('group', state.group);
	if (state.status.length > 0) out.set('status', state.status.join(','));
	if (state.from) out.set('from', state.from);
	if (state.to) out.set('to', state.to);
	if (state.follow) out.set('follow', '1');
	if (state.sort !== TICKET_URL_DEFAULTS.sort) out.set('sort', state.sort);
	return out;
}

/** `base` with its ticket keys replaced by `state`'s — every other key is kept as-is. */
export function mergeTicketParams(base: URLSearchParams, state: TicketUrlState): URLSearchParams {
	const out = new URLSearchParams(base);
	for (const key of TICKET_PARAM_KEYS) out.delete(key);
	for (const [key, value] of serializeTicketParams(state)) out.set(key, value);
	return out;
}
