// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import EvacueePickerTable from './evacuee-picker-table.svelte';

const state = vi.hoisted(() => ({
	pages: [] as Array<{ items: unknown[]; nextCursor: unknown }>,
	hasNextPage: false,
	blocked: new Set<string>(),
	searchQueries: [] as Array<() => string>,
	lookupIds: [] as Array<() => readonly string[]>
}));

vi.mock('$lib/features/people', () => ({
	zoneLabel: () => 'A',
	extractScanPersonQr: () => null,
	checkPersonQr: vi.fn(),
	staffPersonQrRejectionMessage: () => '',
	useEvacueeServerSearch: (q: () => string) => {
		state.searchQueries.push(q);
		return {
			get data() {
				return { pages: state.pages };
			},
			isPending: false,
			isError: false,
			get hasNextPage() {
				return state.hasNextPage;
			},
			isFetchingNextPage: false,
			fetchNextPage: vi.fn(),
			refetch: vi.fn()
		};
	}
}));

vi.mock('$lib/features/shelters', () => ({ useShelter: () => ({ data: { zones: [] } }) }));
vi.mock('$lib/db/shelter', () => ({ getShelterCode: () => 'SH001' }));
vi.mock('../application/queries', () => ({
	useActiveReferralEvacueeIds: (ids: () => readonly string[]) => {
		state.lookupIds.push(ids);
		return { data: state.blocked, isError: false, refetch: vi.fn() };
	}
}));

const ev = (id: string, first: string, status = 'active') => ({
	_id: id,
	first_name: first,
	last_name: 'ทดสอบ',
	phone: null,
	current_stay: { status, zone: 'A' }
});

let instance: ReturnType<typeof mount> | null = null;

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
	state.pages = [];
	state.hasNextPage = false;
	state.blocked = new Set();
	state.searchQueries.length = 0;
	state.lookupIds.length = 0;
	vi.useRealTimers();
});

function mountPicker(props: Record<string, unknown> = {}) {
	instance = mount(EvacueePickerTable, { target: document.body, props });
	flushSync();
}

function typeQuery(value: string) {
	const input = document.body.querySelector<HTMLInputElement>('input[type="search"]')!;
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	vi.advanceTimersByTime(400);
	flushSync();
}

describe('EvacueePickerTable (#555)', () => {
	it('fetches nothing until the user types', () => {
		mountPicker();
		expect(document.body.textContent).toContain('พิมพ์คำค้นเพื่อค้นหาผู้เข้าพัก');
		expect(state.searchQueries[0]()).toBe('');
	});

	it('offers a camera scan button next to the search box', () => {
		mountPicker();
		const buttons = [...document.body.querySelectorAll('button')].map((b) => b.textContent?.trim());
		expect(buttons).toContain('สแกน QR');
	});

	it('marks a person with an active referral, disables them, and select-all skips them', () => {
		vi.useFakeTimers();
		state.pages = [
			{
				items: [
					ev('evacuee:A', 'อาทิตย์'),
					ev('evacuee:B', 'บุญ'),
					ev('evacuee:C', 'ซ้าย', 'checked_out')
				],
				nextCursor: { first_name: 'bm' }
			}
		];
		state.hasNextPage = true;
		state.blocked = new Set(['evacuee:B']);
		mountPicker();
		typeQuery('อ');

		expect(state.searchQueries[0]()).toBe('อ');
		// Only the rows on screen are looked up, and checked-out people are not shown.
		expect(state.lookupIds[0]()).toEqual(['evacuee:A', 'evacuee:B']);
		expect(document.body.textContent).not.toContain('ซ้าย');
		expect(document.body.textContent).toContain('มีคำร้องส่งต่อค้างอยู่');
		expect(document.body.textContent).toContain('โหลดเพิ่ม');

		const busy = document.body.querySelector<HTMLButtonElement>('[aria-label="เลือก บุญ ทดสอบ"]')!;
		expect(busy.disabled).toBe(true);

		document.body
			.querySelector<HTMLButtonElement>('[aria-label="เลือกทั้งหมดที่แสดงอยู่"]')!
			.click();
		flushSync();
		expect(document.body.textContent).toMatch(/เลือกแล้ว\s*1\s*คน/);
	});
});
