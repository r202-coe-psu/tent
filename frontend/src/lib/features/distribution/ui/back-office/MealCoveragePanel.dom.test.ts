// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import MealCoveragePanel from './MealCoveragePanel.svelte';

const env = vi.hoisted(() => ({
	evacuees: { data: [] as unknown[], isLoading: false, isError: false },
	movements: { data: [] as unknown[], isLoading: false, isError: false },
	logs: {
		data: { items: [] as unknown[], skipped: [] as unknown[] } as unknown,
		isLoading: false,
		isError: false
	},
	shelter: { data: undefined as unknown }
}));

vi.mock('$lib/features/people', async (orig) => ({
	zoneLabel: (await orig<typeof import('$lib/features/people')>()).zoneLabel,
	useEvacuees: () => env.evacuees,
	useMovements: () => env.movements
}));
vi.mock('$lib/features/shelters', async (orig) => ({
	...(await orig<typeof import('$lib/features/shelters')>()),
	useShelter: () => env.shelter
}));
vi.mock('../../application/queries', () => ({
	useDistributionLogsWithSkipped: () => env.logs
}));
vi.mock('../model/meal-coverage-view', async (orig) => ({
	...(await orig<typeof import('../model/meal-coverage-view')>()),
	previousThaiDay: () => '2026-11-09'
}));

const person = (id: string, first: string) => ({
	_id: id,
	first_name: first,
	last_name: 'ใจดี',
	nickname: null,
	current_stay: { status: 'active', since: '2026-11-01T00:00:00Z' }
});
const log = (id: string, meal: string) => ({
	recipient_type: 'evacuee',
	recipient_id: id,
	meal,
	status: 'fulfilled',
	is_returnable: false,
	distributed_at: '2026-11-09T01:00:00Z'
});

let cmp: ReturnType<typeof mount> | undefined;
function render() {
	cmp = mount(MealCoveragePanel, { target: document.body, props: { shelterCode: 'SH001' } });
	flushSync();
	return document.body.textContent ?? '';
}

beforeEach(() => {
	env.evacuees = { data: [], isLoading: false, isError: false };
	env.movements = { data: [], isLoading: false, isError: false };
	env.logs = { data: { items: [], skipped: [] }, isLoading: false, isError: false };
	env.shelter = { data: undefined };
});
afterEach(() => {
	if (cmp) void unmount(cmp);
	cmp = undefined;
	document.body.innerHTML = '';
});

describe('MealCoveragePanel', () => {
	it('lists who has fewer than 2 meals with received and missing meals', () => {
		env.evacuees.data = [person('evacuee:A', 'สมชาย'), person('evacuee:B', 'สมหญิง')];
		env.logs.data = {
			items: [
				log('evacuee:A', 'breakfast'),
				log('evacuee:B', 'breakfast'),
				log('evacuee:B', 'lunch')
			],
			skipped: []
		};
		const text = render();
		expect(text).toContain('สมชาย ใจดี');
		expect(text).not.toContain('สมหญิง');
		expect(text).toContain('ยังไม่ครบ 1 คน');
		expect(text).toContain('1 คน');
	});

	it('shows the empty state when everyone has 2 meals', () => {
		env.evacuees.data = [person('evacuee:B', 'สมหญิง')];
		env.logs.data = {
			items: [log('evacuee:B', 'breakfast'), log('evacuee:B', 'dinner')],
			skipped: []
		};
		expect(render()).toContain('มีบันทึกรับอาหารอย่างน้อย 2 มื้อ');
	});

	it('words the result as "no record", never "did not eat"', () => {
		env.evacuees.data = [person('evacuee:A', 'สมชาย')];
		const text = render();
		expect(text).toContain('ยังไม่มีบันทึกรับอาหาร');
		expect(text).not.toContain('ไม่ได้กิน');
	});

	it('warns when some logs could not be read', () => {
		env.logs.data = { items: [], skipped: [{ _id: 'distribution_log:x' }] };
		expect(render()).toContain('อ่านไม่ได้');
	});

	it('shows an error instead of an empty list when a query fails', () => {
		env.logs.isError = true;
		const text = render();
		expect(text).toContain('โหลดข้อมูลไม่สำเร็จ');
		expect(text).not.toContain('อย่างน้อย 2 มื้อ');
	});

	function typeDate(value: string) {
		const input = document.querySelector('input[type="date"]') as HTMLInputElement;
		input.value = value;
		input.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		return document.body.textContent ?? '';
	}

	it('asks for a date instead of listing everyone when the date is cleared', () => {
		env.evacuees.data = [person('evacuee:A', 'สมชาย')];
		render();
		const text = typeDate('');
		expect(text).toContain('เลือกวันที่');
		expect(text).not.toContain('สมชาย');
	});

	it('refuses today or a future day, whose meals are not over', () => {
		env.evacuees.data = [person('evacuee:A', 'สมชาย')];
		render();
		const text = typeDate('2026-11-10');
		expect(text).toContain('เลือกวันที่');
		expect(text).not.toContain('สมชาย');
	});

	it('says so when nobody was in the shelter all day, instead of "everyone has 2 meals"', () => {
		env.evacuees.data = [
			{
				...person('evacuee:A', 'สมชาย'),
				current_stay: { status: 'active', since: '2026-11-09T03:00:00Z' }
			}
		];
		const text = render();
		expect(text).toContain('ไม่มีผู้ที่อยู่ในศูนย์ตลอดทั้งวัน');
		expect(text).not.toContain('อย่างน้อย 2 มื้อ');
	});

	it('shows the zone name, falling back to the code when the shelter has no name for it', () => {
		const zoned = (id: string, first: string, zone: string) => {
			const p = person(id, first);
			return { ...p, current_stay: { ...p.current_stay, zone } };
		};
		env.evacuees.data = [zoned('evacuee:A', 'สมชาย', 'Z1'), zoned('evacuee:B', 'สมหญิง', 'Z9')];
		env.shelter = { data: { zones: [{ code: 'z1', name: 'อาคารหนึ่ง' }] } };
		const text = render();
		expect(text).toContain('อาคารหนึ่ง');
		expect(text).not.toContain('Z1');
		expect(text).toContain('Z9');
	});

	it('sorts the rows by name', () => {
		env.evacuees.data = [person('evacuee:B', 'ศศิ'), person('evacuee:A', 'กมล')];
		const text = render();
		expect(text.indexOf('กมล')).toBeLessThan(text.indexOf('ศศิ'));
	});

	describe('paging, filtering and search', () => {
		const names = (n: number) =>
			Array.from({ length: n }, (_, i) =>
				person(`evacuee:${i}`, `ชื่อ${String(i).padStart(2, '0')}`)
			);
		const rowNames = () =>
			Array.from(document.querySelectorAll('tbody tr')).map((tr) => tr.textContent ?? '');
		const click = (el: Element | null | undefined) => {
			(el as HTMLElement).click();
			flushSync();
		};
		const card = (label: string) =>
			Array.from(document.querySelectorAll('button[aria-pressed]')).find((b) =>
				b.textContent?.includes(label)
			);
		const search = (value: string) => {
			const input = document.querySelector('input[type="search"]') as HTMLInputElement;
			input.value = value;
			input.dispatchEvent(new Event('input', { bubbles: true }));
			flushSync();
		};

		it('shows 20 rows per page and a next-page control reveals the rest', () => {
			env.evacuees.data = names(45);
			render();
			expect(rowNames()).toHaveLength(20);
			expect(document.body.textContent).toContain('แสดง 1–20 จาก 45 คน');
			click(document.querySelector('a[aria-label*="next" i], button[aria-label*="next" i]'));
			expect(rowNames()).toHaveLength(20);
			expect(document.body.textContent).toContain('แสดง 21–40 จาก 45 คน');
		});

		it('hides the page controls but keeps the range line for a single page', () => {
			env.evacuees.data = names(3);
			render();
			expect(document.querySelector('nav[aria-label*="pagination" i]')).toBeNull();
			expect(document.body.textContent).toContain('แสดง 1–3 จาก 3 คน');
		});

		it('filters to people with no meals when the red card is pressed', () => {
			env.evacuees.data = [person('evacuee:A', 'สมชาย'), person('evacuee:B', 'สมหญิง')];
			env.logs.data = { items: [log('evacuee:B', 'lunch')], skipped: [] };
			render();
			expect(rowNames()).toHaveLength(2);
			const red = card('ยังไม่มีบันทึกเลย');
			click(red);
			expect(red?.getAttribute('aria-pressed')).toBe('true');
			expect(rowNames()).toHaveLength(1);
			expect(rowNames()[0]).toContain('สมชาย');
		});

		it('lists people with no record before people with one meal', () => {
			env.evacuees.data = [person('evacuee:A', 'กมล'), person('evacuee:B', 'ศศิ')];
			env.logs.data = { items: [log('evacuee:A', 'lunch')], skipped: [] };
			render();
			expect(rowNames()[0]).toContain('ศศิ');
		});

		it('narrows rows by name search and returns to page 1', () => {
			env.evacuees.data = names(45);
			render();
			click(document.querySelector('a[aria-label*="next" i], button[aria-label*="next" i]'));
			expect(document.body.textContent).toContain('แสดง 21–40');
			search('ชื่อ07');
			expect(rowNames()).toHaveLength(1);
			expect(document.body.textContent).toContain('แสดง 1–1 จาก 1 คน');
		});

		it('shows the empty-filter state and clears it', () => {
			env.evacuees.data = [person('evacuee:A', 'สมชาย')];
			render();
			search('ไม่มีใคร');
			expect(document.body.textContent).toContain('ไม่พบรายชื่อที่ตรงกับเงื่อนไข');
			click(
				Array.from(document.querySelectorAll('button')).find((b) =>
					b.textContent?.includes('ล้างตัวกรอง')
				)
			);
			expect(rowNames()).toHaveLength(1);
			expect((document.querySelector('input[type="search"]') as HTMLInputElement).value).toBe('');
		});
	});
});
