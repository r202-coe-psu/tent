// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { langState } from '$lib/states/i18n.svelte';
import type { VolunteerProfile, VolunteerSkillOption } from '../domain/volunteer';
import ProfileEditDialog from './profile-edit-dialog.svelte';

const THAI = /[฀-๿]/;

const skills: VolunteerSkillOption[] = [
	{
		code: 'cook',
		label: 'ทำอาหาร',
		label_th: 'ทำอาหาร',
		label_en: 'Cooking',
		category: 'general',
		description: '',
		is_default: false
	},
	{
		code: 'medic',
		label: 'การแพทย์',
		label_th: 'การแพทย์',
		label_en: 'Medical',
		category: 'controlled',
		description: '',
		is_default: false
	}
];

vi.mock('../application/queries', () => ({
	useUpdateProfileMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
	useVolunteerSkills: () => ({ data: skills })
}));
vi.mock('svelte-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const profile: VolunteerProfile = {
	first_name: 'Anna',
	last_name: 'Smith',
	nickname: null,
	phone_masked: 'xxx-xxx-2222',
	email: null,
	occupation: 'Nurse',
	volunteer_code: '',
	skills: ['cook'],
	organization: null,
	identity_verified: true,
	personnel_type: '',
	shelter_codes: ['SH001', 'SH002'],
	portal_id: 'p1'
};

let instance: ReturnType<typeof mount> | null = null;

function open(language: 'th' | 'en', withProfile: VolunteerProfile | null = profile) {
	langState.current = language;
	instance = mount(ProfileEditDialog, {
		target: document.body,
		props: { open: true, profile: withProfile, credential: { phone: '0812345678' } }
	});
	flushSync();
	return document.body.textContent ?? '';
}

afterEach(async () => {
	if (instance) unmount(instance);
	instance = null;
	// bits-ui body-scroll-lock cleans up on a 24ms timer; let it run before the env tears down
	await new Promise((resolve) => setTimeout(resolve, 50));
	document.body.innerHTML = '';
	langState.current = 'th';
});

describe('ProfileEditDialog', () => {
	it('shows English copy and English skill names when the language is EN', () => {
		const text = open('en');
		expect(text).toContain('Edit volunteer profile');
		expect(text).toContain('No volunteer code yet');
		expect(text).toContain('Occupation: Nurse');
		expect(text).toContain('Verified');
		expect(text).toContain('Shelters with a profile: SH001 · SH002');
		expect(text).toContain(
			'Name, phone number and verification can only be changed by shelter staff'
		);
		expect(text).toContain('My skills');
		expect(text).toContain('1 skill selected');
		expect(text).toContain('Cooking');
		expect(text).toContain('Medical');
		expect(text).toContain('(controlled)');
		expect(text).toContain('Cancel');
		expect(text).toContain('Save changes');
		expect(text).not.toMatch(THAI);
	});

	it('words the no-profile state in English', () => {
		const text = open('en', null);
		expect(text).toContain('We could not find your profile yet');
		expect(text).not.toMatch(THAI);
	});

	it('keeps the Thai copy and Thai skill names when the language is TH', () => {
		const text = open('th');
		expect(text).toContain('แก้ไขโปรไฟล์จิตอาสา');
		expect(text).toContain('ยังไม่มีรหัสอาสา');
		expect(text).toContain('อาชีพ: Nurse');
		expect(text).toContain('ยืนยันตัวตนแล้ว');
		expect(text).toContain('ศูนย์ที่มีโปรไฟล์: SH001 · SH002');
		expect(text).toContain('ทักษะของฉัน');
		expect(text).toContain('เลือกแล้ว 1 ทักษะ');
		expect(text).toContain('ทำอาหาร');
		expect(text).toContain('(ควบคุม)');
		expect(text).toContain('บันทึกการเปลี่ยนแปลง');
	});

	it('renders fallback dash when occupation is null', () => {
		const text = open('th', { ...profile, occupation: null });
		expect(text).toContain('อาชีพ: —');
	});
});
