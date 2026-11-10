// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import type { AssignCandidate } from '../domain/assign-roster';
import type { Volunteer } from '../domain/volunteer.schema';
import AssignRosterRow from './assign-roster-row.svelte';

const candidate = (profile: Partial<Volunteer>, assignable = true): AssignCandidate =>
	({
		volunteer: {
			_id: 'volunteer:1',
			first_name: 'สมชาย',
			last_name: 'ใจดี',
			skills: [],
			personnel_type: 'volunteer',
			identity_verified: false,
			...profile
		} as unknown as Volunteer,
		state: assignable ? { kind: 'available' } : { kind: 'accepted' },
		skillMatch: true,
		professional: false,
		assignable
	}) as AssignCandidate;

let instance: ReturnType<typeof mount> | null = null;

async function render(c: AssignCandidate, capacityAvailable = true) {
	instance = mount(AssignRosterRow, {
		target: document.body,
		props: {
			candidate: c,
			selected: false,
			capacityAvailable,
			onToggle: vi.fn(),
			onDetails: vi.fn(),
			onAssign: vi.fn()
		}
	});
	flushSync();
	await tick();
}

const assignButton = () =>
	[...document.body.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
		b.textContent?.includes('มอบหมาย')
	)!;

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
});

describe('AssignRosterRow assign button by identity', () => {
	it('keeps the plain filled button for a verified volunteer', async () => {
		await render(
			candidate({ identity_verified: true, identity_verification: { status: 'verified' } })
		);
		const button = assignButton();
		expect(button.textContent?.trim()).toBe('มอบหมาย');
		expect(button.className).not.toContain('border-amber-300');
		expect(button.className).not.toContain('border-rose-300');
	});

	it('shows an unverified volunteer with an amber outline and says why', async () => {
		await render(candidate({ identity_verification: { status: 'pending' } }));
		const button = assignButton();
		expect(button.textContent?.trim()).toBe('มอบหมาย (ยังไม่ยืนยันตัวตน)');
		expect(button.className).toContain('border-amber-300');
		expect(button.className).not.toContain('bg-primary');
	});

	it('shows a turned-down check in rose, not as waiting', async () => {
		await render(candidate({ identity_verification: { status: 'rejected' } }));
		expect(assignButton().textContent?.trim()).toBe('มอบหมาย (ตัวตนไม่ผ่าน)');
		expect(assignButton().className).toContain('border-rose-300');
		expect(document.body.textContent).toContain('ไม่ผ่านการยืนยันตัวตน');
	});

	it('still says the shift is full whatever the identity', async () => {
		await render(candidate({}), false);
		expect(assignButton()).toBeUndefined();
		expect(document.body.textContent).toContain('กะเต็มแล้ว');
	});

	it('omits unknown skills that are not in master skillOptions instead of showing raw code (W3)', async () => {
		await render(candidate({ skills: ['unknown_skill_id', 'medical'] }));
		expect(document.body.textContent).not.toContain('unknown_skill_id');
	});
});
