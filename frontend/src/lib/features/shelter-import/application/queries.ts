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
import { createShelter, updateShelter, sheltersKeys } from '$lib/features/shelters';
import { SHELTER_IMPORT_LOG_TYPE } from '../domain/import-log';
import { createShelterImportLog, type ImportRowResult } from '../domain/import-log';
import type { RowValidation } from '../domain/import-row';
import type { DuplicateMatch } from '../domain/duplicates';
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

export type DuplicateAction = 'skip' | 'update';

export interface ImportSheltersInput {
	filename: string;
	importedBy: string;
	rows: RowValidation[];
	/** row number -> the existing shelter it duplicates */
	duplicates: Map<number, DuplicateMatch>;
	/** what to do with those rows */
	duplicateAction: DuplicateAction;
}

export function useImportShelters() {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: async ({
			filename,
			importedBy,
			rows,
			duplicates,
			duplicateAction
		}: ImportSheltersInput) => {
			const started_at = new Date().toISOString();
			const results: ImportRowResult[] = [];
			for (const r of rows) {
				if (!r.ok || !r.shelter) {
					results.push({ row: r.row, name: r.name, status: 'validation_error', errors: r.errors });
					continue;
				}
				const duplicate = duplicates.get(r.row);
				try {
					if (duplicate && duplicateAction === 'skip') {
						results.push({
							row: r.row,
							name: r.name,
							status: 'skipped_duplicate',
							code: duplicate.existingCode,
							existing_code: duplicate.existingCode
						});
						continue;
					}
					if (duplicate && duplicateAction === 'update') {
						await updateShelter(duplicate.existingCode, r.shelter);
						results.push({
							row: r.row,
							name: r.name,
							status: 'updated',
							code: duplicate.existingCode,
							existing_code: duplicate.existingCode
						});
						continue;
					}
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
			const created_count = results.filter((x) => x.status === 'created').length;
			const updated_count = results.filter((x) => x.status === 'updated').length;
			const skipped_count = results.filter((x) => x.status === 'skipped_duplicate').length;
			const success_count = created_count + updated_count;
			const error_count = results.filter(
				(x) => x.status === 'validation_error' || x.status === 'server_error'
			).length;
			const log = createShelterImportLog(
				{
					source: 'shelter',
					filename,
					imported_by: importedBy,
					total_rows: rows.length,
					success_count,
					updated_count,
					skipped_count,
					error_count,
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
			// Build the summary from whichever outcomes actually occurred, so a
			// run that only skipped duplicates never reads "อัปเดต 0 แห่ง".
			const created = log.success_count - log.updated_count;
			const parts: string[] = [];
			if (created > 0 || log.success_count === 0) parts.push(`นำเข้า ${created} แห่ง`);
			if (log.updated_count > 0) parts.push(`อัปเดต ${log.updated_count} แห่ง`);
			if (log.skipped_count > 0) parts.push(`ข้าม ${log.skipped_count} แห่ง (ชื่อซ้ำ)`);
			if (log.error_count > 0) parts.push(`ล้มเหลว ${log.error_count} แถว`);

			if (log.error_count > 0) {
				toast.warning(`${parts.join(', ')} — ดูรายละเอียดในประวัติการนำเข้า`);
			} else {
				toast.success(parts.join(', '));
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
