// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { goto } from '$app/navigation';
import { languageStore } from '$lib/stores/language.svelte';
import type { KioskPrintFlowResult } from '../application/kiosk-print-flow';
import type { VolunteerCardSessionDeps } from '../application/volunteer-card-session.svelte';
import KioskVolunteerCard from './kiosk-volunteer-card.svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

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

async function printVolunteer() {
	// The keys ignore taps closer than 80 ms; the keyboard path has no such guard.
	const key = document.querySelector<HTMLButtonElement>('button[data-digit="1"]')!;
	for (const digit of '0812345678') {
		key.dispatchEvent(new KeyboardEvent('keydown', { key: digit, bubbles: true }));
		flushSync();
	}
	click(buttonByText('ค้นหา'));
	await vi.waitFor(() => expect(buttonByText('ไม่ใช่ฉัน')).toBeDefined());
	click(buttonByText('พิมพ์ QR'));
}

beforeEach(() => {
	languageStore.setLanguage('th');
	vi.clearAllMocks();
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
