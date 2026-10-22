import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
import {
	createPrinterDevice,
	deletePrinterDevice,
	listPrinterDevices,
	rotatePrinterSecret,
	testPrintPrinter,
	updatePrinterDevice
} from '../data/printer-admin.api';
import { createPrintJob, getPrintJobStatus, listShelterPrinters } from '../data/printers.api';
import type { PrinterCreateInput, PrinterPatch } from '../domain/print-device.schema';
import type { PrintJobCreateInput } from '../domain/print-job.schema';
import { shouldKeepPolling } from '../domain/print-job-status';

export const PRINTER_LIST_REFETCH_MS = 30_000;
export const PRINT_JOB_POLL_INTERVAL_MS = 1_000;

export const printerKeys = {
	all: ['printers'] as const,
	list: (shelterCode: string) => [...printerKeys.all, 'list', shelterCode] as const,
	job: (jobId: string) => [...printerKeys.all, 'job', jobId] as const,
	adminList: (shelterCode?: string) => [...printerKeys.all, 'admin', shelterCode ?? 'all'] as const
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
 * Polls a job every second until it is printed/failed/expired or `PRINT_JOB_POLL_TIMEOUT_MS` has
 * passed since the job id was first seen. Then the query simply stops; the caller treats a
 * still-open status as a timeout.
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

// ------------------------------------------------------------ back-office admin

/** Back-office printer list with last job; the key carries the shelter so a switch refetches. */
export const usePrinterAdminList = (shelterCode?: () => string | undefined) =>
	createQuery(() => {
		const code = shelterCode?.();
		return {
			queryKey: printerKeys.adminList(code),
			queryFn: () => listPrinterDevices(code),
			refetchInterval: PRINTER_LIST_REFETCH_MS
		};
	});

/**
 * Admin mutations invalidate every printer query (admin list and the tablet list). The ones that
 * return a secret use `gcTime: 0` so the plaintext never stays in the mutation cache.
 */
export const useCreatePrinterDevice = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: (input: PrinterCreateInput) => createPrinterDevice(input),
		gcTime: 0,
		onSuccess: () => queryClient.invalidateQueries({ queryKey: printerKeys.all })
	}));
};

export const useUpdatePrinterDevice = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: (input: { deviceId: string; patch: PrinterPatch }) =>
			updatePrinterDevice(input.deviceId, input.patch),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: printerKeys.all })
	}));
};

export const useRotatePrinterSecret = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: (deviceId: string) => rotatePrinterSecret(deviceId),
		gcTime: 0,
		onSuccess: () => queryClient.invalidateQueries({ queryKey: printerKeys.all })
	}));
};

export const useTestPrintPrinter = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: (deviceId: string) => testPrintPrinter(deviceId),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: printerKeys.all })
	}));
};

export const useDeletePrinterDevice = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: (deviceId: string) => deletePrinterDevice(deviceId),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: printerKeys.all })
	}));
};
