import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KioskPrintError } from '../data/kiosk-print.api';
import { KIOSK_QR_COLOR, kioskQrPrintSize } from '../domain/print-label';

const mocks = vi.hoisted(() => ({
	generateQrDataUrl: vi.fn(),
	qrModuleCount: vi.fn(),
	renderKioskLabelPng: vi.fn(),
	printKioskLabels: vi.fn()
}));

vi.mock('$lib/utils/qrcode', () => ({
	generateQrDataUrl: mocks.generateQrDataUrl,
	qrModuleCount: mocks.qrModuleCount
}));
vi.mock('./kiosk-label-image', () => ({ renderKioskLabelPng: mocks.renderKioskLabelPng }));
vi.mock('../data/kiosk-print.api', async (importOriginal) => ({
	...(await importOriginal<typeof import('../data/kiosk-print.api')>()),
	printKioskLabels: mocks.printKioskLabels
}));

import {
	prepareKioskQrImage,
	printKioskQrLabels,
	renderKioskQrLabelPng
} from './kiosk-label-print';

const labels = [
	{ qrSrc: 'data:qr-a', name: 'สมชาย ใจดี', phone: '0812345678' },
	{ qrSrc: 'data:qr-b', name: 'สมหญิง ใจดี', phone: null }
];

beforeEach(() => {
	vi.resetAllMocks();
});

describe('renderKioskQrLabelPng', () => {
	it('renders the kiosk label for a QR payload, as sent to the kiosk printer', async () => {
		mocks.qrModuleCount.mockResolvedValue(33);
		mocks.generateQrDataUrl.mockResolvedValue('data:image/png;base64,qr');
		mocks.renderKioskLabelPng.mockResolvedValue('cG5n');
		const label = { name: 'สมชาย ใจดี', phone: null, zone: 'A3', checklist: ['Check-in'] };

		expect(await renderKioskQrLabelPng('PAYLOAD', label)).toBe('cG5n');
		expect(mocks.generateQrDataUrl).toHaveBeenCalledWith('PAYLOAD', expect.any(Object));
		expect(mocks.renderKioskLabelPng).toHaveBeenCalledWith({
			...label,
			qrSrc: 'data:image/png;base64,qr'
		});
	});
});

describe('prepareKioskQrImage', () => {
	it('renders the payload with the kiosk QR colour at the size for its module count', async () => {
		mocks.qrModuleCount.mockResolvedValue(33);
		mocks.generateQrDataUrl.mockResolvedValue('data:image/png;base64,qr');
		const size = kioskQrPrintSize(33);

		const image = await prepareKioskQrImage('PAYLOAD');

		expect(mocks.qrModuleCount).toHaveBeenCalledWith('PAYLOAD');
		expect(mocks.generateQrDataUrl).toHaveBeenCalledWith('PAYLOAD', {
			width: size.widthPx,
			margin: size.margin,
			color: KIOSK_QR_COLOR
		});
		expect(image).toEqual({ src: 'data:image/png;base64,qr', sizeMm: size.sizeMm });
	});

	it('throws when the QR renderer returns nothing', async () => {
		mocks.qrModuleCount.mockResolvedValue(33);
		mocks.generateQrDataUrl.mockResolvedValue('');

		await expect(prepareKioskQrImage('PAYLOAD')).rejects.toThrow('QR render returned empty');
	});
});

describe('printKioskQrLabels', () => {
	it('renders each label in order and sends the PNGs to the printer', async () => {
		mocks.renderKioskLabelPng.mockImplementation(({ name }: { name: string }) =>
			Promise.resolve(`png:${name}`)
		);
		mocks.printKioskLabels.mockResolvedValue({ kind: 'printed', printed: 2 });
		const fallbackPrint = vi.fn();

		const result = await printKioskQrLabels(labels, fallbackPrint);

		expect(result).toEqual({ kind: 'printed', printed: 2 });
		expect(mocks.renderKioskLabelPng).toHaveBeenNthCalledWith(1, labels[0]);
		expect(mocks.renderKioskLabelPng).toHaveBeenNthCalledWith(2, labels[1]);
		expect(mocks.printKioskLabels).toHaveBeenCalledWith(['png:สมชาย ใจดี', 'png:สมหญิง ใจดี']);
		expect(fallbackPrint).not.toHaveBeenCalled();
	});

	it('falls back to browser printing when no scanner client answers', async () => {
		mocks.renderKioskLabelPng.mockResolvedValue('png');
		mocks.printKioskLabels.mockResolvedValue({ kind: 'unavailable' });
		const fallbackPrint = vi.fn();

		const result = await printKioskQrLabels(labels, fallbackPrint);

		expect(result).toEqual({ kind: 'fallback' });
		expect(fallbackPrint).toHaveBeenCalledOnce();
	});

	it('reports an error and prints nothing when a label fails to render', async () => {
		mocks.renderKioskLabelPng
			.mockResolvedValueOnce('png')
			.mockRejectedValueOnce(new Error('canvas failed'));
		const fallbackPrint = vi.fn();

		const result = await printKioskQrLabels(labels, fallbackPrint);

		expect(result.kind).toBe('error');
		expect(mocks.printKioskLabels).not.toHaveBeenCalled();
		expect(fallbackPrint).not.toHaveBeenCalled();
	});

	it('surfaces a partial print failure with the printed count', async () => {
		mocks.renderKioskLabelPng.mockResolvedValue('png');
		mocks.printKioskLabels.mockRejectedValue(new KioskPrintError('ส่งงานพิมพ์ไม่สำเร็จ', 1));

		const result = await printKioskQrLabels(labels, vi.fn());

		expect(result).toEqual({ kind: 'error', message: 'ส่งงานพิมพ์ไม่สำเร็จ (พิมพ์ออกแล้ว 1 ดวง)' });
	});
});
