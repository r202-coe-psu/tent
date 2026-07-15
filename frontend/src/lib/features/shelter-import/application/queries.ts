import {
	createMutation,
	createQuery,
	useQueryClient,
	type QueryClient
} from '@tanstack/svelte-query';
import { toast } from 'svelte-sonner';
import {
	subscribeDataChanges,
	type SubscribeDataChangesHandle
} from '$lib/db/subscribe-data-changes';
import { createShelter, sheltersKeys } from '$lib/features/shelters';
import { SHELTER_IMPORT_LOG_TYPE } from '../domain/import-log';
import { createShelterImportLog, type ImportRowResult } from '../domain/import-log';
import type { RowValidation } from '../domain/import-row';
import { IMPORT_LOG_REGISTRY_DB, listImportLogs, writeImportLog } from '../data/import-log.remote';

/**
 * Shelter Excel import — TanStack Query wiring (CR-039).
 *
 * The import mutation POSTs valid rows one at a time (the back-office endpoint
 * mints codes as `max(SHxxx)+1`, so parallel writes would collide), records the
 * per-row outcome in a `shelter_import_log`, then invalidates the shelter list.
 * Log reactivity rides the `registry` changes feed — no polling.
 */

export const shelterImportKeys = {
	all: ['shelter-import'] as const,
	logs: () => [...shelterImportKeys.all, 'logs'] as const
};

export function useImportLogs() {
	return createQuery(() => ({
		queryKey: shelterImportKeys.logs(),
		queryFn: () => listImportLogs()
	}));
}

export interface ImportSheltersInput {
	filename: string;
	importedBy: string;
	rows: RowValidation[];
}

export function useImportShelters() {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: async ({ filename, importedBy, rows }: ImportSheltersInput) => {
			const started_at = new Date().toISOString();
			const results: ImportRowResult[] = [];
			for (const r of rows) {
				if (!r.ok || !r.shelter) {
					results.push({ row: r.row, name: r.name, status: 'validation_error', errors: r.errors });
					continue;
				}
				try {
					const res = await createShelter(r.shelter);
					results.push({ row: r.row, name: r.name, status: 'created', code: res.code });
				} catch (e) {
					results.push({
						row: r.row,
						name: r.name,
						status: 'server_error',
						errors: [{ column: '-', message: e instanceof Error ? e.message : 'สร้างไม่สำเร็จ' }]
					});
				}
			}
			const finished_at = new Date().toISOString();
			const success_count = results.filter((x) => x.status === 'created').length;
			const log = createShelterImportLog(
				{
					source: 'shelter',
					filename,
					imported_by: importedBy,
					total_rows: rows.length,
					success_count,
					error_count: rows.length - success_count,
					results,
					started_at,
					finished_at
				},
				importedBy
			);
			await writeImportLog(log);
			return log;
		},
		onSuccess: (log) => {
			queryClient.invalidateQueries({ queryKey: sheltersKeys.all });
			queryClient.invalidateQueries({ queryKey: shelterImportKeys.logs() });
			if (log.error_count === 0) {
				toast.success(`นำเข้าศูนย์พักพิงสำเร็จ ${log.success_count} แห่ง`);
			} else {
				toast.warning(
					`นำเข้าสำเร็จ ${log.success_count} แห่ง, ล้มเหลว ${log.error_count} แถว — ดูรายละเอียดในประวัติการนำเข้า`
				);
			}
		},
		onError: (e: unknown) => {
			toast.error(e instanceof Error ? e.message : 'นำเข้าไม่สำเร็จ');
		}
	}));
}

/** Wire the `registry` changes feed → import-log query invalidation. */
export function startShelterImportLiveQuery(queryClient: QueryClient): SubscribeDataChangesHandle {
	return subscribeDataChanges(queryClient, IMPORT_LOG_REGISTRY_DB, (type) =>
		type === SHELTER_IMPORT_LOG_TYPE ? [shelterImportKeys.logs()] : []
	);
}
