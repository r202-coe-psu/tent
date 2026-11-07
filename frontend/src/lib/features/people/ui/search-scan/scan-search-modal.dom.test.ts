// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { langState } from '$lib/states/i18n.svelte';
import type { Evacuee } from '../../domain/people';
import ScanSearchModal from './scan-search-modal.svelte';

const searchState: { data: Evacuee[] } = { data: [] };

// Search results come from CouchDB; serve whatever the test put in `searchState`.
vi.mock('$lib/features/people', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/people')>()),
	useSearchEvacuees: () => ({
		get data() {
			return searchState.data;
		},
		isFetching: false
	})
}));

const anna = {
	_id: 'evacuee:anna',
	type: 'evacuee',
	first_name: 'Anna',
	last_name: 'Schmidt',
	phone: null,
	person_id: null,
	current_stay: { status: 'active', zone: 'A', since: '2026-09-02T10:00:00.000Z' }
} as unknown as Evacuee;

let instance: ReturnType<typeof mount> | null = null;
let previousLanguage = langState.current;

async function settle() {
	for (let i = 0; i < 3; i++) {
		flushSync();
		await tick();
	}
}

async function openModal(language: 'th' | 'en', data: Evacuee[] = []) {
	previousLanguage = langState.current;
	langState.current = language;
	searchState.data = data;
	instance = mount(ScanSearchModal, {
		target: document.body,
		props: { show: true, onClose: () => {}, onSelect: () => {} }
	});
	await settle();
}

async function typeQuery(value: string) {
	const input = document.body.querySelector('input[type="text"]') as HTMLInputElement;
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	await settle();
}

afterEach(async () => {
	if (instance) unmount(instance);
	instance = null;
	langState.current = previousLanguage;
	await new Promise((resolve) => setTimeout(resolve, 50));
	document.body.innerHTML = '';
});

describe('ScanSearchModal', () => {
	it('shows English labels and no Thai text when the staff language is EN', async () => {
		await openModal('en');
		const initial = document.body.textContent ?? '';
		expect(initial).toContain('Search residents to check in / check out');
		expect(initial).toContain('Type to search the records');
		expect(document.body.querySelector('input')?.placeholder).toBe(
			'Type a name, surname or phone number...'
		);
		expect(initial).not.toMatch(/[฀-๿]/);
	});

	it('shows the English empty-search message and no Thai text when the staff language is EN', async () => {
		await openModal('en');
		await typeQuery('Nobody');
		const body = document.body.textContent ?? '';
		expect(body).toContain('No names match the search');
		expect(body).not.toMatch(/[฀-๿]/);
	});

	it('shows English result rows and no Thai text when the staff language is EN', async () => {
		await openModal('en', [anna]);
		await typeQuery('Anna');
		const body = document.body.textContent ?? '';
		expect(body).toContain('Anna');
		expect(body).toContain('Schmidt');
		expect(body).toContain('ID number: — • Phone: Not specified');
		expect(body).toContain('Checked in');
		expect(body).toContain('Select');
		expect(body).not.toMatch(/[฀-๿]/);
	});

	it('keeps the Thai labels when the staff language is TH', async () => {
		await openModal('th', [anna]);
		const initial = document.body.textContent ?? '';
		expect(initial).toContain('ค้นหาผู้พักพิงเพื่อเช็คอิน / เช็คเอาท์');
		expect(document.body.querySelector('input')?.placeholder).toBe(
			'พิมพ์ชื่อ นามสกุล หรือหมายเลขโทรศัพท์...'
		);
		expect(initial).toContain('พิมพ์ข้อมูลเพื่อสืบค้นประวัติ');

		await typeQuery('Anna');
		const body = document.body.textContent ?? '';
		expect(body).toContain('เลขบัตร: — • โทร: ไม่ระบุ');
		expect(body).toContain('เช็คอิน');
		expect(body).toContain('เลือก');
	});

	it('keeps the Thai empty-search message when the staff language is TH', async () => {
		await openModal('th');
		await typeQuery('Nobody');
		expect(document.body.textContent).toContain('ไม่พบรายชื่อที่ตรงกับคำค้นหา');
	});
});
