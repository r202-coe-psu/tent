// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import Page from './+page.svelte';

const mocks = vi.hoisted(() => ({
	submit: vi.fn(),
	toastError: vi.fn(),
	status: { name: 'vol@example.com', must_change_password: true }
}));

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/paths', () => ({ resolve: (p: string) => p }));
vi.mock('svelte-sonner', () => ({ toast: { success: vi.fn(), error: mocks.toastError } }));
vi.mock('$lib/stores/auth.svelte', () => ({
	authStore: { user: { name: 'vol@example.com', roles: [] }, login: vi.fn() }
}));
vi.mock('$lib/guards/auth', () => ({
	FORCE_SETUP_ROUTE: '/force-setup',
	LANDING_ROUTE: '/portal',
	resolvePostLoginDestination: () => '/force-setup'
}));
vi.mock('$lib/features/users', async () => ({
	forceSetupFieldErrors: (await import('$lib/features/users/domain/force-setup'))
		.forceSetupFieldErrors,
	fetchAuthStatus: () => Promise.resolve(mocks.status),
	submitForceSetup: mocks.submit
}));

let instance: ReturnType<typeof mount> | null = null;

async function settle() {
	await tick();
	await new Promise((resolve) => setTimeout(resolve, 20));
	flushSync();
}

async function render() {
	instance = mount(Page, { target: document.body });
	await settle();
}

function type(id: string, value: string) {
	const input = document.getElementById(id) as HTMLInputElement;
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function submit() {
	document.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
	await settle();
}

const errorOf = (id: string) => document.getElementById(`${id}-error`)?.textContent?.trim() ?? null;

beforeEach(() => {
	vi.clearAllMocks();
	mocks.submit.mockResolvedValue(undefined);
});

afterEach(async () => {
	if (instance) await unmount(instance);
	instance = null;
	document.body.innerHTML = '';
});

describe('/force-setup errors under each field (#1065)', () => {
	it('shows every problem under its field in Thai, with no toast, and does not submit', async () => {
		await render();
		type('force-setup-new-password', 'abc');
		type('force-setup-confirm-password', 'abd');
		await submit();

		expect(errorOf('security-question-select')).toBe('กรุณาเลือกคำถามความปลอดภัย');
		expect(errorOf('security-question-answer')).toBe('กรุณากรอกคำตอบความปลอดภัย');
		expect(errorOf('force-setup-new-password')).toContain('รหัสผ่านต้องมี: อย่างน้อย 10 ตัวอักษร');
		expect(errorOf('force-setup-confirm-password')).toBe(
			'รหัสผ่านใหม่และการยืนยันรหัสผ่านไม่ตรงกัน'
		);
		expect(mocks.toastError).not.toHaveBeenCalled();
		expect(mocks.submit).not.toHaveBeenCalled();
	});

	it('keeps an error until the field is fixed, then clears it live', async () => {
		await render();
		await submit();
		expect(errorOf('security-question-answer')).toBe('กรุณากรอกคำตอบความปลอดภัย');

		type('security-question-answer', 'โรงเรียน');
		await settle();
		expect(errorOf('security-question-answer')).toBeNull();
	});

	it('shows a server refusal inline instead of a toast', async () => {
		mocks.submit.mockRejectedValue(new Error('กรุณาเลือกคำถามและกรอกคำตอบความปลอดภัย'));
		await render();
		const select = document.getElementById('security-question-select') as HTMLSelectElement;
		select.value = 'high_school';
		select.dispatchEvent(new Event('change', { bubbles: true }));
		type('security-question-answer', 'โรงเรียน');
		type('force-setup-new-password', 'Shelter-2569x');
		type('force-setup-confirm-password', 'Shelter-2569x');
		await submit();

		expect(mocks.submit).toHaveBeenCalled();
		expect(document.querySelector('[role="alert"]')?.textContent).toContain(
			'กรุณาเลือกคำถามและกรอกคำตอบความปลอดภัย'
		);
		expect(mocks.toastError).not.toHaveBeenCalled();
	});

	it('asks to sign in again when the session is gone (401)', async () => {
		const { ServiceRequestError } = await import('$lib/api/service');
		mocks.submit.mockRejectedValue(new ServiceRequestError('Authentication required', 401));
		await render();
		const select = document.getElementById('security-question-select') as HTMLSelectElement;
		select.value = 'high_school';
		select.dispatchEvent(new Event('change', { bubbles: true }));
		type('security-question-answer', 'โรงเรียน');
		type('force-setup-new-password', 'Shelter-2569x');
		type('force-setup-confirm-password', 'Shelter-2569x');
		await submit();

		expect(document.querySelector('[role="alert"]')?.textContent?.trim()).toBe(
			'เซสชันหมดอายุหรือยังไม่ได้เข้าสู่ระบบ กรุณาเข้าสู่ระบบใหม่'
		);
	});

	it('replaces an English server message with a Thai one', async () => {
		mocks.submit.mockRejectedValue(new Error('Internal error'));
		await render();
		const select = document.getElementById('security-question-select') as HTMLSelectElement;
		select.value = 'high_school';
		select.dispatchEvent(new Event('change', { bubbles: true }));
		type('security-question-answer', 'โรงเรียน');
		type('force-setup-new-password', 'Shelter-2569x');
		type('force-setup-confirm-password', 'Shelter-2569x');
		await submit();

		expect(document.querySelector('[role="alert"]')?.textContent?.trim()).toBe(
			'ไม่สามารถบันทึกการตั้งค่าได้ กรุณาลองใหม่อีกครั้ง'
		);
	});
});
