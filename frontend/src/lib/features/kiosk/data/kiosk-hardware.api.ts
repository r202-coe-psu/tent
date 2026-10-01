export const KIOSK_HARDWARE_PATH = '/api/v1/scanner/kiosk/hardware';
export const KIOSK_HARDWARE_TIMEOUT_MS = 3_000;

export type KioskQrInput = 'camera' | 'reader' | 'both';

export type KioskHardware = {
	qrInput: KioskQrInput;
	cameraLabel: string | null;
	readerMaxGapMs: number;
};

const DEFAULT_READER_MAX_GAP_MS = 50;
const MIN_READER_GAP_MS = 10;
const MAX_READER_GAP_MS = 100;

export const DEFAULT_KIOSK_HARDWARE: KioskHardware = {
	qrInput: 'camera',
	cameraLabel: null,
	readerMaxGapMs: DEFAULT_READER_MAX_GAP_MS
};

/**
 * Per-machine hardware settings, answered by the scanner client on the kiosk itself. Without one
 * (plain browser, Raspberry Pi kiosks that set nothing, any error) the page keeps the camera.
 */
export async function fetchKioskHardware(fetchFn: typeof fetch = fetch): Promise<KioskHardware> {
	try {
		const response = await fetchFn(KIOSK_HARDWARE_PATH, {
			method: 'POST',
			cache: 'no-store',
			signal: AbortSignal.timeout(KIOSK_HARDWARE_TIMEOUT_MS)
		});
		if (!response.ok) return DEFAULT_KIOSK_HARDWARE;
		const body = (await response.json()) as {
			qr_input?: unknown;
			camera_label?: unknown;
			reader_max_gap_ms?: unknown;
		} | null;
		if (body?.qr_input !== 'camera' && body?.qr_input !== 'reader' && body?.qr_input !== 'both') {
			return DEFAULT_KIOSK_HARDWARE;
		}
		const gap = body.reader_max_gap_ms;
		return {
			qrInput: body.qr_input,
			cameraLabel:
				typeof body.camera_label === 'string' && body.camera_label.trim()
					? body.camera_label.trim()
					: null,
			readerMaxGapMs:
				typeof gap === 'number' &&
				Number.isInteger(gap) &&
				gap >= MIN_READER_GAP_MS &&
				gap <= MAX_READER_GAP_MS
					? gap
					: DEFAULT_READER_MAX_GAP_MS
		};
	} catch {
		return DEFAULT_KIOSK_HARDWARE;
	}
}
