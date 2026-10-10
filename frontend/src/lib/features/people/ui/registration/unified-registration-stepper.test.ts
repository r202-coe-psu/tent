import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import { langState } from '$lib/states/i18n.svelte';
import UnifiedRegistrationStepper from './unified-registration-stepper.svelte';

const sections = [
	{ id: 'address', label: 'address' },
	{ id: 'members', label: 'members' },
	{ id: 'pets', label: 'pets' }
];

function renderStepper() {
	return render(UnifiedRegistrationStepper, {
		props: { sections, activeSection: 'members', onNavigate: vi.fn() }
	});
}

describe('UnifiedRegistrationStepper', () => {
	it('labels steps in Thai by default', () => {
		const previous = langState.current;
		langState.current = 'th';
		try {
			const { body } = renderStepper();
			expect(body).toContain('ขั้นตอนการลงทะเบียน');
			expect(body).toContain('ขั้นตอนที่ 2');
			expect(body).toContain('ที่พักอาศัย');
		} finally {
			langState.current = previous;
		}
	});

	it('follows the page language when it is English', () => {
		const previous = langState.current;
		langState.current = 'en';
		try {
			const { body } = renderStepper();
			expect(body).toContain('Registration steps');
			expect(body).toContain('Step 2');
			expect(body).toContain('Residence');
			expect(body).toContain('Members');
			expect(body).not.toMatch(/[฀-๿]/);
		} finally {
			langState.current = previous;
		}
	});
});
