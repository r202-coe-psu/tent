import {
	printJobCreateResponseSchema,
	printJobStatusResponseSchema,
	type PrintJobCreateInput,
	type PrintJobCreateResponse,
	type PrintJobStatusResponse
} from '../domain/print-job.schema';
import { printerListResponseSchema, type PrinterListResponse } from '../domain/print-device.schema';

/**
 * Error from a non-2xx BFF response. Carries the contract `error.code` (`PRINTER_OFFLINE`, …)
 * as well as the HTTP status, because the UI branches on the code. `serviceFetch` only keeps
 * message + status, so this feature talks to the BFF with plain `fetch` like `kiosk-devices`.
 */
export class PrintApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly code: string | null
	) {
		super(message);
		this.name = 'PrintApiError';
	}
}

export async function request(path: string, init?: RequestInit): Promise<unknown> {
	const response = await fetch(path, { cache: 'no-store', ...init });
	const payload: unknown = await response.json().catch(() => null);
	if (!response.ok) {
		const error = (payload as { error?: { code?: unknown; message?: unknown } } | null)?.error;
		throw new PrintApiError(
			typeof error?.message === 'string' ? error.message : `Request failed (${response.status})`,
			response.status,
			typeof error?.code === 'string' ? error.code : null
		);
	}
	return payload;
}

export async function listShelterPrinters(shelterCode: string): Promise<PrinterListResponse> {
	const payload = await request(
		`/api/staff/v1/printers?shelter_code=${encodeURIComponent(shelterCode)}`
	);
	return printerListResponseSchema.parse(payload);
}

export async function createPrintJob(input: PrintJobCreateInput): Promise<PrintJobCreateResponse> {
	const payload = await request('/api/staff/v1/print-jobs', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(input)
	});
	return printJobCreateResponseSchema.parse(payload);
}

export async function getPrintJobStatus(jobId: string): Promise<PrintJobStatusResponse> {
	const payload = await request(`/api/staff/v1/print-jobs/${encodeURIComponent(jobId)}`);
	return printJobStatusResponseSchema.parse(payload);
}
