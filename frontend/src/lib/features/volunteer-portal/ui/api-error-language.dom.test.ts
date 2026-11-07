// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { langState } from '$lib/states/i18n.svelte';
import DigitalPass from './digital-pass.svelte';
import TicketFinder from './ticket-finder.svelte';

const THAI = /[฀-๿]/;
const state = vi.hoisted(() => ({ error: null as Error | null }));

vi.mock('../application/queries', () => ({
	useVolunteerTicket: () => ({
		data: undefined,
		isPending: false,
		isError: true,
		error: state.error
	}),
	useVolunteerSkills: () => ({ data: [] }),
	useCancelTicketMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
	useFindTicketsMutation: () => ({
		mutateAsync: vi.fn(async () => {
			throw state.error;
		}),
		isPending: false,
		data: undefined
	})
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn(async () => {}) }));
vi.mock('$lib/utils/qrcode', () => ({
	generateQrDataUrl: vi.fn(async () => 'data:image/png;base64,')
}));
vi.mock('svelte-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

let instance: ReturnType<typeof mount> | null = null;

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
	langState.current = 'th';
});

describe('volunteer ticket screens show server errors in the selected language', () => {
	it('digital pass: a ticket that is not found reads in English when the language is EN', () => {
		langState.current = 'en';
		state.error = new Error('ไม่พบตั๋วนี้ กรุณาตรวจสอบลิงก์อีกครั้ง');
		instance = mount(DigitalPass, {
			target: document.body,
			props: { token: 'TKT-1', hideQr: true }
		});
		flushSync();
		expect(document.body.textContent).toContain(
			'This ticket was not found. Please check the link again'
		);
		expect(document.body.textContent).not.toMatch(THAI);
	});

	it('digital pass: the Thai message is unchanged when the language is TH', () => {
		langState.current = 'th';
		state.error = new Error('ไม่พบตั๋วนี้ กรุณาตรวจสอบลิงก์อีกครั้ง');
		instance = mount(DigitalPass, {
			target: document.body,
			props: { token: 'TKT-1', hideQr: true }
		});
		flushSync();
		expect(document.body.textContent).toContain('ไม่พบตั๋วนี้ กรุณาตรวจสอบลิงก์อีกครั้ง');
	});

	it('ticket finder: a failed search reads in English when the language is EN', async () => {
		langState.current = 'en';
		state.error = new Error('ส่งคำขอถี่เกินไป กรุณารอสักครู่แล้วลองใหม่');
		instance = mount(TicketFinder, { target: document.body });
		flushSync();
		const input = document.body.querySelector('input')!;
		input.value = '0812345678';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		document.body
			.querySelector('form')!
			.dispatchEvent(new SubmitEvent('submit', { cancelable: true }));
		await vi.waitFor(() =>
			expect(document.body.textContent).toContain(
				'Too many requests. Please wait a moment and try again'
			)
		);
		expect(document.body.textContent).not.toMatch(THAI);
	});
});
