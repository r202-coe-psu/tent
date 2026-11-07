import {
	printerAdminListResponseSchema,
	printerAdminSummarySchema,
	printerSecretResponseSchema,
	printerTestPrintResponseSchema,
	type PrinterAdminListResponse,
	type PrinterAdminSummary,
	type PrinterCreateInput,
	type PrinterPatch,
	type PrinterSecretResponse,
	type PrinterTestPrintResponse
} from '../domain/print-device.schema';
import { request } from './printers.api';

const BASE = '/api/back-office/printers';
const JSON_HEADERS = { 'content-type': 'application/json' };

/** `[device_id]` in the path is the device id (`printer-sh001-reg1`), not the doc `_id`. */
const devicePath = (deviceId: string, suffix = '') =>
	`${BASE}/${encodeURIComponent(deviceId)}${suffix}`;

export async function listPrinterDevices(shelterCode?: string): Promise<PrinterAdminListResponse> {
	const query = shelterCode ? `?shelter_code=${encodeURIComponent(shelterCode)}` : '';
	return printerAdminListResponseSchema.parse(await request(`${BASE}${query}`));
}

/** The response carries the secret exactly once; `gcTime: 0` on the mutation keeps it out of cache. */
export async function createPrinterDevice(
	input: PrinterCreateInput
): Promise<PrinterSecretResponse> {
	const payload = await request(BASE, {
		method: 'POST',
		headers: JSON_HEADERS,
		body: JSON.stringify(input)
	});
	return printerSecretResponseSchema.parse(payload);
}

export async function updatePrinterDevice(
	deviceId: string,
	patch: PrinterPatch
): Promise<PrinterAdminSummary> {
	const payload = await request(devicePath(deviceId), {
		method: 'PATCH',
		headers: JSON_HEADERS,
		body: JSON.stringify(patch)
	});
	return printerAdminSummarySchema.parse(payload);
}

/** The previous secret stops working immediately. */
export async function rotatePrinterSecret(deviceId: string): Promise<PrinterSecretResponse> {
	const payload = await request(devicePath(deviceId, '/rotate-secret'), { method: 'POST' });
	return printerSecretResponseSchema.parse(payload);
}

export async function testPrintPrinter(deviceId: string): Promise<PrinterTestPrintResponse> {
	const payload = await request(devicePath(deviceId, '/test-print'), { method: 'POST' });
	return printerTestPrintResponseSchema.parse(payload);
}

export async function deletePrinterDevice(deviceId: string): Promise<void> {
	await request(devicePath(deviceId), { method: 'DELETE' });
}
