// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { goto } from '$app/navigation';
import { languageStore } from '$lib/stores/language.svelte';
import type { KioskPrintFlowResult } from '../application/kiosk-print-flow';
import { loadKioskHardware } from '../application/kiosk-qr-input';
import { printVolunteerLabel } from '../application/volunteer-label-print';
import type { VolunteerCardSessionDeps } from '../application/volunteer-card-session.svelte';
import { DEFAULT_KIOSK_HARDWARE } from '../domain/kiosk-hardware';
import KioskVolunteerCard from './kiosk-volunteer-card.svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('../application/kiosk-qr-input', () => ({ loadKioskHardware: vi.fn() }));
vi.mock('../application/volunteer-label-print', () => ({ printVolunteerLabel: vi.fn() }));

const VOLUNTEER = {
	display_name: 'สมชาย ใจดี',
	volunteer_code: 'VOL-0042',
	qr_payload: 'qr-vol-42'
};

let instance: ReturnType<typeof mount> | null = null;

function mountCard(result: KioskPrintFlowResult) {
	const deps: Partial<VolunteerCardSessionDeps> = {
		lookup: vi.fn().mockResolvedValue({ shelter_code: 'SH001', volunteer: VOLUNTEER }),
		print: vi.fn().mockResolvedValue(result)
	};
	instance = mount(KioskVolunteerCard, {
		target: document.body,
		props: { contextQuery: '?shelter_code=SH001', deps }
	});
	flushSync();
	return deps;
}

const buttonByText = (text: string) =>
	[...document.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
		b.textContent?.includes(text)
	);
const click = (button: HTMLButtonElement | undefined) => {
	button!.click();
	flushSync();
};
const labelScreen = () => document.querySelector('[data-testid="kiosk-label-screen"]');

async function toConfirm() {
	// The keys ignore taps closer than 80 ms; the keyboard path has no such guard.
	const key = document.querySelector<HTMLButtonElement>('button[data-digit="1"]')!;
	for (const digit of '0812345678') {
		key.dispatchEvent(new KeyboardEvent('keydown', { key: digit, bubbles: true }));
		flushSync();
	}
	click(buttonByText('ค้นหา'));
	await vi.waitFor(() => expect(buttonByText('ไม่ใช่ฉัน')).toBeDefined());
}

async function printVolunteer(buttonText = 'พิมพ์ QR') {
	await toConfirm();
	click(buttonByText(buttonText));
}

const bodyText = () => document.body.textContent?.replace(/\s+/g, ' ') ?? '';

beforeEach(() => {
	languageStore.setLanguage('th');
	vi.clearAllMocks();
	vi.mocked(loadKioskHardware).mockResolvedValue(DEFAULT_KIOSK_HARDWARE);
	// happy-dom has no Web Animations: svelte's transitions need a finishing stand-in.
	Element.prototype.animate = vi.fn(() => {
		const animation = {
			cancel() {},
			finish() {},
			pause() {},
			play() {},
			currentTime: 0,
			finished: Promise.resolve(),
			set onfinish(done: () => void) {
				queueMicrotask(done);
			}
		};
		return animation as unknown as Animation;
	});
});

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
	vi.useRealTimers();
});

describe('KioskVolunteerCard on a kiosk without a printer', () => {
	it('shows the label on screen instead of the printed notice', async () => {
		mountCard({ kind: 'screen', labels: ['cG5nLTE='] });

		await printVolunteer();

		await vi.waitFor(() => expect(labelScreen()).not.toBeNull());
		expect(document.querySelector('img')?.getAttribute('src')).toBe(
			'data:image/png;base64,cG5nLTE='
		);
		expect(document.body.textContent).not.toContain('พิมพ์ QR เรียบร้อย');
	});

	it('ends the visit when the label screen is done', async () => {
		mountCard({ kind: 'screen', labels: ['cG5nLTE='] });
		await printVolunteer();
		await vi.waitFor(() => expect(labelScreen()).not.toBeNull());

		click(buttonByText('เสร็จสิ้น'));

		expect(goto).toHaveBeenCalledWith('/kiosk/language?shelter_code=SH001');
	});

	it('is not sent home by the page idle timeout while the label screen shows', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		mountCard({ kind: 'screen', labels: ['cG5nLTE='] });
		await printVolunteer();
		await vi.waitFor(() => expect(labelScreen()).not.toBeNull());

		vi.advanceTimersByTime(61_000);
		flushSync();

		expect(goto).not.toHaveBeenCalled();
		expect(labelScreen()).not.toBeNull();
	});
});

describe('KioskVolunteerCard when the printer fails', () => {
	it('offers the label that did not print on screen, next to the retry', async () => {
		const deps = mountCard({
			kind: 'error',
			message: 'เครื่องพิมพ์ไม่พร้อม',
			labels: ['cG5nLTE=']
		});
		await printVolunteer();
		await vi.waitFor(() => expect(buttonByText('ลองพิมพ์อีกครั้ง')).toBeDefined());

		click(buttonByText('แสดง QR บนจอแทน'));

		expect(labelScreen()).not.toBeNull();
		expect(document.querySelector('img')?.getAttribute('src')).toBe(
			'data:image/png;base64,cG5nLTE='
		);
		expect(deps.lookup).toHaveBeenCalledTimes(1);
		expect(deps.print).toHaveBeenCalledTimes(1);
	});

	it('offers no on-screen option when nothing was rendered', async () => {
		mountCard({ kind: 'error', message: 'x' });
		await printVolunteer();
		await vi.waitFor(() => expect(buttonByText('ลองพิมพ์อีกครั้ง')).toBeDefined());

		expect(buttonByText('แสดง QR บนจอแทน')).toBeUndefined();
	});
});

describe('KioskVolunteerCard wording on a kiosk without a printer', () => {
	it('hands the print flow the printer it already resolved instead of fetching again', async () => {
		vi.mocked(printVolunteerLabel).mockResolvedValue({ kind: 'screen', labels: ['cG5nLTE='] });
		instance = mount(KioskVolunteerCard, {
			target: document.body,
			props: {
				contextQuery: '?shelter_code=SH001',
				deps: { lookup: vi.fn().mockResolvedValue({ shelter_code: 'SH001', volunteer: VOLUNTEER }) }
			}
		});
		flushSync();
		await vi.waitFor(() => expect(bodyText()).toContain('แสดง QR จิตอาสา'));
		await printVolunteer('แสดง QR');
		await vi.waitFor(() => expect(printVolunteerLabel).toHaveBeenCalledTimes(1));

		expect(vi.mocked(printVolunteerLabel).mock.calls[0][3]).toBe('none');
	});

	beforeEach(() => {
		vi.mocked(loadKioskHardware).mockResolvedValue({ ...DEFAULT_KIOSK_HARDWARE, printer: 'none' });
	});

	it('words the heading as showing the QR, not printing it', async () => {
		mountCard({ kind: 'screen', labels: ['cG5nLTE='] });

		await vi.waitFor(() => expect(bodyText()).toContain('แสดง QR จิตอาสา'));
		expect(bodyText()).not.toContain('พิมพ์');
	});

	it('words the confirm button as showing the QR, not printing it', async () => {
		mountCard({ kind: 'screen', labels: ['cG5nLTE='] });
		await vi.waitFor(() => expect(bodyText()).toContain('แสดง QR จิตอาสา'));
		await toConfirm();

		expect(buttonByText('แสดง QR')).toBeDefined();
		expect(bodyText()).not.toContain('พิมพ์');
	});

	it('words the page in English as showing the QR', async () => {
		languageStore.setLanguage('en');
		mountCard({ kind: 'screen', labels: ['cG5nLTE='] });

		await vi.waitFor(() => expect(bodyText()).toContain('Show volunteer QR'));
		expect(bodyText()).not.toMatch(/print/i);
	});

	it('does not show the printing overlay before the label screen', async () => {
		let finishPrint: (result: KioskPrintFlowResult) => void = () => {};
		const deps = mountCard({ kind: 'screen', labels: ['cG5nLTE='] });
		vi.mocked(deps.print!).mockReturnValue(
			new Promise((resolve) => {
				finishPrint = resolve;
			})
		);
		await vi.waitFor(() => expect(bodyText()).toContain('แสดง QR จิตอาสา'));
		await printVolunteer('แสดง QR');
		await vi.waitFor(() => expect(deps.print).toHaveBeenCalledTimes(1));

		expect(bodyText()).not.toContain('กำลังพิมพ์');

		finishPrint({ kind: 'screen', labels: ['cG5nLTE='] });
		await vi.waitFor(() => expect(labelScreen()).not.toBeNull());
	});
});

describe('KioskVolunteerCard wording on a kiosk with a printer', () => {
	it('keeps the print wording on the heading and the confirm button', async () => {
		mountCard({ kind: 'printed', printed: 1 });
		await vi.waitFor(() => expect(bodyText()).toContain('พิมพ์ QR จิตอาสา'));
		await toConfirm();

		expect(buttonByText('พิมพ์ QR')).toBeDefined();
	});
});
