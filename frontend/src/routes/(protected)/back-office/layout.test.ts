import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'svelte/server';
import { createRawSnippet } from 'svelte';
import Layout from './+layout.svelte';

let mockSheltersState = {
	isLoading: false,
	isPending: false,
	isSuccess: true,
	data: [] as Array<{ code: string; name: string }>
};

let mockRoles = ['system_admin'];

vi.mock('$app/paths', () => ({
	resolve: (path: string) => path
}));

vi.mock('$app/state', () => ({
	page: {
		url: { pathname: '/back-office/dashboard' }
	}
}));

vi.mock('$lib/features/shelters', () => ({
	useShelters: () => mockSheltersState
}));

vi.mock('$lib/stores/auth.svelte', () => ({
	authStore: {
		get user() {
			return { roles: mockRoles };
		}
	}
}));

vi.mock('$lib/components/backoffice-navbar.svelte', () => ({
	default: () => ''
}));

vi.mock('$lib/features/login', () => ({
	ReauthDialog: () => ''
}));

vi.mock('$lib/stores/backoffice.svelte', () => ({
	backofficeState: {
		isOffline: false,
		reauthRequested: false,
		clearReauthRequest: vi.fn()
	}
}));

vi.mock('$lib/stores/endpoint.svelte', () => ({
	endpointStore: {
		status: 'connected',
		forceRetry: vi.fn()
	}
}));

describe('Back-office Layout Zero-Shelter Guard (#393)', () => {
	const dummyChildren = createRawSnippet(() => ({
		render: () => '<div data-testid="children-content">CONTENT_RENDERED</div>'
	}));

	beforeEach(() => {
		mockRoles = ['system_admin'];
		mockSheltersState = {
			isLoading: false,
			isPending: false,
			isSuccess: true,
			data: []
		};
	});

	it('renders locked screen with admin action when zero shelters exist and user is system_admin', () => {
		mockRoles = ['system_admin'];
		mockSheltersState = {
			isLoading: false,
			isPending: false,
			isSuccess: true,
			data: []
		};

		const result = render(Layout, {
			props: {
				data: {} as never,
				params: {} as never,
				children: dummyChildren
			}
		});

		// Must show locked header
		expect(result.body).toContain('ยังไม่มีศูนย์พักพิงในระบบ');
		// Must show instruction
		expect(result.body).toContain('การดำเนินการในระบบส่วนหลังจำเป็นต้องมีศูนย์พักพิง');
		// Must contain CTA button to /system-management/shelters
		expect(result.body).toContain('/system-management/shelters');
		expect(result.body).toContain('สร้างหรือนำเข้าศูนย์พักพิง');
		// Must NOT render children content
		expect(result.body).not.toContain('CONTENT_RENDERED');
	});

	it('renders locked screen with staff notice when zero shelters exist and user is regular staff', () => {
		mockRoles = ['volunteer'];
		mockSheltersState = {
			isLoading: false,
			isPending: false,
			isSuccess: true,
			data: []
		};

		const result = render(Layout, {
			props: {
				data: {} as never,
				params: {} as never,
				children: dummyChildren
			}
		});

		// Must show locked header
		expect(result.body).toContain('ยังไม่มีศูนย์พักพิงในระบบ');
		// Must show staff instruction
		expect(result.body).toContain('กรุณาติดต่อผู้ดูแลระบบ (System Administrator)');
		// Must NOT show admin button
		expect(result.body).not.toContain('สร้างหรือนำเข้าศูนย์พักพิง');
		// Must NOT render children content
		expect(result.body).not.toContain('CONTENT_RENDERED');
	});

	it('renders children content when shelters exist in the system', () => {
		mockSheltersState = {
			isLoading: false,
			isPending: false,
			isSuccess: true,
			data: [{ code: 'SH01', name: 'ศูนย์พักพิงหลัก' }]
		};

		const result = render(Layout, {
			props: {
				data: {} as never,
				params: {} as never,
				children: dummyChildren
			}
		});

		// Must NOT show locked header
		expect(result.body).not.toContain('ยังไม่มีศูนย์พักพิงในระบบ');
		// Must render children content
		expect(result.body).toContain('CONTENT_RENDERED');
	});
});
