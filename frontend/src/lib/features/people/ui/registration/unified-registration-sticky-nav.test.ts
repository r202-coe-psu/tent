import { describe, it, expect, vi } from 'vitest';
import { render } from 'svelte/server';
import UnifiedRegistrationStickyNav from './unified-registration-sticky-nav.svelte';
import MapPin from '@lucide/svelte/icons/map-pin';
import Users from '@lucide/svelte/icons/users';

describe('UnifiedRegistrationStickyNav', () => {
	const mockSections = [
		{ id: 'address', label: 'ส่วนที่ 1: ที่อยู่เดิม', icon: MapPin },
		{ id: 'members', label: 'ส่วนที่ 2: สมาชิก', icon: Users }
	];

	it('renders standard mode with active section label', () => {
		const result = render(UnifiedRegistrationStickyNav, {
			props: {
				sections: mockSections,
				activeSection: 'address',
				ariaLabel: 'กระโดดไปยังส่วนของแบบฟอร์ม',
				compact: false,
				onNavigate: vi.fn()
			}
		});

		expect(result.body).toContain('ส่วนที่ 1: ที่อยู่เดิม');
	});

	it('renders compact mode without full section text in trigger', () => {
		const result = render(UnifiedRegistrationStickyNav, {
			props: {
				sections: mockSections,
				activeSection: 'address',
				ariaLabel: 'กระโดดไปยังส่วนของแบบฟอร์ม',
				compact: true,
				onNavigate: vi.fn()
			}
		});

		expect(result.body).not.toContain('truncate text-left');
		expect(result.body).toContain('กระโดดไปยังส่วนของแบบฟอร์ม');
	});
});
