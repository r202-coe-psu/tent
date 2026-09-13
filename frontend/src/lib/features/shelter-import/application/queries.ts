import {
	createMutation,
	createQuery,
	useQueryClient,
	type QueryClient
} from '@tanstack/svelte-query';
import { toast } from 'svelte-sonner';
import { serviceFetch } from '$lib/api/service';
import {
	subscribeDataChanges,
	type SubscribeDataChangesHandle
} from '$lib/db/subscribe-data-changes';
import { SHELTER_IMPORT_LOG_TYPE } from '../domain/import-log';
import type { RowValidation } from '../domain/import-row';
import { IMPORT_LOG_REGISTRY_DB, listImportLogs } from '../data/import-log.remote';

export type ImportJobStatus = 'queued' | 'running' | 'completed' | 'completed_with_errors';
export type ImportItemStatus =
	'pending' | 'running' | 'created' | 'updated' | 'skipped' | 'failed' | 'validation_error';

export interface ImportJobItem {
	row: number;
	name: string | null;
	status: ImportItemStatus;
	code?: string;
	errors?: { column: string; message: string; sheet?: string; line?: number }[];
	attempts: number;
}

export interface ImportJob {
	_id: string;
	filename: string;
	imported_by: string;
	status: ImportJobStatus;
	total: number;
	pending: number;
	running: number;
	succeeded: number;
	failed: number;
	skipped: number;
	started_at?: string;
	finished_at?: string;
}

export interface ImportJobSummary {
	job: ImportJob;
	items: ImportJobItem[];
}

export interface CreateImportJobResponse {
	jobId: string;
}

export function isImportJobTerminal(status: ImportJobStatus | undefined): boolean {
	return status === 'completed' || status === 'completed_with_errors';
}

/**
 * Shelter Excel import — TanStack Query wiring (CR-039).
 *
 * The import mutation creates a durable server-side job. A worker processes
 * each row sequentially and the job query polls its per-row status.
 */

export const shelterImportKeys = {
	all: ['shelter-import'] as const,
	logs: () => [...shelterImportKeys.all, 'logs'] as const,
	job: (jobId: string | null) => [...shelterImportKeys.all, 'job', jobId] as const
};

export function useImportLogs() {
	return createQuery(() => ({
		queryKey: shelterImportKeys.logs(),
		queryFn: () => listImportLogs(),
		// Import history is an audit view; do not keep a previous visit's list
		// as the source of truth when the page is opened again.
		staleTime: 0,
		refetchOnMount: 'always'
	}));
}

export type DuplicateAction = 'skip' | 'update';

export interface ImportSheltersInput {
	filename: string;
	importedBy: string;
	rows: RowValidation[];
	/** what to do with those rows */
	duplicateAction: DuplicateAction;
}

export function useImportJob(jobId: () => string | null) {
	return createQuery(() => ({
		queryKey: shelterImportKeys.job(jobId()),
		enabled: Boolean(jobId()),
		queryFn: () =>
			serviceFetch<ImportJobSummary>(
				`/api/back-office/shelter-import/jobs/${encodeURIComponent(jobId()!)}`
			),
		refetchOnWindowFocus: true,
		refetchInterval: (query: { state: { data?: ImportJobSummary } }) =>
			isImportJobTerminal(query.state.data?.job.status) ? false : 1500
	}));
}

export function useImportShelters() {
	return createMutation(() => ({
		mutationFn: async ({ filename, importedBy, rows, duplicateAction }: ImportSheltersInput) => {
			return serviceFetch<CreateImportJobResponse>('/api/back-office/shelter-import/jobs', {
				method: 'POST',
				body: JSON.stringify({
					filename,
					imported_by: importedBy,
					duplicate_action: duplicateAction,
					rows: rows.map((r) => ({
						row: r.row,
						name: r.name,
						shelter: r.shelter,
						errors: r.errors
					}))
				})
			});
		},
		onSuccess: () => {
			toast.success('รับรายการนำเข้าแล้ว — ระบบกำลังประมวลผลทีละศูนย์');
		},
		onError: (e: unknown) => {
			toast.error(e instanceof Error ? e.message : 'นำเข้าไม่สำเร็จ');
		}
	}));
}

export function useRetryImportJob() {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: (jobId: string) =>
			serviceFetch<ImportJobSummary>(
				`/api/back-office/shelter-import/jobs/${encodeURIComponent(jobId)}/retry`,
				{ method: 'POST' }
			),
		onSuccess: (_summary, jobId) => {
			queryClient.invalidateQueries({ queryKey: shelterImportKeys.job(jobId) });
			toast.success('ส่งรายการที่ล้มเหลวกลับเข้าคิวแล้ว');
		},
		onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'ส่งรายการซ้ำไม่สำเร็จ')
	}));
}

/** Wire the `registry` changes feed → import-log query invalidation. */
export function startShelterImportLiveQuery(queryClient: QueryClient): SubscribeDataChangesHandle {
	return subscribeDataChanges(queryClient, IMPORT_LOG_REGISTRY_DB, (type) =>
		type === SHELTER_IMPORT_LOG_TYPE ? [shelterImportKeys.logs()] : []
	);
}
