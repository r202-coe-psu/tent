import { createMutation, createQuery } from '@tanstack/svelte-query';
import { createPrintJob, getPrintJobStatus, listShelterPrinters } from '../data/printers.api';
import type { PrintJobCreateInput } from '../domain/print-job.schema';
import { shouldKeepPolling } from '../domain/print-job-status';

export const PRINTER_LIST_REFETCH_MS = 30_000;
export const PRINT_JOB_POLL_INTERVAL_MS = 1_000;

export const printerKeys = {
	all: ['printers'] as const,
	list: (shelterCode: string) => [...printerKeys.all, 'list', shelterCode] as const,
	job: (jobId: string) => [...printerKeys.all, 'job', jobId] as const
};

/** Printers of a shelter with their online state; refreshed every 30 s. Idle without a code. */
export const useShelterPrinters = (shelterCode: () => string | undefined) =>
	createQuery(() => {
		const code = shelterCode();
		return {
			queryKey: printerKeys.list(code ?? ''),
			queryFn: () => listShelterPrinters(code as string),
			enabled: !!code,
			refetchInterval: PRINTER_LIST_REFETCH_MS
		};
	});

/** One mutation = one job (≤ 20 labels). Labels are large; do not keep them in the cache. */
export const useCreatePrintJob = () =>
	createMutation(() => ({
		mutationFn: (input: PrintJobCreateInput) => createPrintJob(input),
		gcTime: 0
	}));

/**
 * Polls a job every second until it is printed/failed/expired or 60 s have passed since the job
 * id was first seen. After 60 s the query simply stops; the caller treats a still-pending status
 * as a timeout (`PRINT_JOB_POLL_TIMEOUT_MS`).
 */
export const usePrintJobStatus = (jobId: () => string | undefined) => {
	let trackedJobId: string | undefined;
	let startedAtMs = Date.now();
	return createQuery(() => {
		const id = jobId();
		if (id !== trackedJobId) {
			trackedJobId = id;
			startedAtMs = Date.now();
		}
		return {
			queryKey: printerKeys.job(id ?? ''),
			queryFn: () => getPrintJobStatus(id as string),
			enabled: !!id,
			refetchInterval: (query) =>
				shouldKeepPolling({
					status: query.state.data?.status,
					startedAtMs,
					nowMs: Date.now()
				})
					? PRINT_JOB_POLL_INTERVAL_MS
					: false
		};
	});
};
