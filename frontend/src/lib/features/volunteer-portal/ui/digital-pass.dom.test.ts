// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { VolunteerTicket } from '../domain/volunteer';
import DigitalPass from './digital-pass.svelte';

const state = vi.hoisted(() => ({ ticket: undefined as unknown }));

vi.mock('../application/queries', () => ({
	useVolunteerTicket: () => ({
		get data() {
			return state.ticket;
		},
		isPending: false,
		isError: false,
		error: null
	}),
	useVolunteerSkills: () => ({ data: [] }),
	useCancelTicketMutation: () => ({ mutateAsync: vi.fn(), isPending: false })
}));
vi.mock('$lib/utils/qrcode', () => ({
	generateQrDataUrl: vi.fn(async () => 'data:image/png;base64,')
}));
vi.mock('svelte-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const ticket = (over: Partial<VolunteerTicket> = {}): VolunteerTicket => ({
	token: 'TKT-1',
	can_cancel: true,
	application_id: 'job_application:a1',
	status: 'confirmed',
	job_id: 'job:j1',
	job_title: 'งานทดสอบ',
	shelter_code: 'SH001',
	shelter_name: 'ศูนย์ทดสอบ',
	applicant_name: 'อาสา ทดสอบ',
	phone_masked: 'xxx-xxx-2222',
	skills: [],
	selected_shift: { date: '2099-09-01', start_time: '08:00', end_time: '12:00', station: null },
	applied_at: '2099-08-01T00:00:00.000Z',
	qr_payload: '/volunteer/ticket/TKT-1',
	...over
});

let instance: ReturnType<typeof mount> | null = null;

function render(t: VolunteerTicket) {
	state.ticket = t;
	instance = mount(DigitalPass, { target: document.body, props: { token: 'TKT-1', hideQr: true } });
	flushSync();
}

const cancelButton = () =>
	[...document.body.querySelectorAll('button')].find((b) =>
		b.textContent?.includes('ขอยกเลิกการสมัครล่วงหน้า')
	);

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
});

describe('DigitalPass cancel button (CR-220 FR-7)', () => {
	it('shows the cancel button when can_cancel is true', () => {
		render(ticket());
		expect(cancelButton()).toBeTruthy();
	});

	it('hides it when can_cancel is false', () => {
		render(ticket({ can_cancel: false }));
		expect(cancelButton()).toBeUndefined();
	});

	it('still shows it for a cancelled application whose quota release is due (can_cancel decides alone)', () => {
		render(ticket({ status: 'cancelled', can_cancel: true }));
		expect(cancelButton()).toBeTruthy();
	});

	it('hides it for a cancelled application with nothing left to do', () => {
		render(ticket({ status: 'cancelled', can_cancel: false }));
		expect(cancelButton()).toBeUndefined();
	});
});
