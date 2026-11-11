// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { langState } from '$lib/states/i18n.svelte';
import type { VolunteerProfile } from '$lib/features/volunteer-portal/domain/volunteer';
import PublicQuickApplyModal, { type QuickApplyJob } from './public-quick-apply-modal.svelte';

const THAI = /[฀-๿]/;

vi.mock('$lib/features/volunteer-portal/data/volunteer-api', async (original) => ({
	...(await original<typeof import('$lib/features/volunteer-portal/data/volunteer-api')>()),
	fetchVolunteerSkills: vi.fn(async () => [])
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn(async () => {}) }));
vi.mock('svelte-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const job: QuickApplyJob = {
	id: 'job-1',
	title: 'Central kitchen',
	shelter: 'Main shelter',
	shelter_code: 'SH001',
	shifts: [{ id: 'shift-1', date: '2099-09-10', time: '08:00 - 12:00', quota: 10, confirmed: 2 }]
};

const profile: VolunteerProfile = {
	first_name: 'Anna',
	last_name: 'Smith',
	nickname: null,
	phone_masked: 'xxx-xxx-2222',
	email: null,
	occupation: null,
	volunteer_code: 'V-1001',
	skills: [],
	organization: null,
	identity_verified: true,
	personnel_type: '',
	shelter_codes: ['SH001'],
	portal_id: 'p1'
};

let instance: ReturnType<typeof mount> | null = null;

function open(language: 'th' | 'en', signedIn = true, occupation: string | null = null) {
	langState.current = language;
	instance = mount(PublicQuickApplyModal, {
		target: document.body,
		props: {
			job,
			isOpen: true,
			applicantProfile: signedIn ? { ...profile, occupation } : null,
			applicantCredential: signedIn ? { token: 'TKT-VOL-ABCDEF', portal_id: 'p1' } : null
		}
	});
	flushSync();
	return {
		text: document.body.textContent ?? '',
		placeholders: [...document.body.querySelectorAll('input')]
			.map((input) => input.getAttribute('placeholder') ?? '')
			.join('|')
	};
}

afterEach(async () => {
	if (instance) unmount(instance);
	instance = null;
	// bits-ui body-scroll-lock cleans up on a 24ms timer; let it run before the env tears down
	await new Promise((resolve) => setTimeout(resolve, 50));
	document.body.innerHTML = '';
	langState.current = 'th';
});

describe('PublicQuickApplyModal for a signed-in portal volunteer', () => {
	it('asks for the original phone number in English and leaves no Thai text when the language is EN', () => {
		const { text } = open('en');
		expect(text).toContain('You signed in with a volunteer ticket QR code');
		expect(text).toContain('Phone number you originally applied with');
		expect(text).not.toMatch(THAI);
	});

	it('shows English name placeholders to a public applicant when the language is EN', () => {
		const { placeholders } = open('en', false);
		expect(placeholders).toContain('e.g. Somchai');
		expect(placeholders).toContain('e.g. Jaidee');
		expect(placeholders).toContain('e.g. Chai, Pim');
		expect(placeholders).not.toMatch(THAI);
	});

	it('keeps the Thai wording when the language is TH', () => {
		const { text } = open('th');
		expect(text).toContain('คุณเข้าสู่ระบบด้วย QR Code ตั๋วอาสาสมัคร');
		expect(text).toContain('เบอร์โทรศัพท์ที่ใช้สมัครเดิม');
	});

	it('keeps the Thai name placeholders for a public applicant when the language is TH', () => {
		const { placeholders } = open('th', false);
		expect(placeholders).toContain('เช่น เก่งกล้า');
		expect(placeholders).toContain('เช่น งานอาสา');
		expect(placeholders).toContain('เช่น กล้า, พิมพ์');
	});

	it('does not show the occupation field to a portal applicant — staff own it (CR-245)', () => {
		open('th', true, 'วิศวกร');
		expect(document.body.querySelector('#occupation')).toBeNull();
	});

	it('lets a public applicant type an occupation (CR-245)', () => {
		open('th', false);
		const input = document.body.querySelector<HTMLInputElement>('#occupation');
		expect(input).not.toBeNull();
		expect(input?.readOnly).toBe(false);
		expect(input?.maxLength).toBe(100);
	});
});
