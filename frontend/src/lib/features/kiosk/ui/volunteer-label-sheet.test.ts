import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import VolunteerLabelSheet from './volunteer-label-sheet.svelte';

const sheet = {
	qrSrc: 'data:image/png;base64,QRPIXELS',
	qrSizeMm: 24,
	name: 'สมหญิง ใจดี',
	badge: 'จิตอาสา · VOL-0042'
};

describe('VolunteerLabelSheet', () => {
	it('shows the name, the badge, the QR image and the link, and never a phone number', () => {
		const { body } = render(VolunteerLabelSheet, { props: { sheet } });

		expect(body).toContain('สมหญิง ใจดี');
		expect(body).toContain('จิตอาสา · VOL-0042');
		expect(body).toContain('src="data:image/png;base64,QRPIXELS"');
		expect(body).toContain('width: 24mm');
		expect(body).toContain('shelter.psu.ac.th');
		expect(body).not.toMatch(/\d{9,}/);
		expect(body).not.toMatch(/0\d-?\d{3,4}-?\d{4}/);
	});

	it('renders nothing printable when there is no sheet', () => {
		const { body } = render(VolunteerLabelSheet, { props: { sheet: null } });

		expect(body).not.toContain('kiosk-print-area');
		expect(body).not.toContain('<img');
	});
});
