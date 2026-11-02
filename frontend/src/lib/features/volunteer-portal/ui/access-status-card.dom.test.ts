// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import AccessStatusCard from './access-status-card.svelte';
import type { PortalAccessStatus } from '../domain/volunteer';

const row = (over: Partial<PortalAccessStatus>): PortalAccessStatus => ({
	shelter_code: 'SH001',
	shelter_name: 'ศูนย์หลัก',
	status: 'none',
	role_label: null,
	expires_at: null,
	...over
});

let component: ReturnType<typeof mount> | undefined;
const host = document.createElement('div');
document.body.append(host);

function render(props: { rows: PortalAccessStatus[]; loading?: boolean; error?: boolean }) {
	component = mount(AccessStatusCard, { target: host, props });
	flushSync();
	return host;
}

afterEach(() => {
	if (component) unmount(component);
	component = undefined;
	host.innerHTML = '';
});

const loginLink = () => host.querySelector<HTMLAnchorElement>('a[href="/login"]');

describe('AccessStatusCard', () => {
	it('tells a volunteer with no account to contact the coordinator, with no login button', () => {
		render({ rows: [row({ status: 'none' })] });

		expect(host.textContent).toContain('สิทธิ์ใช้งานระบบ');
		expect(host.textContent).toContain('ศูนย์หลัก');
		expect(host.textContent).toContain(
			'ยังไม่ได้รับสิทธิ์ใช้งานระบบ — ติดต่อผู้ประสานงานจิตอาสาของศูนย์'
		);
		expect(loginLink()).toBeNull();
	});

	it('says the same for a lapsed account', () => {
		render({ rows: [row({ status: 'lapsed' })] });

		expect(host.textContent).toContain(
			'ยังไม่ได้รับสิทธิ์ใช้งานระบบ — ติดต่อผู้ประสานงานจิตอาสาของศูนย์'
		);
		expect(loginLink()).toBeNull();
	});

	it('shows the role, the end date and the staff login button when active', () => {
		render({
			rows: [
				row({
					status: 'active',
					role_label: 'เจ้าหน้าที่ครัว',
					// End of 5 Nov 2026 in Bangkok.
					expires_at: '2026-11-05T16:59:59.999Z'
				})
			]
		});

		expect(host.textContent).toContain('เจ้าหน้าที่ครัว · หมดอายุสิ้นวันที่ 5/11/2569');
		expect(loginLink()?.textContent?.trim()).toBe('เข้าสู่ระบบเจ้าหน้าที่');
	});

	it('shows no date for a permanent role but keeps the login button', () => {
		render({ rows: [row({ status: 'active', role_label: 'เจ้าหน้าที่ครัว', expires_at: null })] });

		expect(host.textContent).toContain('เจ้าหน้าที่ครัว');
		expect(host.textContent).not.toContain('หมดอายุ');
		expect(loginLink()).not.toBeNull();
	});

	it('tells a suspended account to contact the administrator, with no login button', () => {
		render({ rows: [row({ status: 'account_disabled' })] });

		expect(host.textContent).toContain('บัญชีถูกระงับ — ติดต่อผู้ดูแลระบบ');
		expect(loginLink()).toBeNull();
	});

	it('gives each shelter its own status and button', () => {
		render({
			rows: [
				row({ shelter_code: 'SH001', shelter_name: 'ศูนย์หลัก', status: 'none' }),
				row({
					shelter_code: 'SH002',
					shelter_name: 'ศูนย์สอง',
					status: 'active',
					role_label: 'เจ้าหน้าที่คลัง'
				})
			]
		});

		expect(host.querySelectorAll('li')).toHaveLength(2);
		expect(host.querySelectorAll('a[href="/login"]')).toHaveLength(1);
	});

	it('renders nothing for a volunteer with no profile in any shelter', () => {
		render({ rows: [] });

		expect(host.textContent?.trim()).toBe('');
	});

	it('says so when the lookup failed, rather than claiming there is no access', () => {
		render({ rows: [], error: true });

		expect(host.textContent).toContain('ไม่สามารถตรวจสอบสิทธิ์ใช้งานระบบได้');
		expect(host.textContent).not.toContain('ยังไม่ได้รับสิทธิ์');
	});
});
