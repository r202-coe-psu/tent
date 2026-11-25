// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { goto } from '$app/navigation';
import { walkInSession } from '$lib/features/kiosk';
import { languageStore } from '$lib/stores/language.svelte';
import Page from './+page.svelte';

vi.mock('$app/state', () => ({
	page: { url: new URL('http://kiosk.test/kiosk/register/done?shelter_code=S1') }
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
// Canvas / QR image rendering has no happy-dom implementation: stub the image makers only.
const renderKioskLabelPng = vi.hoisted(() => vi.fn(async () => 'PNG-BASE64'));
vi.mock('$lib/features/kiosk/application/kiosk-label-image', () => ({ renderKioskLabelPng }));
vi.mock('$lib/utils/qrcode', () => ({
	qrModuleCount: vi.fn(async () => 21),
	generateQrDataUrl: vi.fn(async () => 'data:image/png;base64,QR')
}));

const json = (status: number, body: unknown) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let instance: ReturnType<typeof mount> | null = null;
let fetchMock: ReturnType<typeof vi.fn>;
let printer: 'cups' | 'escpos' | 'none';
let printResponse: () => Response;

const bodyText = () => document.body.textContent?.replace(/\s+/g, ' ') ?? '';
const buttonByText = (text: string) =>
	[...document.querySelectorAll<HTMLButtonElement>('button')].find(
		(b) => b.textContent?.trim() === text
	);
const shownImage = () =>
	document.querySelector<HTMLImageElement>('[data-testid="kiosk-label-screen"] img');
const printCalls = () => fetchMock.mock.calls.filter(([url]) => url === '/api/v1/kiosk/print');
const hardwareCalls = () =>
	fetchMock.mock.calls.filter(([url]) => url === '/api/v1/kiosk/hardware');

/** Lets the fetch / render promises run: only setTimeout is faked, so real macrotasks still turn. */
async function settle() {
	for (let round = 0; round < 5; round++) {
		await new Promise((resolve) => setImmediate(resolve));
		flushSync();
	}
}

async function mountPage(issueFailed = false) {
	walkInSession.registration = {
		evacuee_id: 'evacuee:01',
		qr_payload: issueFailed ? null : 'qr-payload',
		...(issueFailed ? { qr_issue_failed: true } : {}),
		label: { name: 'สมชาย ใจดี', phone: null },
		consent_ref: 'CR-1',
		consent_mode: 'full'
	} as never;
	instance = mount(Page, { target: document.body });
	flushSync();
	await settle();
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
	languageStore.setLanguage('th');
	printer = 'cups';
	printResponse = () => json(200, { printed: 1 });
	fetchMock = vi.fn(async (url: string) => {
		if (url === '/api/v1/kiosk/hardware') return json(200, { qr_input: 'camera', printer });
		if (url === '/api/v1/kiosk/print') return printResponse();
		return json(404, {});
	});
	vi.stubGlobal('fetch', fetchMock);
	vi.mocked(goto).mockClear();
	// happy-dom has no Web Animations API; Svelte transitions need it. Finish them at once.
	Element.prototype.animate = function () {
		const animation = {
			onfinish: null as (() => void) | null,
			cancel() {},
			finish() {},
			currentTime: 0
		};
		queueMicrotask(() => animation.onfinish?.());
		return animation as unknown as Animation;
	};
});

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	walkInSession.clear();
	vi.unstubAllGlobals();
	vi.useRealTimers();
	document.body.innerHTML = '';
});

describe('walk-in done page on a kiosk without a printer (DOM)', () => {
	beforeEach(() => {
		printer = 'none';
	});

	it('shows the label on screen instead of printing, without a print-again button or a printed-label promise', async () => {
		await mountPage();

		expect(printCalls()).toHaveLength(0);
		expect(shownImage()?.getAttribute('src')).toBe('data:image/png;base64,PNG-BASE64');
		expect(buttonByText('พิมพ์อีกครั้ง')).toBeUndefined();
		expect(bodyText()).not.toContain('รับ QR Code');
	});

	it('asks the scanner client for its hardware once, so the print follows what the screen shows', async () => {
		// A second hardware fetch would time out here and fall back to `cups`: the print would then be
		// sent to a kiosk that has no printer (409 PRINTER_DISABLED) while the screen words «show».
		let asked = 0;
		fetchMock.mockImplementation(async (url: string) => {
			if (url === '/api/v1/kiosk/hardware') {
				asked += 1;
				return asked === 1 ? json(200, { qr_input: 'camera', printer }) : json(503, {});
			}
			if (url === '/api/v1/kiosk/print') return printResponse();
			return json(404, {});
		});
		await mountPage();

		expect(hardwareCalls()).toHaveLength(1);
		expect(printCalls()).toHaveLength(0);
		expect(shownImage()?.getAttribute('src')).toBe('data:image/png;base64,PNG-BASE64');
	});

	it('renders the label once when show-again is pressed twice at once', async () => {
		renderKioskLabelPng.mockClear();
		renderKioskLabelPng.mockRejectedValueOnce(new Error('canvas failed'));
		await mountPage();
		expect(renderKioskLabelPng).toHaveBeenCalledTimes(1);
		const showAgain = buttonByText('แสดง QR อีกครั้ง')!;

		showAgain.click();
		showAgain.click();
		await settle();

		expect(renderKioskLabelPng).toHaveBeenCalledTimes(2);
	});

	it('shows no printing status and no printed-label wording while the label is prepared', async () => {
		renderKioskLabelPng.mockReturnValueOnce(new Promise(() => {}));
		await mountPage();

		expect(shownImage()).toBeNull();
		expect(bodyText()).not.toContain('กำลังพิมพ์');
		expect(bodyText()).not.toContain('รับ QR Code');
		expect(buttonByText('พิมพ์อีกครั้ง')).toBeUndefined();
	});

	it('asks staff to show a new QR, not to print one, when the QR could not be issued', async () => {
		await mountPage(true);

		expect(bodyText()).toContain('ออก QR ไม่สำเร็จ กรุณาติดต่อเจ้าหน้าที่เพื่อแสดง QR ใหม่');
		expect(bodyText()).not.toContain('พิมพ์');
	});

	it('asks staff to show the QR, not to print it, when there is no registration left', async () => {
		instance = mount(Page, { target: document.body });
		flushSync();
		await settle();

		expect(bodyText()).toContain('กรุณาติดต่อเจ้าหน้าที่เพื่อแสดง QR Code');
		expect(bodyText()).not.toContain('พิมพ์');
	});

	it('replaces the success panel with the label screen, keeping one way out and the consent reference', async () => {
		await mountPage();

		expect(shownImage()).not.toBeNull();
		expect(buttonByText('กลับหน้าแรก')).toBeUndefined();
		expect(buttonByText('เสร็จสิ้น')).toBeDefined();
		expect(bodyText()).toContain('CR-1');
	});

	it('offers no show-again button when the QR could not be issued', async () => {
		await mountPage(true);

		expect(buttonByText('แสดง QR อีกครั้ง')).toBeUndefined();
	});

	it('goes home from the label screen like the finish button', async () => {
		await mountPage();

		buttonByText('เสร็จสิ้น')!.click();
		flushSync();

		expect(goto).toHaveBeenCalledOnce();
	});

	it('does not send the visitor home on its own idle timeout while the label screen shows', async () => {
		await mountPage();

		await vi.advanceTimersByTimeAsync(61_000);

		expect(goto).not.toHaveBeenCalled();
		expect(shownImage()).not.toBeNull();
	});
});

describe('walk-in done page when the print fails (DOM)', () => {
	beforeEach(() => {
		printResponse = () =>
			json(500, { printed: 0, error: { code: 'PRINTER_NOT_READY', message: 'x' } });
	});

	it('offers to show the QR on screen beside the error, and opens the label screen from it', async () => {
		await mountPage();

		expect(shownImage()).toBeNull();
		expect(buttonByText('แสดง QR บนจอแทน')).toBeDefined();

		buttonByText('แสดง QR บนจอแทน')!.click();
		flushSync();

		expect(shownImage()?.getAttribute('src')).toBe('data:image/png;base64,PNG-BASE64');
		expect(buttonByText('แสดง QR บนจอแทน')).toBeUndefined();
	});

	it('words the button in English on the English screen', async () => {
		languageStore.setLanguage('en');
		await mountPage();

		expect(buttonByText('Show the QR on screen instead')).toBeDefined();
	});
});

describe('walk-in done page when the label prints (DOM)', () => {
	it('asks the scanner client for its hardware once', async () => {
		await mountPage();

		expect(hardwareCalls()).toHaveLength(1);
	});

	it('keeps telling the visitor to take the printed QR and offers print again', async () => {
		await mountPage();

		expect(printCalls()).toHaveLength(1);
		expect(bodyText()).toContain('รับ QR Code แล้วไปที่จุดคัดกรอง');
		expect(buttonByText('พิมพ์อีกครั้ง')).toBeDefined();
		expect(shownImage()).toBeNull();
	});
});

describe('walk-in done page when the printer is there and the QR could not be issued (DOM)', () => {
	it('keeps asking staff to print a new QR', async () => {
		await mountPage(true);

		expect(bodyText()).toContain('ยังไม่ได้พิมพ์ กรุณาติดต่อเจ้าหน้าที่เพื่อพิมพ์ QR ใหม่');
	});

	it('keeps asking staff to print the QR when there is no registration left', async () => {
		instance = mount(Page, { target: document.body });
		flushSync();
		await settle();

		expect(bodyText()).toContain('กรุณาติดต่อเจ้าหน้าที่เพื่อพิมพ์ QR Code');
	});
});
