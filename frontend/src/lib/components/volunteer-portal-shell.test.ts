import { describe, expect, it } from 'vitest';
import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import { langState } from '$lib/states/i18n.svelte';
import VolunteerPortalShell from './volunteer-portal-shell.svelte';

const children = createRawSnippet(() => ({ render: () => '<p>page body</p>' }));

function renderShell(language: 'th' | 'en') {
	const previous = langState.current;
	langState.current = language;
	try {
		return render(VolunteerPortalShell, { props: { children } }).body;
	} finally {
		langState.current = previous;
	}
}

// Titles are tooltips, not visible copy; keep them out of the "no Thai text" check.
const withoutSwitcherTitles = (html: string) => html.replace(/title="[^"]*"/g, '');

describe('VolunteerPortalShell', () => {
	it('shows a TH/EN switcher in the header', () => {
		const body = renderShell('th');
		const header = body.slice(body.indexOf('<header'), body.indexOf('</header>'));
		expect(header).toContain('aria-label="Switch to English"');
		expect(header).toContain('>TH<');
	});

	it('shows English header and footer labels and no Thai text when the language is EN', () => {
		const body = renderShell('en');
		expect(body).toContain('Back to home');
		expect(body).toContain('Check jobs, track your status and report for duty');
		expect(body).toContain('Volunteer services');
		expect(withoutSwitcherTitles(body)).not.toMatch(/[฀-๿]/);
	});

	it('keeps the Thai header and footer labels when the language is TH', () => {
		const body = renderShell('th');
		expect(body).toContain('กลับหน้าหลัก');
		expect(body).toContain('เช็คงาน ติดตามสถานะ และรายงานตัวปฏิบัติหน้าที่');
		expect(body).toContain('ระบบบริการจิตอาสา');
	});
});
