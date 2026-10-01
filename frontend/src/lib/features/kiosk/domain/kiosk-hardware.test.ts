import { describe, expect, it } from 'vitest';
import { DEFAULT_KIOSK_HARDWARE, qrInputPlan } from './kiosk-hardware';

const hardware = (qrInput: 'camera' | 'reader' | 'both') => ({
	...DEFAULT_KIOSK_HARDWARE,
	qrInput,
	readerMaxGapMs: 40
});

describe('qrInputPlan', () => {
	it('starts nothing before the config resolves', () => {
		expect(qrInputPlan(null)).toMatchObject({
			pending: true,
			cameraEnabled: false,
			readerEnabled: false,
			readerOnly: false
		});
	});

	it('reader mode never opens the camera', () => {
		expect(qrInputPlan(hardware('reader'))).toEqual({
			pending: false,
			cameraEnabled: false,
			readerEnabled: true,
			readerOnly: true,
			readerMaxGapMs: 40
		});
	});

	it('camera mode installs no keyboard wedge', () => {
		expect(qrInputPlan(hardware('camera'))).toMatchObject({
			pending: false,
			cameraEnabled: true,
			readerEnabled: false,
			readerOnly: false
		});
	});

	it('both mode runs the camera and the reader', () => {
		expect(qrInputPlan(hardware('both'))).toMatchObject({
			pending: false,
			cameraEnabled: true,
			readerEnabled: true,
			readerOnly: false
		});
	});
});
