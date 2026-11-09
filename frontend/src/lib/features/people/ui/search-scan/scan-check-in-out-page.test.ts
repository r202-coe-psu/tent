import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import { langState } from '$lib/states/i18n.svelte';
import ScanCheckInOutPage from './scan-check-in-out-page.svelte';

// The page reads queries, the shelter and the camera; serve fixed answers instead.
vi.mock('$app/navigation', () => ({ goto: vi.fn(async () => {}) }));
vi.mock('html5-qrcode', () => ({ Html5Qrcode: class {} }));
vi.mock('@tanstack/svelte-query', async (importOriginal) => ({
	...(await importOriginal<typeof import('@tanstack/svelte-query')>()),
	useQueryClient: () => ({})
}));
vi.mock('$lib/features/people', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/people')>()),
	useCheckInEvacuee: () => ({ isPending: false, mutateAsync: vi.fn() }),
	useCheckOutEvacuee: () => ({ isPending: false, mutateAsync: vi.fn() }),
	useEvacuees: () => ({ data: [], isPending: false }),
	useSearchEvacuees: () => ({ data: [], isFetching: false })
}));
vi.mock('$lib/features/shelters', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/shelters')>()),
	useShelter: () => ({ data: { zones: [] }, isPending: false })
}));

function renderPage(language: 'th' | 'en') {
	const previous = langState.current;
	langState.current = language;
	try {
		return render(ScanCheckInOutPage).body;
	} finally {
		langState.current = previous;
	}
}

describe('ScanCheckInOutPage', () => {
	it('shows English labels and no Thai text when the staff language is EN', () => {
		const body = renderPage('en');
		expect(body).toContain('Scan shelter check-in / check-out');
		expect(body).toContain("Scan a code to manage the resident's status");
		expect(body).toContain('Search by name / ID number');
		expect(body).toContain('Scan a code to manage status');
		expect(body).toContain('Enter a code or scan a QR...');
		expect(body).toContain('title="Back"');
		expect(body).toContain('OK');
		expect(body).not.toMatch(/[฀-๿]/);
	});

	it('keeps the Thai labels when the staff language is TH', () => {
		const body = renderPage('th');
		expect(body).toContain('สแกนเข้า-ออกศูนย์ (Check-in / Out)');
		expect(body).toContain('สแกนรหัสเพื่อจัดการสถานะผู้พำนัก');
		expect(body).toContain('ค้นหาด้วยชื่อ/เลขบัตร');
		expect(body).toContain('สแกนรหัสเพื่อจัดการสถานะ');
		expect(body).toContain('ระบบจะพาไปยังหน้าจัดการสถานะทันที');
		expect(body).toContain('กรอกรหัส หรือ สแกน QR...');
		expect(body).toContain('title="กลับ"');
		expect(body).toContain('ตกลง');
	});
});
