import { describe, it, expect, vi } from 'vitest';
import { render } from 'svelte/server';
import { readable } from 'svelte/store';

// sveltekit-superforms reads the $app/stores page store during SSR; provide a minimal one.
vi.mock('$app/stores', () => ({
	page: readable({ data: {}, form: null, params: {}, url: new URL('http://localhost/') })
}));

import MedicalReferralForm from './medical-referral-form.svelte';

const { body } = render(MedicalReferralForm, {
	props: { evacueeId: 'evacuee:01A', onSubmit: () => {} }
});

function urgencyButton(label: string): string {
	const found = (body.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? []).find((b) =>
		b.includes(label)
	);
	if (!found) throw new Error(`urgency button not found: ${label}`);
	return found;
}

describe('medical-referral-form urgency options (F-32)', () => {
	it('reports the selected urgency with aria-pressed', () => {
		// Default urgency is 'normal'.
		expect(urgencyButton('ปกติ (Normal)')).toContain('aria-pressed="true"');
		expect(urgencyButton('เร่งด่วน (Urgent)')).toContain('aria-pressed="false"');
	});

	it('shows a non-color symbol on each urgency option', () => {
		expect(urgencyButton('ปกติ (Normal)')).toMatch(/<svg\b/);
		expect(urgencyButton('เร่งด่วน (Urgent)')).toMatch(/<svg\b/);
	});
});
