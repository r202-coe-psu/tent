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
	shelter: { data: undefined as unknown },
	services: { data: [] as unknown[], isLoading: false, isError: false },
	receipts: { data: [] as unknown[], isLoading: false, isError: false },
	downloadCsv: vi.fn(),
	dayGetter: undefined as (() => string) | undefined
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
vi.mock('$lib/features/kitchen', async (orig) => ({
	...(await orig<typeof import('$lib/features/kitchen')>()),
	useMealServices: () => env.services,
	useMealServiceReceipts: () => env.receipts
}));
vi.mock('$lib/utils/download-csv', () => ({ downloadCsv: env.downloadCsv }));
vi.mock('../../application/queries', () => ({
	useDistributionLogsByDay: (_shelter: () => string | undefined, day: () => string) => {
		env.dayGetter = day;
		return env.logs;
	}
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

const click = (el: Element | null | undefined) => {
	(el as HTMLElement).click();
	flushSync();
};
const typeInto = (selector: string, value: string) => {
	const input = document.querySelector(selector) as HTMLInputElement;
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
};
const typeDay = (value: string) => typeInto('input[type="date"]', value);
const search = (value: string) => typeInto('input[type="search"]', value);
const bodyText = () => document.body.textContent ?? '';
const rowTexts = () =>
	Array.from(document.querySelectorAll('tbody tr')).map((tr) => tr.textContent ?? '');
const mealBadges = (row: Element) =>
	Array.from(row.querySelectorAll('li')).map((li) =>
		(li.textContent ?? '').replace(/\s+/g, ' ').trim()
	);

beforeEach(() => {
	// Thai today is 2026-11-10, so the default day is 2026-11-09.
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-11-10T05:00:00Z'));
	env.services = { data: [], isLoading: false, isError: false };
	env.receipts = { data: [], isLoading: false, isError: false };
	env.downloadCsv.mockReset();
	env.evacuees = { data: [], isLoading: false, isError: false };
	env.movements = { data: [], isLoading: false, isError: false };
	env.logs = { data: { items: [], skipped: [] }, isLoading: false, isError: false };
	env.shelter = { data: undefined };
});
afterEach(() => {
	vi.useRealTimers();
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
		const row = document.querySelector('tbody tr') as Element;
		expect(mealBadges(row)).toEqual([
			'เช้า มีบันทึก',
			'กลางวัน ยังไม่มีบันทึก',
			'เย็น ยังไม่มีบันทึก'
		]);
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
		expect(rowTexts()).toHaveLength(0);
	});

	it('asks for a date instead of listing everyone when the date is cleared', () => {
		env.evacuees.data = [person('evacuee:A', 'สมชาย')];
		render();
		typeDay('');
		const text = bodyText();
		expect(text).toContain('เลือกวันที่');
		expect(text).not.toContain('สมชาย');
	});

	it('refuses a future day, whose meals have not happened', () => {
		env.evacuees.data = [person('evacuee:A', 'สมชาย')];
		render();
		typeDay('2026-11-11');
		const text = bodyText();
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

	it('lets the date picker go up to today', () => {
		render();
		expect((document.querySelector('input[type="date"]') as HTMLInputElement).max).toBe(
			'2026-11-10'
		);
	});

	it('sorts the rows by name', () => {
		env.evacuees.data = [person('evacuee:B', 'ศศิ'), person('evacuee:A', 'กมล')];
		render();
		expect(rowTexts()[0]).toContain('กมล');
		expect(rowTexts()[1]).toContain('ศศิ');
	});

	it('requests the logs of the day typed into the date field', () => {
		render();
		expect(env.dayGetter?.()).toBe('2026-11-09');
		typeDay('2026-11-05');
		expect(env.dayGetter?.()).toBe('2026-11-05');
	});

	describe('paging, filtering and search', () => {
		const names = (n: number) =>
			Array.from({ length: n }, (_, i) =>
				person(`evacuee:${i}`, `ชื่อ${String(i).padStart(2, '0')}`)
			);
		const card = (label: string) =>
			Array.from(document.querySelectorAll('button[aria-pressed]')).find((b) =>
				b.textContent?.includes(label)
			);

		it('shows 20 rows per page and a next-page control reveals the rest', () => {
			env.evacuees.data = names(45);
			render();
			expect(rowTexts()).toHaveLength(20);
			expect(document.body.textContent).toContain('แสดง 1–20 จาก 45 คน');
			click(document.querySelector('a[aria-label*="next" i], button[aria-label*="next" i]'));
			expect(rowTexts()).toHaveLength(20);
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
			expect(rowTexts()).toHaveLength(2);
			const red = card('ยังไม่มีบันทึกเลย');
			click(red);
			expect(red?.getAttribute('aria-pressed')).toBe('true');
			expect(rowTexts()).toHaveLength(1);
			expect(rowTexts()[0]).toContain('สมชาย');
		});

		it('lists people with no record before people with one meal', () => {
			env.evacuees.data = [person('evacuee:A', 'กมล'), person('evacuee:B', 'ศศิ')];
			env.logs.data = { items: [log('evacuee:A', 'lunch')], skipped: [] };
			render();
			expect(rowTexts()[0]).toContain('ศศิ');
		});

		it('narrows rows by name search and returns to page 1', () => {
			env.evacuees.data = names(45);
			render();
			click(document.querySelector('a[aria-label*="next" i], button[aria-label*="next" i]'));
			expect(document.body.textContent).toContain('แสดง 21–40');
			search('ชื่อ07');
			expect(rowTexts()).toHaveLength(1);
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
			expect(rowTexts()).toHaveLength(1);
			expect((document.querySelector('input[type="search"]') as HTMLInputElement).value).toBe('');
		});
	});
});

const todayLog = (id: string, meal: string) => ({
	...log(id, meal),
	distributed_at: '2026-11-10T01:00:00Z'
});
const service = (id: string, meal: string, date = '2026-11-10') => ({ _id: id, date, meal });

describe('MealCoveragePanel today', () => {
	beforeEach(() => {
		env.evacuees.data = [person('evacuee:A', 'สมชาย'), person('evacuee:B', 'สมหญิง')];
	});

	it('says no meal has been served yet and shows neither list nor cards', () => {
		render();
		typeDay('2026-11-10');
		const text = document.body.textContent ?? '';
		expect(text).toContain('ยังไม่มีมื้อที่ให้บริการวันนี้');
		expect(rowTexts()).toHaveLength(0);
		expect(document.querySelector('button[aria-pressed]')).toBeNull();
	});

	it('with only breakfast served, lists who has no breakfast and names the counted meals', () => {
		env.services.data = [service('ms:1', 'breakfast')];
		env.logs.data = { items: [todayLog('evacuee:A', 'breakfast')], skipped: [] };
		render();
		typeDay('2026-11-10');
		expect(document.body.textContent).toContain('วันนี้นับเฉพาะมื้อที่ให้บริการแล้ว: เช้า');
		expect(rowTexts()).toHaveLength(1);
		expect(rowTexts()[0]).toContain('สมหญิง');
		expect(rowTexts()[0]).toContain('ยังไม่ถึงมื้อ');
	});

	it('does not count a meal_service whose receipt was rejected', () => {
		env.services.data = [service('ms:1', 'breakfast'), service('ms:2', 'lunch')];
		env.receipts.data = [
			{ meal_service_id: 'ms:1', outcome: 'rejected', created_at: '2026-11-10T03:00:00Z' }
		];
		render();
		typeDay('2026-11-10');
		const text = document.body.textContent ?? '';
		expect(text).toContain('วันนี้นับเฉพาะมื้อที่ให้บริการแล้ว: กลางวัน');
		expect(text).not.toContain('แล้ว: เช้า');
	});

	it('words the heading and drops the one-meal card when a single meal counts', () => {
		env.services.data = [service('ms:1', 'breakfast')];
		render();
		typeDay('2026-11-10');
		const text = document.body.textContent ?? '';
		expect(text).toContain('ผู้พักพิงที่ยังไม่มีบันทึกรับอาหารของมื้อที่ให้บริการแล้ว');
		expect(text).not.toContain('ครบ 2 มื้อ');
		expect(text).not.toContain('มีบันทึก 1 มื้อ');
		expect(text).toContain('ยังไม่มีบันทึกเลย');
	});

	it('words today as present since the start of the day, past days as all day', () => {
		env.services.data = [service('ms:1', 'breakfast')];
		render();
		expect(bodyText()).toContain('ของผู้ที่อยู่ในศูนย์ตลอดทั้งวัน');
		expect(bodyText()).toContain('อยู่ในศูนย์ตลอดวัน');
		typeDay('2026-11-10');
		expect(bodyText()).toContain('ของผู้ที่อยู่ในศูนย์ตั้งแต่ต้นวันถึงตอนนี้');
		expect(bodyText()).not.toContain('ตลอดทั้งวัน');
		expect(bodyText()).toContain('อยู่ในศูนย์ตั้งแต่ต้นวัน');
		expect(bodyText()).not.toContain('อยู่ในศูนย์ตลอดวัน');
	});

	it('keeps the two-meal rule once two meals are served', () => {
		env.services.data = [service('ms:1', 'breakfast'), service('ms:2', 'lunch')];
		env.logs.data = { items: [todayLog('evacuee:A', 'breakfast')], skipped: [] };
		render();
		typeDay('2026-11-10');
		expect(document.body.textContent).toContain('ครบ 2 มื้อ');
		expect(rowTexts()).toHaveLength(2);
	});
});

describe('MealCoveragePanel zone, household, advisory and export', () => {
	it('shows the zone of the selected day, not the zone after a later move', () => {
		const p = person('evacuee:A', 'สมชาย');
		env.evacuees.data = [{ ...p, current_stay: { ...p.current_stay, zone: 'NEW' } }];
		env.movements.data = [
			{
				evacuee_id: 'evacuee:A',
				action: 'check_in',
				zone: 'OLD',
				occurred_at: '2026-11-01T00:00:00Z'
			},
			{
				evacuee_id: 'evacuee:A',
				action: 'zone_change',
				zone: 'NEW',
				occurred_at: '2026-11-10T03:00:00Z'
			}
		];
		render();
		const headers = Array.from(document.querySelectorAll('th')).map((th) => th.textContent?.trim());
		expect(headers).toContain('โซน');
		expect(rowTexts()[0]).toContain('OLD');
		expect(rowTexts()[0]).not.toContain('NEW');
	});

	it('flags a household member recording a meal without changing the row', () => {
		const withHousehold = (id: string, first: string) => ({
			...person(id, first),
			household_id: 'h:1'
		});
		env.evacuees.data = [withHousehold('evacuee:A', 'สมชาย'), withHousehold('evacuee:B', 'สมหญิง')];
		env.logs.data = { items: [log('evacuee:B', 'lunch'), log('evacuee:B', 'dinner')], skipped: [] };
		render();
		expect(rowTexts()).toHaveLength(1);
		expect(rowTexts()[0]).toContain('สมชาย');
		expect(rowTexts()[0]).toContain('ครัวเรือนมีบันทึกรับ: กลางวัน, เย็น');
	});

	it('advises that an unscanned meal may have been handed out without scanning', () => {
		env.evacuees.data = [person('evacuee:A', 'สมชาย')];
		env.logs.data = {
			items: [log('evacuee:A', 'breakfast'), log('evacuee:A', 'lunch')],
			skipped: []
		};
		const text = render();
		expect(text).toContain('ไม่มีบันทึกสแกนมื้อเย็นของวันที่เลือกเลย');
		expect(text).not.toContain('ไม่มีบันทึกสแกนมื้อเช้า');
	});

	it('does not advise when nobody was in the shelter all day', () => {
		env.evacuees.data = [
			{
				...person('evacuee:A', 'สมชาย'),
				current_stay: { status: 'active', since: '2026-11-09T03:00:00Z' }
			}
		];
		const text = render();
		expect(text).toContain('ไม่มีผู้ที่อยู่ในศูนย์ตลอดทั้งวัน');
		expect(text).not.toContain('ไม่มีบันทึกสแกนมื้อ');
	});

	const exportButton = () =>
		Array.from(document.querySelectorAll('button')).find((b) =>
			b.textContent?.includes('ส่งออก CSV')
		) as HTMLButtonElement;

	it('exports the filtered rows and disables the button when none match', () => {
		env.evacuees.data = [person('evacuee:A', 'สมชาย'), person('evacuee:B', 'สมหญิง')];
		render();
		search('สมหญิง');
		expect(exportButton().disabled).toBe(false);
		click(exportButton());

		expect(env.downloadCsv).toHaveBeenCalledOnce();
		const [filename, csv] = env.downloadCsv.mock.calls[0] as [string, string];
		expect(filename).toBe('meal-coverage-SH001-2026-11-09.csv');
		expect(csv.split('\r\n')).toHaveLength(2);
		expect(csv).toContain('"สมหญิง ใจดี"');
		expect(csv).not.toContain('สมชาย');
		expect(csv).toContain('"ยังไม่มีบันทึก"');

		search('ไม่มีใคร');
		expect(exportButton().disabled).toBe(true);
	});
});
