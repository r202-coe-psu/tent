import { adjustReasonSchema } from '../../domain/operations';
import {
	toDayKey,
	type DayRange,
	type LedgerReasonFilter,
	type LedgerTypeFilter
} from './ledger-view';

/** Query keys owned by the movements tab — the page strips them when leaving it. */
export const LEDGER_PARAM_KEYS = ['range', 'from', 'to', 'type', 'lreason', 'lq', 'lpage'] as const;

export const LEDGER_PAGE_SIZE = 50;

export type LedgerRangePreset = 'today' | '7d' | '30d' | 'all' | 'custom';

export interface LedgerUrlState {
	range: LedgerRangePreset;
	/** `YYYY-MM-DD`; only meaningful when `range` is `custom`. */
	from: string;
	to: string;
	type: LedgerTypeFilter;
	/** Adjust reason filter (CR-143 FR-C5). */
	reason: LedgerReasonFilter;
	q: string;
	page: number;
}

export const LEDGER_URL_DEFAULTS: LedgerUrlState = {
	range: 'today',
	from: '',
	to: '',
	type: 'all',
	reason: 'all',
	q: '',
	page: 1
};

export const LEDGER_RANGE_LABELS: Record<LedgerRangePreset, string> = {
	today: 'วันนี้',
	'7d': '7 วันล่าสุด',
	'30d': '30 วันล่าสุด',
	all: 'ทั้งหมด',
	custom: 'กำหนดเอง'
};

const RANGES = Object.keys(LEDGER_RANGE_LABELS) as LedgerRangePreset[];
const TYPES: readonly LedgerTypeFilter[] = ['all', 'in', 'out', 'adjust', 'transfer'];
const REASONS: readonly LedgerReasonFilter[] = ['all', ...adjustReasonSchema.options];
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const validDay = (value: string | null): string =>
	value && DAY_RE.test(value) && !Number.isNaN(Date.parse(value)) ? value : '';

/** Read the movements tab state; unknown or malformed values fall back to the defaults. */
export function parseLedgerParams(params: URLSearchParams): LedgerUrlState {
	const range = params.get('range');
	const type = params.get('type');
	const reason = params.get('lreason');
	const page = Number(params.get('lpage'));
	const from = validDay(params.get('from'));
	const to = validDay(params.get('to'));
	// A bare from/to means a custom range even if `range` was dropped.
	const resolvedRange = RANGES.includes(range as LedgerRangePreset)
		? (range as LedgerRangePreset)
		: from || to
			? 'custom'
			: LEDGER_URL_DEFAULTS.range;
	const parsedType = TYPES.includes(type as LedgerTypeFilter)
		? (type as LedgerTypeFilter)
		: LEDGER_URL_DEFAULTS.type;
	return {
		range: resolvedRange,
		from,
		to,
		type: parsedType,
		// The reason chips only render for the adjust group; a stale `lreason` elsewhere would
		// filter rows with no visible control to clear it.
		reason:
			parsedType === 'adjust' && REASONS.includes(reason as LedgerReasonFilter)
				? (reason as LedgerReasonFilter)
				: LEDGER_URL_DEFAULTS.reason,
		q: params.get('lq') ?? LEDGER_URL_DEFAULTS.q,
		page: Number.isInteger(page) && page >= 1 ? page : LEDGER_URL_DEFAULTS.page
	};
}

/** Only the non-default keys. */
export function serializeLedgerParams(state: LedgerUrlState): URLSearchParams {
	const out = new URLSearchParams();
	if (state.range !== LEDGER_URL_DEFAULTS.range) out.set('range', state.range);
	if (state.range === 'custom') {
		if (state.from) out.set('from', state.from);
		if (state.to) out.set('to', state.to);
	}
	if (state.type !== LEDGER_URL_DEFAULTS.type) out.set('type', state.type);
	if (state.reason !== LEDGER_URL_DEFAULTS.reason) out.set('lreason', state.reason);
	if (state.q.trim()) out.set('lq', state.q.trim());
	if (state.page > 1) out.set('lpage', String(state.page));
	return out;
}

/** `base` with its movements keys replaced by `state`'s — every other key is kept as-is. */
export function mergeLedgerParams(base: URLSearchParams, state: LedgerUrlState): URLSearchParams {
	const out = new URLSearchParams(base);
	for (const key of LEDGER_PARAM_KEYS) out.delete(key);
	for (const [key, value] of serializeLedgerParams(state)) out.set(key, value);
	return out;
}

/** Local-day bounds of the chosen range; a custom range with `from` after `to` is swapped. */
export function resolveDayRange(state: LedgerUrlState, now: Date = new Date()): DayRange {
	const daysBack = (n: number) => {
		const d = new Date(now);
		d.setDate(d.getDate() - n);
		return toDayKey(d);
	};
	switch (state.range) {
		case 'today':
			return { from: toDayKey(now), to: toDayKey(now) };
		case '7d':
			return { from: daysBack(6), to: toDayKey(now) };
		case '30d':
			return { from: daysBack(29), to: toDayKey(now) };
		case 'all':
			return { from: null, to: null };
		case 'custom': {
			const from = state.from || null;
			const to = state.to || null;
			return from && to && from > to ? { from: to, to: from } : { from, to };
		}
	}
}
