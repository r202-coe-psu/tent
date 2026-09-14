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
	max_attempts?: number;
	dead_lettered_at?: string;
}

export interface ImportJob {
	_id: string;
	_rev?: string;
	filename: string;
	imported_by: string;
	status: ImportJobStatus;
	total: number;
	pending: number;
	running: number;
	succeeded: number;
	failed: number;
	skipped: number;
	attempt?: number;
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
	rows: RowValidation[];
	/** what to do with those rows */
	duplicateAction: DuplicateAction;
}

const INITIAL_JOB_POLL_MS = 2000;
const MAX_JOB_POLL_MS = 10_000;
const jobPollStates = new Map<string, { etag?: string; delay: number; data?: ImportJobSummary }>();

function jobPollDelay(jobId: string): number {
	return jobPollStates.get(jobId)?.delay ?? INITIAL_JOB_POLL_MS;
}

async function fetchImportJob(jobId: string): Promise<ImportJobSummary> {
	const previous = jobPollStates.get(jobId);
	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		Accept: 'application/json'
	};
	if (previous?.etag) headers['If-None-Match'] = previous.etag;
	const res = await fetch(`/api/back-office/shelter-import/jobs/${encodeURIComponent(jobId)}`, {
		credentials: 'include',
		headers
	});
	if (res.status === 304) {
		if (!previous?.data) throw new Error('Import job returned not-modified without cached data');
		jobPollStates.set(jobId, {
			...previous,
			delay: Math.min(previous.delay * 2, MAX_JOB_POLL_MS)
		});
		return previous.data;
	}
	const data = (await res.json().catch(() => null)) as
		(ImportJobSummary & { error?: { message?: string; description?: string } }) | null;
	if (!res.ok) {
		const message = data?.error?.message || `Request failed (${res.status})`;
		const description = data?.error?.description;
		throw new Error(description ? `${message} — ${description}` : message);
	}
	const etag = res.headers.get('etag') ?? (data?.job._rev ? `"${data.job._rev}"` : undefined);
	const unchanged = Boolean(previous?.etag && etag && previous.etag === etag);
	jobPollStates.set(jobId, {
		etag,
		data: data as ImportJobSummary,
		delay: unchanged ? Math.min(previous!.delay * 2, MAX_JOB_POLL_MS) : INITIAL_JOB_POLL_MS
	});
	return data as ImportJobSummary;
}

export function useImportJob(jobId: () => string | null) {
	return createQuery(() => ({
		queryKey: shelterImportKeys.job(jobId()),
		enabled: Boolean(jobId()),
		queryFn: () => fetchImportJob(jobId()!),
		refetchOnWindowFocus: true,
		refetchInterval: (query: { state: { data?: ImportJobSummary } }) =>
			isImportJobTerminal(query.state.data?.job.status) ? false : jobPollDelay(jobId()!)
	}));
}

export function useImportShelters() {
	return createMutation(() => ({
		mutationFn: async ({ filename, rows, duplicateAction }: ImportSheltersInput) => {
			return serviceFetch<CreateImportJobResponse>('/api/back-office/shelter-import/jobs', {
				method: 'POST',
				body: JSON.stringify({
					filename,
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
