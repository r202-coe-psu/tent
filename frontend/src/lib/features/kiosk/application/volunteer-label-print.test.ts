import { beforeEach, describe, expect, it, vi } from 'vitest';
import { kioskQrPrintSize } from '../domain/print-label';

const mocks = vi.hoisted(() => ({
	generateQrDataUrl: vi.fn(),
	qrModuleCount: vi.fn(),
	renderVolunteerLabelPng: vi.fn(),
	printKioskLabels: vi.fn()
}));

vi.mock('$lib/utils/qrcode', () => ({
	generateQrDataUrl: mocks.generateQrDataUrl,
	qrModuleCount: mocks.qrModuleCount
}));
vi.mock('./volunteer-label-image', () => ({
	renderVolunteerLabelPng: mocks.renderVolunteerLabelPng
}));
vi.mock('../data/kiosk-print.api', async (importOriginal) => ({
	...(await importOriginal<typeof import('../data/kiosk-print.api')>()),
	printKioskLabels: mocks.printKioskLabels
}));

import { printVolunteerLabel } from './volunteer-label-print';

const volunteer = {
	display_name: 'สม** ใจ**',
	volunteer_code: 'V-012',
	qr_payload: 'VOLUNTEER-PAYLOAD'
};

beforeEach(() => {
	vi.resetAllMocks();
	mocks.qrModuleCount.mockResolvedValue(33);
	mocks.generateQrDataUrl.mockResolvedValue('data:image/png;base64,qr');
});

describe('printVolunteerLabel', () => {
	it('renders one label for the volunteer and sends it to the kiosk printer', async () => {
		mocks.renderVolunteerLabelPng.mockResolvedValue('png-volunteer');
		mocks.printKioskLabels.mockResolvedValue({ kind: 'printed', printed: 1 });
		const fallbackPrint = vi.fn();

		const result = await printVolunteerLabel(volunteer, fallbackPrint);

		expect(result).toEqual({ kind: 'printed', printed: 1 });
		expect(mocks.qrModuleCount).toHaveBeenCalledWith('VOLUNTEER-PAYLOAD');
		expect(mocks.renderVolunteerLabelPng).toHaveBeenCalledExactlyOnceWith({
			qrSrc: 'data:image/png;base64,qr',
			name: 'สม** ใจ**',
			badge: 'จิตอาสา · V-012'
		});
		expect(mocks.printKioskLabels).toHaveBeenCalledWith(['png-volunteer']);
		expect(fallbackPrint).not.toHaveBeenCalled();
	});

	it('falls back to browser printing with the sheet data when no scanner client answers', async () => {
		mocks.renderVolunteerLabelPng.mockResolvedValue('png-volunteer');
		mocks.printKioskLabels.mockResolvedValue({ kind: 'unavailable' });
		const fallbackPrint = vi.fn();

		const result = await printVolunteerLabel(volunteer, fallbackPrint);

		expect(result).toEqual({ kind: 'fallback' });
		expect(fallbackPrint).toHaveBeenCalledExactlyOnceWith({
			qrSrc: 'data:image/png;base64,qr',
			qrSizeMm: kioskQrPrintSize(33).sizeMm,
			name: 'สม** ใจ**',
			badge: 'จิตอาสา · V-012'
		});
	});

	it('reports an error and prints nothing when the label fails to render', async () => {
		mocks.renderVolunteerLabelPng.mockRejectedValue(new Error('canvas failed'));
		const fallbackPrint = vi.fn();

		const result = await printVolunteerLabel(volunteer, fallbackPrint);

		expect(result.kind).toBe('error');
		expect(mocks.printKioskLabels).not.toHaveBeenCalled();
		expect(fallbackPrint).not.toHaveBeenCalled();
	});
});
