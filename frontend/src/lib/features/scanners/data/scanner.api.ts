import {
	scannerCreateResponseSchema,
	type ScannerCreateResponse,
	type ScannerDeviceInput
} from '../domain/scanner.schema';

function responseMessage(payload: unknown): string {
	if (!payload || typeof payload !== 'object') return 'ไม่สามารถลงทะเบียนเครื่องสแกนได้';
	const body = payload as { error?: unknown };
	if (typeof body.error === 'string') return body.error;
	if (body.error && typeof body.error === 'object') {
		const message = (body.error as { message?: unknown }).message;
		if (typeof message === 'string') return message;
	}
	return 'ไม่สามารถลงทะเบียนเครื่องสแกนได้';
}

export async function createScannerDevice(
	input: ScannerDeviceInput
): Promise<ScannerCreateResponse> {
	const response = await fetch('/api/v1/scanner/devices', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(input)
	});
	const payload: unknown = await response.json().catch(() => null);
	if (!response.ok) throw new Error(responseMessage(payload));
	return scannerCreateResponseSchema.parse(payload);
}
