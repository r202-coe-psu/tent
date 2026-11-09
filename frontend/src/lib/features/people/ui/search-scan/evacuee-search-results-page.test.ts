import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import { langState } from '$lib/states/i18n.svelte';
import type { Evacuee } from '../../domain/people';
import EvacueeSearchResultsPage from './evacuee-search-results-page.svelte';

const searchState: { data: Evacuee[]; isFetching: boolean } = { data: [], isFetching: false };

// The page reads the URL, the search results and the shelter; serve fixed answers instead.
vi.mock('$app/navigation', () => ({ goto: vi.fn(async () => {}) }));
vi.mock('$app/state', () => ({
	page: { url: new URL('http://localhost/onsite/search-edit/results?q=Anna') }
}));
vi.mock('$lib/features/people', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/people')>()),
	useSearchEvacuees: () => ({
		get data() {
			return searchState.data;
		},
		get isFetching() {
			return searchState.isFetching;
		}
	})
}));
vi.mock('$lib/features/shelters', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/shelters')>()),
	useShelter: () => ({ data: { zones: [] }, isPending: false })
}));

const anna = {
	_id: 'evacuee:anna',
	type: 'evacuee',
	first_name: 'Anna',
	last_name: 'Schmidt',
	person_id: null,
	current_stay: { status: 'active', zone: 'A', since: '2026-09-02T10:00:00.000Z' }
} as unknown as Evacuee;

function renderPage(
	language: 'th' | 'en',
	state: { data: Evacuee[]; isFetching?: boolean } = { data: [anna] }
) {
	const previous = langState.current;
	langState.current = language;
	searchState.data = state.data;
	searchState.isFetching = state.isFetching ?? false;
	try {
		const { body, head } = render(EvacueeSearchResultsPage);
		return { body, head };
	} finally {
		langState.current = previous;
	}
}

describe('EvacueeSearchResultsPage', () => {
	it('shows English result labels and no Thai text when the staff language is EN', () => {
		const { body, head } = renderPage('en');
		expect(head).toContain('<title>Search results | SmartShelter Thailand</title>');
		expect(body).toContain('title="Back"');
		expect(body).toContain('Evacuee search results');
		expect(body).toContain('Found matching evacuees (1 result)');
		expect(body).toContain('Search term:');
		expect(body).toContain('New search');
		expect(body).toContain('Zone A');
		expect(body).toContain('View and edit');
		expect(body).not.toMatch(/[฀-๿]/);
		expect(head).not.toMatch(/[฀-๿]/);
	});

	it('shows the English empty and searching states with no Thai text', () => {
		const empty = renderPage('en', { data: [] }).body;
		expect(empty).toContain('No matching evacuees found');
		expect(empty).toContain('No evacuee matches this search term. Please check it and try again');
		expect(empty).not.toMatch(/[฀-๿]/);

		const searching = renderPage('en', { data: [], isFetching: true }).body;
		expect(searching).toContain('Searching...');
		expect(searching).not.toMatch(/[฀-๿]/);
	});

	it('keeps the Thai labels when the staff language is TH', () => {
		const { body, head } = renderPage('th');
		expect(head).toContain('<title>ผลการค้นหา | SmartShelter Thailand</title>');
		expect(body).toContain('title="กลับ"');
		expect(body).toContain('ผลการค้นหาผู้พักพิง');
		expect(body).toContain('Search Results');
		expect(body).toContain('พบข้อมูลผู้พักพิงที่ตรงกัน (1 รายการ)');
		expect(body).toContain('คำค้นหา:');
		expect(body).toContain('ค้นหาใหม่');
		expect(body).toContain('Zone A');
		expect(body).toContain('ดูข้อมูลและแก้ไข');

		const empty = renderPage('th', { data: [] }).body;
		expect(empty).toContain('ไม่พบข้อมูลผู้พักพิงที่ตรงกัน');
		expect(empty).toContain('ไม่พบข้อมูลผู้พักพิงที่ตรงกับคำค้นหานี้ กรุณาตรวจสอบคำค้นหาอีกครั้ง');
		expect(renderPage('th', { data: [], isFetching: true }).body).toContain('กำลังค้นหาข้อมูล...');
	});
});
