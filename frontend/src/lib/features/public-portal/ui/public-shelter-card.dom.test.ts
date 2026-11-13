// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import PublicShelterCard from './public-shelter-card.svelte';
import type { PublicShelterCardModel } from '../domain/types';

vi.mock('../application/queries', () => ({
	useShelterTypeLabelMap: () => ({ data: [] }),
	useVulnerableGroupLabelMap: () => ({ data: [] }),
	useSiteKinds: () => ({ data: [] })
}));

let component: ReturnType<typeof mount> | undefined;

function shelter(over: Partial<PublicShelterCardModel> = {}): PublicShelterCardModel {
	return {
		id: 'EXT1',
		code: 'EXT1',
		name: 'ศูนย์ภายนอก',
		site_kind: 'evacuation_center',
		status: 'UNKNOWN',
		address: 'ต.ทดสอบ',
		distance: 0,
		capacity: 0,
		province: 'สงขลา',
		district: 'หาดใหญ่',
		subdistrict: 'คอหงส์',
		pet_policy: null,
		vulnerable_groups: null,
		admin_type: null,
		geo: null,
		accepts_pre_registration: false,
		is_external: true,
		external_url: 'https://example.org/x',
		...over
	};
}

function render(model: PublicShelterCardModel, withBooking = true) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	component = mount(PublicShelterCard, {
		target,
		props: {
			shelter: model,
			getStatusColor: () => '',
			getStatusText: () => 'x',
			onPreRegister: withBooking ? () => {} : undefined
		}
	});
	flushSync();
	return target;
}

afterEach(() => {
	if (component) unmount(component);
	component = undefined;
	document.body.innerHTML = '';
});

describe('PublicShelterCard — external shelter (CR-252 FR-20..22)', () => {
	it('shows the unknown chip as a safe new-tab link and the contact text instead of capacity', () => {
		const root = render(shelter());
		const chip = root.querySelector('a[data-testid="external-shelter-chip"]')!;
		expect(chip.textContent).toContain('ไม่ทราบสถานะ');
		expect(chip.getAttribute('href')).toBe('https://example.org/x');
		expect(chip.getAttribute('target')).toBe('_blank');
		expect(chip.getAttribute('rel')).toBe('noopener noreferrer');
		expect(chip.querySelector('svg')).not.toBeNull();
		expect(root.textContent).toContain('ติดต่อ ณ ศูนย์พักพิง');
		expect(root.querySelector('[data-testid="external-capacity"]')).toBeNull();
	});

	it('shows the max capacity above the contact text when the external shelter has one', () => {
		const root = render(shelter({ capacity: 120 }));
		const row = root.querySelector('[data-testid="external-capacity"]')!;
		expect(row.textContent).toContain('120');
		// With a capacity the card shows only that — no contact text, no pet policy.
		expect(root.textContent).not.toContain('ติดต่อ ณ ศูนย์พักพิง');
		expect(root.querySelector('[data-testid="external-contact-note"]')).toBeNull();
	});

	it('hides the pet policy and vulnerable groups on an external card', () => {
		const root = render(shelter({ capacity: 120, pet_policy: 'not_allowed' }));
		expect(root.textContent).not.toContain('นโยบายสัตว์เลี้ยง');
	});

	it('renders a plain chip when there is no link, and hides the pre-register button', () => {
		const root = render(shelter({ external_url: null }));
		expect(root.querySelector('a[data-testid="external-shelter-chip"]')).toBeNull();
		expect(root.querySelector('span[data-testid="external-shelter-chip"]')).not.toBeNull();
		expect(root.textContent).not.toContain('ลงทะเบียนล่วงหน้า');
	});

	it('keeps capacity and the booking button for a normal shelter', () => {
		const root = render(
			shelter({
				is_external: false,
				external_url: null,
				status: 'OPEN',
				capacity: 80,
				accepts_pre_registration: true
			})
		);
		expect(root.querySelector('[data-testid="external-shelter-chip"]')).toBeNull();
		expect(root.textContent).toContain('รองรับได้สูงสุด');
		expect(root.textContent).toContain('ลงทะเบียนล่วงหน้า');
	});
});
