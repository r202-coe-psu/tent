import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import { langState } from '$lib/states/i18n.svelte';
import EvacueeSearchEditPage from './evacuee-search-edit-page.svelte';

// The page reads the shelter, the URL and the evacuee queue; serve fixed answers instead.
vi.mock('$app/navigation', () => ({ goto: vi.fn(async () => {}) }));
vi.mock('$app/state', () => ({
	page: { url: new URL('http://localhost/onsite/search-edit') }
}));
vi.mock('html5-qrcode', () => ({ Html5Qrcode: class {} }));
vi.mock('@tanstack/svelte-query', async (importOriginal) => ({
	...(await importOriginal<typeof import('@tanstack/svelte-query')>()),
	useQueryClient: () => ({})
}));
vi.mock('$lib/features/people', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/people')>()),
	// The queue has its own translated dictionary and tests.
	Station1EvacueeQueue: () => {}
}));
vi.mock('$lib/features/shelters', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/shelters')>()),
	useShelter: () => ({ data: { zones: [] }, isPending: false })
}));

function renderPage(language: 'th' | 'en') {
	const previous = langState.current;
	langState.current = language;
	try {
		const { body, head } = render(EvacueeSearchEditPage);
		return { body, head };
	} finally {
		langState.current = previous;
	}
}

describe('EvacueeSearchEditPage', () => {
	it('shows English labels and no Thai text when the staff language is EN', () => {
		const { body, head } = renderPage('en');
		expect(head).toContain('<title>Search and edit records | SmartShelter Thailand</title>');
		expect(body).toContain('aria-label="Back to the main menu"');
		expect(body).toContain('Search and edit evacuee records');
		expect(body).toContain(
			'Search &amp; Update — search by name, ID number, phone number or scan a QR code'
		);
		expect(body).toContain('placeholder="Enter ID number / phone number / full name..."');
		expect(body).toContain('Search records');
		expect(body).toContain('Scan ticket QR code');
		expect(body).not.toMatch(/[฀-๿]/);
		expect(head).not.toMatch(/[฀-๿]/);
	});

	it('keeps the Thai labels when the staff language is TH', () => {
		const { body, head } = renderPage('th');
		expect(head).toContain('<title>ค้นหาและแก้ไขข้อมูล | SmartShelter Thailand</title>');
		expect(body).toContain('aria-label="กลับหน้าเลือกเมนูหลัก"');
		expect(body).toContain('ค้นหาและแก้ไขข้อมูลผู้พักพิง');
		expect(body).toContain('Search &amp; Update — ค้นหาด้วยชื่อ เลขบัตร เบอร์โทร หรือสแกน QR');
		expect(body).toContain('placeholder="ระบุเลขบัตรประชาชน / เบอร์โทรศัพท์ / ชื่อ-นามสกุล..."');
		expect(body).toContain('ค้นหาข้อมูล');
		expect(body).toContain('สแกน QR Code ตั๋ว');
	});
});
