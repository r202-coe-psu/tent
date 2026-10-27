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
