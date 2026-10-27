import { describe, it, expect, vi } from 'vitest';
import { render } from 'svelte/server';
import { readable } from 'svelte/store';

vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

vi.mock('$app/stores', () => ({
	page: readable({
		url: new URL('http://localhost/back-office/users/new'),
		params: {},
		route: { id: null },
		status: 200,
		error: null,
		data: {},
		form: undefined,
		state: {}
	}),
	navigating: readable(null),
	updated: Object.assign(readable(false), { check: async () => false })
}));

vi.mock('$lib/features/shelters', () => ({
	useShelters: () => ({ data: [], isLoading: false, isPending: false, isSuccess: true })
}));

import UserForm from './user-form.svelte';
import {
	STAFF_CAPABILITIES,
	SHELTER_MANAGER,
	SYSTEM_ADMIN,
	roleDisplayLabel
} from '$lib/auth/roles';

describe('UserForm role picker labels (#807)', () => {
	function renderForm() {
		return render(UserForm, { props: { onsubmit: () => {}, lockedShelterCode: 'SH001' } }).body;
	}

	it('names every staff role exactly as the view pages do', () => {
		const body = renderForm();

		for (const capability of STAFF_CAPABILITIES) {
			expect(body).toContain(roleDisplayLabel(capability));
		}
	});

	it('drops the labels that disagreed with roleDisplayLabel', () => {
		const body = renderForm();

		expect(roleDisplayLabel('kitchen_staff')).toBe('เจ้าหน้าที่ครัว');
		expect(roleDisplayLabel('registration_staff')).toBe('เจ้าหน้าที่ลงทะเบียน');
		expect(body).not.toContain('เจ้าหน้าที่ครัวกลาง');
		expect(body).not.toContain('เจ้าหน้าที่รับลงทะเบียน');
	});

	it('names the shelter manager and system admin boxes the same way too', () => {
		const body = render(UserForm, {
			props: {
				onsubmit: () => {},
				lockedShelterCode: 'SH001',
				isSA: true,
				allowSystemAdminRole: true
			}
		}).body;

		expect(body).toContain(roleDisplayLabel(SHELTER_MANAGER));
		expect(body).toContain(roleDisplayLabel(SYSTEM_ADMIN));
		expect(body).not.toContain('ผู้จัดการศูนย์พักพิง (Shelter Manager)');
		expect(body).not.toContain('ผู้ดูแลระบบส่วนกลาง (System Admin)');
	});
});

describe('UserForm coordinator grants (#955)', () => {
	const volunteer = {
		name: 'vol@example.com',
		roles: ['shelter:SH001', 'SH001:kitchen_staff', 'SH001:facility_staff'],
		personnel_type: 'volunteer' as const,
		role_grants: [
			{
				shelter_code: 'SH001',
				role: 'kitchen_staff',
				expires_at: '2026-10-30T16:59:59.999Z',
				granted_by: 'staff03',
				granted_at: '2026-10-28T01:30:00.000Z'
			}
		]
	};
	const renderEdit = (user: typeof volunteer) =>
		render(UserForm, {
			props: { user, onsubmit: () => {}, lockedShelterCode: 'SH001' }
		}).body;

	it('shows the expiry and the "ไม่มีวันหมด" option only for the granted role', () => {
		const body = renderEdit(volunteer);

		expect(body).toContain('หมดอายุสิ้นวันที่ 30/10/2569');
		expect(body.match(/ไม่มีวันหมด/g)).toHaveLength(1);
	});

	it('shows nothing for an account without grants', () => {
		const body = renderEdit({ ...volunteer, role_grants: [] });

		expect(body).not.toContain('หมดอายุสิ้นวันที่');
		expect(body).not.toContain('ไม่มีวันหมด');
	});
});
