import type { DistributionLog } from '../../domain/food-supplies';

export type HistoryFilter = 'all' | 'override' | 'expired' | 'voided';

export const HISTORY_PAGE_SIZE = 20;

export const HISTORY_FILTERS: Record<
	HistoryFilter,
	{ label: string; matches: (log: DistributionLog) => boolean }
> = {
	all: { label: 'ทั้งหมด', matches: () => true },
	override: { label: 'กรณีพิเศษ', matches: (log) => log.is_override },
	expired: { label: 'เกินเวลาปลอดภัย', matches: (log) => log.is_expired_warning === true },
	voided: { label: 'ยกเลิกแล้ว', matches: (log) => log.status === 'voided' }
};

export const HISTORY_FILTER_ORDER = Object.keys(HISTORY_FILTERS) as HistoryFilter[];

export function historyRecipientIds(logs: readonly DistributionLog[]): {
	evacueeIds: string[];
	volunteerIds: string[];
} {
	const idsOf = (type: DistributionLog['recipient_type']) =>
		[
			...new Set(
				logs.flatMap((log) =>
					log.recipient_type === type && log.recipient_id ? [log.recipient_id] : []
				)
			)
		].sort();
	return { evacueeIds: idsOf('evacuee'), volunteerIds: idsOf('volunteer') };
}

type NamedPerson = {
	_id: string;
	first_name: string;
	last_name: string;
	nickname?: string | null;
};

/** Plain names by id. The row's type badge already says จิตอาสา, so no prefix here. */
export function historyRecipientNames(people: readonly NamedPerson[]): ReadonlyMap<string, string> {
	return new Map(
		people.map((p) => [
			p._id,
			`${p.first_name} ${p.last_name}${p.nickname ? ` (${p.nickname})` : ''}`
		])
	);
}

export function summarizeHistory(logs: readonly DistributionLog[]): {
	rows: number;
	people: number;
	counts: Record<HistoryFilter, number>;
} {
	const live = logs.filter((log) => log.status !== 'voided');
	const people = new Set(live.map((log) => `${log.recipient_type}:${log.recipient_id ?? log._id}`));
	const counts = Object.fromEntries(
		HISTORY_FILTER_ORDER.map((key) => [key, logs.filter(HISTORY_FILTERS[key].matches).length])
	) as Record<HistoryFilter, number>;
	return { rows: live.length, people: people.size, counts };
}

export function filterHistory(
	logs: readonly DistributionLog[],
	options: { filter: HistoryFilter; query: string; names: ReadonlyMap<string, string> }
): DistributionLog[] {
	const needle = options.query.trim().toLowerCase();
	const { matches } = HISTORY_FILTERS[options.filter];
	return logs
		.filter((log) => {
			if (!matches(log)) return false;
			if (!needle) return true;
			const id = log.recipient_id ?? '';
			return [options.names.get(id) ?? '', id, log.override_reason ?? ''].some((text) =>
				text.toLowerCase().includes(needle)
			);
		})
		.sort((a, b) => b.distributed_at.localeCompare(a.distributed_at));
}
