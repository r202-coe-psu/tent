import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { langState } from '$lib/states/i18n.svelte';
import EvacueeProfileMobileDock from './evacuee-profile-mobile-dock.svelte';

function renderDock(language: 'th' | 'en', readonly = false) {
	const previous = langState.current;
	langState.current = language;
	try {
		return render(EvacueeProfileMobileDock, {
			props: { visible: true, readonly, onOpenZoneModal: () => {}, onOpenActions: () => {} }
		}).body;
	} finally {
		langState.current = previous;
	}
}

describe('EvacueeProfileMobileDock', () => {
	it('shows English labels and no Thai text when the staff language is EN', () => {
		const body = renderDock('en');
		expect(body).toContain('aria-label="Quick actions"');
		expect(body).toContain('Change zone');
		expect(body).toContain('Actions');
		expect(body).not.toMatch(/[฀-๿]/);

		const readonlyBody = renderDock('en', true);
		expect(readonlyBody).toContain('Actions');
		expect(readonlyBody).not.toMatch(/[฀-๿]/);
	});

	it('keeps the Thai labels when the staff language is TH', () => {
		const body = renderDock('th');
		expect(body).toContain('aria-label="การดำเนินการด่วน"');
		expect(body).toContain('ย้ายโซน');
		expect(body).toContain('การดำเนินการ');
	});
});
