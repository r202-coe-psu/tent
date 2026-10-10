import { FACE_CHECK_OFF, type FaceCheckConfig } from './face-check';

export type KioskQrInput = 'camera' | 'reader' | 'both';

export type KioskHardware = {
	/** `KIOSK_QR_CHECK_IN=off` on this machine hides the QR method and closes /kiosk/qr. */
	qrCheckInEnabled: boolean;
	qrInput: KioskQrInput;
	cameraLabel: string | null;
	readerMaxGapMs: number;
	/** Face check against the chip photo: off unless the scanner client turns it on. */
	faceCheck: FaceCheckConfig;
};

export const DEFAULT_READER_MAX_GAP_MS = 50;
export const MIN_READER_GAP_MS = 10;
export const MAX_READER_GAP_MS = 100;

/** Machines without a scanner client (or any error) keep the camera. */
export const DEFAULT_KIOSK_HARDWARE: KioskHardware = {
	qrCheckInEnabled: true,
	qrInput: 'camera',
	cameraLabel: null,
	readerMaxGapMs: DEFAULT_READER_MAX_GAP_MS,
	faceCheck: FACE_CHECK_OFF
};

export type QrInputPlan = {
	/** Hardware config has not resolved yet: nothing may start (no camera permission prompt). */
	pending: boolean;
	cameraEnabled: boolean;
	readerEnabled: boolean;
	readerOnly: boolean;
	readerMaxGapMs: number;
};

/** What the QR screen should run for this machine; `null` = config still loading. */
export function qrInputPlan(hardware: KioskHardware | null): QrInputPlan {
	if (!hardware) {
		return {
			pending: true,
			cameraEnabled: false,
			readerEnabled: false,
			readerOnly: false,
			readerMaxGapMs: DEFAULT_READER_MAX_GAP_MS
		};
	}
	return {
		pending: false,
		cameraEnabled: hardware.qrInput !== 'reader',
		readerEnabled: hardware.qrInput !== 'camera',
		readerOnly: hardware.qrInput === 'reader',
		readerMaxGapMs: hardware.readerMaxGapMs
	};
}
