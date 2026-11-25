import { createInfiniteQuery } from '@tanstack/svelte-query';
import { fetchAuditLog } from '../data/audit-log.api';
import type { AuditLogFilters, AuditLogPage } from '../domain/audit-query';

export const auditLogKeys = {
	all: ['audit-log'] as const,
	list: (filters: AuditLogFilters) => [...auditLogKeys.all, 'list', filters] as const
};

export const useAuditLog = (filters: () => AuditLogFilters, enabled: () => boolean = () => true) =>
	createInfiniteQuery(() => {
		const current = filters();
		return {
			queryKey: auditLogKeys.list(current),
			initialPageParam: undefined as string | undefined,
			queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
				fetchAuditLog({ ...current, cursor: pageParam }),
			getNextPageParam: (last: AuditLogPage) => last.next_cursor ?? undefined,
			enabled: enabled()
		};
	});
