// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { toast } from 'svelte-sonner';
import type { Volunteer } from '../domain/volunteer.schema';
import VolunteerQualificationDialog from './volunteer-qualification-dialog.svelte';

const MEDICAL = '01MASTERMEDICAL';

const mocks = vi.hoisted(() => ({
	roles: [] as string[],
	reviewIdentity: vi.fn(),
	reviewSkill: vi.fn(),
	crossShelter: {
		data: undefined as unknown,
		error: null as unknown,
		isError: false
	},
	crossShelterEnabled: vi.fn()
}));

vi.mock('@tanstack/svelte-query', () => ({ useQueryClient: () => ({}) }));
vi.mock('svelte-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('$lib/stores/auth.svelte', () => ({
	authStore: {
		get user() {
			return { name: 'sm02', roles: mocks.roles };
		}
	}
}));
vi.mock('$lib/features/shelters', () => ({
	useShelters: () => ({ data: [{ code: 'SH001', name: 'ศูนย์กีฬา' }] })
}));
vi.mock('../application/queries', () => ({
	useReviewVolunteerIdentity: () => ({ mutateAsync: mocks.reviewIdentity, isPending: false }),
	useReviewVolunteerSkill: () => ({ mutateAsync: mocks.reviewSkill, isPending: false }),
	useSkillOptions: () => ({
		options: [{ code: MEDICAL, label: 'การแพทย์', description: '', icon: '🩺', controlled: true }],
		controlledValues: [MEDICAL, 'การแพทย์']
	}),
	useCrossShelterVerifications: (_volunteer: unknown, enabled: () => boolean) => ({
		get data() {
			mocks.crossShelterEnabled(enabled());
			return enabled() ? mocks.crossShelter.data : undefined;
		},
		get error() {
			return mocks.crossShelter.error;
		},
		get isError() {
			return mocks.crossShelter.isError;
		}
	})
}));

const volunteer = {
	_id: 'volunteer:own',
	shelter_code: 'SH002',
	volunteer_code: 'V-007',
	first_name: 'สมชาย',
	last_name: 'ใจดี',
	phone: '0812345678',
	national_id: '1234567890123',
	status: 'active',
	skills: [MEDICAL],
	identity_verified: false,
	identity_verification: { status: 'pending' },
	skill_verifications: {}
} as unknown as Volunteer;

const SH001_MATCH = {
	shelter_code: 'SH001',
	shelter_name: 'ศูนย์กีฬา',
	identity: { reviewed_at: '2026-10-30T02:00:00.000Z' },
	skills: [{ code: MEDICAL, reviewed_at: null }]
};

let instance: ReturnType<typeof mount> | null = null;

async function settle() {
	await tick();
	flushSync();
	await new Promise((resolve) => setTimeout(resolve, 20));
	flushSync();
}

async function render(profile: Partial<Volunteer> = {}) {
	instance = mount(VolunteerQualificationDialog, {
		target: document.body,
		props: { open: true, volunteer: { ...volunteer, ...profile }, shelterLine: 'SH002' }
	});
	await settle();
}

const button = (text: string) =>
	[...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim().includes(text));
const text = () => (document.body.textContent ?? '').replace(/\s+/g, ' ');

beforeEach(() => {
	vi.clearAllMocks();
	mocks.roles = ['shelter:SH002', 'SH002:shelter_manager'];
	mocks.crossShelter.data = [SH001_MATCH];
	mocks.crossShelter.error = null;
	mocks.crossShelter.isError = false;
	mocks.reviewIdentity.mockResolvedValue({});
	mocks.reviewSkill.mockResolvedValue({});
});

afterEach(async () => {
	if (instance) await unmount(instance);
	instance = null;
	// bits-ui body-scroll-lock cleans up on a 24ms timer; let it run before the env tears down.
	await new Promise((resolve) => setTimeout(resolve, 50));
	document.body.innerHTML = '';
});

describe('VolunteerQualificationDialog — results from other shelters (CR-228)', () => {
	it('shows where the identity was verified, without who, and asks for the card first (FR-7, FR-8)', async () => {
		await render();
		expect(text()).toContain('ยืนยันตัวตนแล้วที่ ศูนย์กีฬา (SH001) เมื่อ');
		expect(text()).toContain('ตรวจบัตรประชาชนตัวจริงของจิตอาสาต่อหน้าก่อนกดยืนยัน');
		expect(button('ยืนยันตัวตน (อ้างอิงผลจาก ศูนย์กีฬา (SH001))')).toBeDefined();
		// Still pending until someone here accepts it.
		expect(text()).toContain('ยังไม่ได้ตรวจ');
	});

	it('accepts the identity with the source in accepted_from and no notes (FR-8, AC-2)', async () => {
		await render();
		const notes = document.getElementById('qualification-review-notes') as HTMLTextAreaElement;
		notes.value = 'ข้อความในช่องหมายเหตุ';
		notes.dispatchEvent(new Event('input', { bubbles: true }));
		await settle();

		button('ยืนยันตัวตน (อ้างอิงผลจาก')!.click();
		await settle();
		expect(mocks.reviewIdentity).toHaveBeenCalledWith({
			id: 'volunteer:own',
			status: 'verified',
			notes: null,
			acceptedFrom: { shelter_code: 'SH001', verified_at: '2026-10-30T02:00:00.000Z' }
		});
		expect(toast.success).toHaveBeenCalled();
	});

	it('shows a certified skill with its own accept button, keeping this shelter credential field (FR-9, FR-10)', async () => {
		await render();
		expect(text()).toContain('รับรองแล้วที่ ศูนย์กีฬา (SH001) (ไม่ระบุวันที่)');
		const credential = document.getElementById(
			`credential-reference-${MEDICAL}`
		) as HTMLInputElement;
		credential.value = 'ว.999';
		credential.dispatchEvent(new Event('input', { bubbles: true }));
		await settle();

		button('รับรองทักษะนี้')!.click();
		await settle();
		expect(mocks.reviewSkill).toHaveBeenCalledWith({
			id: 'volunteer:own',
			skillCode: MEDICAL,
			status: 'verified',
			notes: null,
			credentialReference: 'ว.999',
			acceptedFrom: { shelter_code: 'SH001', verified_at: null }
		});
	});

	it('hides the identity part once verified here (FR-13)', async () => {
		await render({
			identity_verified: true,
			identity_verification: { status: 'verified' }
		} as Partial<Volunteer>);
		expect(button('ยืนยันตัวตน (อ้างอิงผลจาก')).toBeUndefined();
		expect(button('รับรองทักษะนี้')).toBeDefined();
	});

	it('hides a skill already decided here (FR-13)', async () => {
		await render({
			skill_verifications: { [MEDICAL]: { status: 'rejected' } }
		} as Partial<Volunteer>);
		expect(button('รับรองทักษะนี้')).toBeUndefined();
	});

	it('neither searches nor shows anything to other roles (FR-11)', async () => {
		mocks.roles = ['shelter:SH002', 'SH002:registration_staff'];
		await render();
		expect(mocks.crossShelterEnabled).toHaveBeenLastCalledWith(false);
		expect(button('ยืนยันตัวตน (อ้างอิงผลจาก')).toBeUndefined();
	});

	it('does not search for a closed profile (FR-3)', async () => {
		await render({ status: 'inactive' } as Partial<Volunteer>);
		expect(mocks.crossShelterEnabled).toHaveBeenLastCalledWith(false);
	});

	it('toasts a failed search, hides the panel and keeps the manual review (FR-12)', async () => {
		mocks.crossShelter.error = new Error('503');
		mocks.crossShelter.isError = true;
		await render();
		expect(toast.error).toHaveBeenCalledWith(
			'ค้นผลยืนยันจากศูนย์อื่นไม่สำเร็จ ตรวจและบันทึกผลด้วยตนเองได้ตามปกติ'
		);
		expect(button('ยืนยันตัวตน (อ้างอิงผลจาก')).toBeUndefined();
		expect(button('รับรองคุณสมบัติและทักษะควบคุม')).toBeDefined();
	});

	it('writes the combined submit as a check made here, never as accepted (FR-13, AC-15)', async () => {
		await render();
		button('รับรองคุณสมบัติและทักษะควบคุม')!.click();
		await settle();
		expect(mocks.reviewIdentity).toHaveBeenCalledWith(
			expect.not.objectContaining({ acceptedFrom: expect.anything() })
		);
		expect(mocks.reviewSkill).toHaveBeenCalledWith(
			expect.not.objectContaining({ acceptedFrom: expect.anything() })
		);
	});

	it('shows an accepted skill as using the other shelter license instead of the license field', async () => {
		await render({
			skill_verifications: {
				[MEDICAL]: {
					status: 'verified',
					reviewed_at: '2026-11-06T03:00:00.000Z',
					reviewed_by: 'sm02',
					notes: null,
					credential_reference: 'ว.T12',
					accepted_from: { shelter_code: 'SH001', verified_at: '2026-10-20T03:20:00.000Z' }
				}
			}
		} as Partial<Volunteer>);
		expect(text()).toContain('ใช้ผลตรวจใบอนุญาตจาก ศูนย์กีฬา (SH001) เมื่อ');
		expect(text()).toContain('เลขใบอนุญาตที่บันทึกในศูนย์นี้: ว.T12');
		expect(document.getElementById(`credential-reference-${MEDICAL}`)).toBeNull();
	});

	it('keeps the license field for a skill checked at this shelter', async () => {
		await render({
			skill_verifications: { [MEDICAL]: { status: 'verified', credential_reference: 'ว.1' } }
		} as Partial<Volunteer>);
		expect(document.getElementById(`credential-reference-${MEDICAL}`)).not.toBeNull();
		expect(text()).not.toContain('ใช้ผลตรวจใบอนุญาตจาก');
	});
});
