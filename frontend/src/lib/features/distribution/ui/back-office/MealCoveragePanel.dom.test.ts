// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import MealCoveragePanel from './MealCoveragePanel.svelte';

// The first mounts of this large panel pass 5s when the whole suite runs in parallel
// (the pre-push hook), though each takes well under a second alone.
vi.setConfig({ testTimeout: 20_000 });

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
	fromGetter: undefined as (() => string) | undefined,
	toGetter: undefined as (() => string) | undefined
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
// The real picker is a select plus a popover calendar; plain inputs stand in so a test can choose
// a preset or type the first and last day of a custom range.
vi.mock('./MealCoverageRangePicker.svelte', () => ({
	default: (
		anchor: Comment,
		props: {
			preset: string;
			customRange: { from: string; to: string } | undefined;
			today: string;
		}
	) => {
		const select = document.createElement('select');
		select.id = 'range-preset';
		for (const value of ['today', 'yesterday', '7d', '14d', '30d', 'custom']) {
			const option = document.createElement('option');
			option.value = value;
			option.textContent = value;
			select.append(option);
		}
		select.value = props.preset;
		select.addEventListener('change', () => (props.preset = select.value));
		const day = (id: string) => {
			const input = document.createElement('input');
			input.type = 'date';
			input.id = id;
			input.max = props.today;
			input.addEventListener('input', () => {
				const from = (document.getElementById('range-from') as HTMLInputElement).value;
				const to = (document.getElementById('range-to') as HTMLInputElement).value;
				props.customRange = { from, to };
				props.preset = 'custom';
			});
			return input;
		};
		anchor.before(select, day('range-from'), day('range-to'));
	}
}));
vi.mock('$lib/utils/download-csv', () => ({ downloadCsv: env.downloadCsv }));
vi.mock('../../application/queries', () => ({
	useDistributionLogsByRange: (
		_shelter: () => string | undefined,
		from: () => string,
		to: () => string
	) => {
		env.fromGetter = from;
		env.toGetter = to;
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
const log = (id: string, meal: string, by = 'staff1') => ({
	recipient_type: 'evacuee',
	recipient_id: id,
	meal,
	status: 'fulfilled',
	is_returnable: false,
	distributed_at: '2026-11-09T01:00:00Z',
	distributed_by: by,
	qty: '1'
});

let cmp: ReturnType<typeof mount> | undefined;
/** The panel opens on today; most cases are about a finished day, so they pick yesterday. */
function render(day: string | null = '2026-11-09') {
	cmp = mount(MealCoveragePanel, { target: document.body, props: { shelterCode: 'SH001' } });
	flushSync();
	if (day) typeDay(day);
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
/** Picks a range of days like the custom range picker: the first and last day typed in. */
function pickRange(from: string, to: string) {
	typeInto('#range-from', from);
	typeInto('#range-to', to);
}
const typeDay = (value: string) => pickRange(value, value);
function choosePreset(value: string) {
	const select = document.getElementById('range-preset') as HTMLSelectElement;
	select.value = value;
	select.dispatchEvent(new Event('change', { bubbles: true }));
	flushSync();
}
/** Picks a status in the table's filter menu, like a user opening it and choosing an option. */
function chooseStatus(label: string) {
	const trigger = document.getElementById('meal-coverage-status') as HTMLElement;
	trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
	trigger.click();
	flushSync();
	const option = Array.from(document.querySelectorAll('[role="option"]')).find(
		(o) => o.textContent?.trim() === label
	) as HTMLElement;
	for (const type of ['pointerdown', 'pointerup', 'click']) {
		option.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0 }));
	}
	flushSync();
}
const search = (value: string) => typeInto('input[type="search"]', value);
const bodyText = () => document.body.textContent ?? '';
const rowTexts = () =>
	Array.from(document.querySelectorAll('tbody tr')).map((tr) => tr.textContent ?? '');
const footerCells = (title: string) => {
	const heading = Array.from(document.querySelectorAll('[id^="ratio-card-"]')).find(
		(el) => el.textContent?.trim() === title
	);
	return Array.from(heading?.closest('[role="group"]')?.querySelectorAll('dl > div') ?? []).map(
		(el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim()
	);
};

const mealBadges = (row: Element) =>
	Array.from(row.querySelectorAll('li')).map((li) =>
		(li.textContent ?? '').replace(/\s+/g, ' ').trim()
	);

beforeEach(() => {
	// Thai today is 2026-11-10.
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
		expect(text).toContain('รับไม่ถึง 2 มื้อ/วัน จากผู้พักพิงในศูนย์ 2 คน');
		expect(rowTexts()).toHaveLength(2);
		expect(rowTexts()[0]).toContain('รับไม่ถึง 2 มื้อ · รับแล้ว 1/2 มื้อ');
		expect(rowTexts()[1]).toContain('สมหญิง');
		expect(rowTexts()[1]).toContain('รับ 2 มื้อขึ้นไป · 2/2 มื้อ');
		const row = document.querySelector('tbody tr') as Element;
		expect(mealBadges(row)).toEqual([
			'เช้า มีบันทึก',
			'กลางวัน ยังไม่มีบันทึก',
			'เย็น ยังไม่มีบันทึก'
		]);
	});

	it('shows how many residents have a record per meal and for 2 meals (#1257)', () => {
		env.evacuees.data = [person('evacuee:A', 'สมชาย'), person('evacuee:B', 'สมหญิง')];
		env.logs.data = {
			items: [
				log('evacuee:A', 'breakfast'),
				log('evacuee:B', 'breakfast'),
				log('evacuee:B', 'lunch')
			],
			skipped: []
		};
		render();
		expect(bodyText()).toContain('จากผู้ที่อยู่ในศูนย์ 2 คน');
		expect(footerCells('ผู้ที่มีบันทึกรับอาหาร')).toEqual([
			'เช้า 2/2 คน 100%',
			'กลางวัน 1/2 คน 50%',
			'เย็น 0/2 คน 0%',
			'รับ 2 มื้อขึ้นไป/วัน 1/2 คน 50%'
		]);
	});

	it('compares portions handed out with portions the kitchen made (#1257)', () => {
		env.evacuees.data = [person('evacuee:A', 'สมชาย'), person('evacuee:B', 'สมหญิง')];
		env.logs.data = {
			items: [
				log('evacuee:A', 'breakfast'),
				{ ...log('evacuee:B', 'breakfast'), qty: '2' },
				log('evacuee:B', 'lunch')
			],
			skipped: []
		};
		env.services.data = [
			{ ...service('ms:1', 'breakfast', '2026-11-09'), actual_yield: 6, served: 5 },
			{ ...service('ms:2', 'lunch', '2026-11-09'), served: 1 }
		];
		render();
		expect(footerCells('อาหารที่แจกแล้ว')).toEqual([
			'เช้า 3/6 ชุด 50%',
			'กลางวัน 1/1 ชุด 100%',
			'เย็น 0 ชุด ไม่มีบันทึกผลผลิตครัว'
		]);
	});

	it('shows a percent above 100 when more portions were handed out than the kitchen made', () => {
		env.evacuees.data = [person('evacuee:A', 'สมชาย')];
		env.logs.data = {
			items: [{ ...log('evacuee:A', 'breakfast'), qty: '3' }],
			skipped: []
		};
		env.services.data = [{ ...service('ms:1', 'breakfast', '2026-11-09'), actual_yield: 2 }];
		render();
		expect(footerCells('อาหารที่แจกแล้ว')[0]).toBe('เช้า 3/2 ชุด 150%');
	});

	it('still lists people when the kitchen data fails to load for a past day', () => {
		env.evacuees.data = [person('evacuee:A', 'สมชาย')];
		env.services = { data: [], isLoading: false, isError: true };
		render();
		expect(rowTexts()).toHaveLength(1);
		expect(footerCells('อาหารที่แจกแล้ว')[0]).toContain('ไม่มีบันทึกผลผลิตครัว');
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
		expect(text).toContain('ยังไม่มีบันทึก');
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

	it('asks for a range instead of listing everyone when the dates are cleared', () => {
		env.evacuees.data = [person('evacuee:A', 'สมชาย')];
		render();
		pickRange('', '');
		const text = bodyText();
		expect(text).toContain('เลือกช่วงวันที่');
		expect(text).not.toContain('สมชาย');
	});

	it('refuses a range that ends in the future, whose meals have not happened', () => {
		env.evacuees.data = [person('evacuee:A', 'สมชาย')];
		render();
		pickRange('2026-11-09', '2026-11-11');
		const text = bodyText();
		expect(text).toContain('เลือกช่วงวันที่');
		expect(text).not.toContain('สมชาย');
	});

	it('refuses a range whose start is after its end', () => {
		render();
		pickRange('2026-11-09', '2026-11-08');
		expect(bodyText()).toContain('เลือกช่วงวันที่');
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

	it('lets the range picker go up to today', () => {
		render();
		expect((document.getElementById('range-to') as HTMLInputElement).max).toBe('2026-11-10');
	});

	it('sorts the rows by name', () => {
		env.evacuees.data = [person('evacuee:B', 'ศศิ'), person('evacuee:A', 'กมล')];
		render();
		expect(rowTexts()[0]).toContain('กมล');
		expect(rowTexts()[1]).toContain('ศศิ');
	});

	it('opens on today and requests the logs of the range picked', () => {
		render(null);
		expect([env.fromGetter?.(), env.toGetter?.()]).toEqual(['2026-11-10', '2026-11-10']);
		pickRange('2026-11-03', '2026-11-05');
		expect([env.fromGetter?.(), env.toGetter?.()]).toEqual(['2026-11-03', '2026-11-05']);
	});

	it.each([
		['yesterday', '2026-11-09', '2026-11-09'],
		['7d', '2026-11-04', '2026-11-10'],
		['14d', '2026-10-28', '2026-11-10'],
		['30d', '2026-10-12', '2026-11-10']
	])('requests the logs of the %s preset', (preset, from, to) => {
		render(null);
		choosePreset(preset);
		expect([env.fromGetter?.(), env.toGetter?.()]).toEqual([from, to]);
	});

	describe('paging, filtering and search', () => {
		const names = (n: number) =>
			Array.from({ length: n }, (_, i) =>
				person(`evacuee:${i}`, `ชื่อ${String(i).padStart(2, '0')}`)
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

		it('filters to people with no record from the status menu', () => {
			env.evacuees.data = [person('evacuee:A', 'สมชาย'), person('evacuee:B', 'สมหญิง')];
			env.logs.data = { items: [log('evacuee:B', 'lunch')], skipped: [] };
			render();
			expect(rowTexts()).toHaveLength(2);
			chooseStatus('ยังไม่มีบันทึกรับ');
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

	it('with no meal served yet, still judges against 2 meals and says today is not over', () => {
		render();
		typeDay('2026-11-10');
		const text = (document.body.textContent ?? '').replace(/\s+/g, ' ');
		expect(text).toContain('วันนี้ยังไม่ได้แจกมื้อใด · ตัวเลขของวันนี้จะเริ่มนับเมื่อแจกมื้อเช้า');
		expect(rowTexts()).toHaveLength(2);
		expect(rowTexts()[0]).toContain('รับไม่ถึง 2 มื้อ · ยังไม่มีบันทึกรับ');
		expect(text).not.toContain('0 มื้อ');
		for (const title of ['ภาพรวมการรับอาหาร', 'ความครบรายโซน', 'ผู้แจกอาหาร', 'อาหารที่แจกแล้ว']) {
			expect(text).toContain(title);
		}
	});

	it('with only breakfast served, nobody reaches 2 yet and the bar names the served meal', () => {
		env.services.data = [service('ms:1', 'breakfast')];
		env.logs.data = { items: [todayLog('evacuee:A', 'breakfast')], skipped: [] };
		render();
		typeDay('2026-11-10');
		expect(document.body.textContent).toContain(
			'วันนี้แจกแล้ว 1 จาก 3 มื้อ (เช้า) · ยังไม่มีใครรับครบ 2 มื้อได้จนกว่าจะแจกมื้อกลางวัน'
		);
		expect(rowTexts()).toHaveLength(2);
		expect(rowTexts()[0]).toContain('สมหญิง');
		expect(rowTexts()[0]).toContain('รับไม่ถึง 2 มื้อ · ยังไม่มีบันทึกรับ');
		expect(rowTexts()[0]).toContain('ยังไม่ถึงมื้อ');
		expect(rowTexts()[1]).toContain('สมชาย');
		expect(rowTexts()[1]).toContain('รับไม่ถึง 2 มื้อ · รับแล้ว 1/2 มื้อ');
	});

	it('shows a meal that is not served yet as a short chip, with the reason for screen readers', () => {
		env.services.data = [service('ms:1', 'breakfast')];
		render();
		typeDay('2026-11-10');
		const chips = Array.from(
			(document.querySelector('tbody tr') as Element).querySelectorAll('li[title]')
		);
		expect(chips.map((c) => c.getAttribute('title'))).toEqual(['ยังไม่ถึงมื้อ', 'ยังไม่ถึงมื้อ']);
		const visible = (c: Element) =>
			Array.from(c.childNodes)
				.filter((n) => !(n instanceof HTMLElement && n.classList.contains('sr-only')))
				.map((n) => n.textContent ?? '')
				.join('')
				.trim();
		expect(chips.map(visible)).toEqual(['กลางวัน', 'เย็น']);
		expect(chips[0].querySelector('.sr-only')?.textContent).toContain('ยังไม่ถึงมื้อ');
		expect(chips[0].parentElement?.className).toContain('flex-wrap');
	});

	it('shows no today note once all three meals are served', () => {
		env.services.data = [
			service('ms:1', 'breakfast'),
			service('ms:2', 'lunch'),
			service('ms:3', 'dinner')
		];
		render();
		typeDay('2026-11-10');
		expect(bodyText()).not.toContain('วันนี้แจกแล้ว');
		expect(bodyText()).not.toContain('วันนี้ยังไม่ได้แจกมื้อใด');
	});

	it('keeps the count of a meal that is not over yet next to the pending note', () => {
		env.services.data = [service('ms:1', 'breakfast')];
		env.logs.data = {
			items: [todayLog('evacuee:A', 'breakfast'), todayLog('evacuee:B', 'lunch')],
			skipped: []
		};
		render();
		typeDay('2026-11-10');
		expect(bodyText()).toContain('ยังไม่ถึงมื้อ · มีบันทึก 1 คน');
	});

	it('does not count a meal_service whose receipt was rejected', () => {
		env.services.data = [service('ms:1', 'breakfast'), service('ms:2', 'lunch')];
		env.receipts.data = [
			{ meal_service_id: 'ms:1', outcome: 'rejected', created_at: '2026-11-10T03:00:00Z' }
		];
		render();
		typeDay('2026-11-10');
		const text = document.body.textContent ?? '';
		expect(text).toContain('วันนี้แจกแล้ว 1 จาก 3 มื้อ (กลางวัน)');
		expect(text).not.toContain('3 มื้อ (เช้า)');
	});

	it('keeps the one-meal group and the 2-meal target when a single meal is served', () => {
		env.services.data = [service('ms:1', 'breakfast')];
		render();
		typeDay('2026-11-10');
		const text = document.body.textContent ?? '';
		expect(text).toContain('รายชื่อผู้พักพิงและบันทึกรับอาหาร');
		expect(text).toContain('รับแค่ 1 มื้อ');
		expect(text).toContain('ยังไม่มีบันทึกรับ');
		expect(text).toContain('รับไม่ถึง 2 มื้อ/วัน');
		expect(text).not.toContain('ยังไม่ถึง 1 มื้อ');
		expect(text).not.toContain('ดูเกณฑ์ครบ');
	});

	it('words the table subtitle and the first card the same for today and past days', () => {
		env.services.data = [service('ms:1', 'breakfast')];
		render();
		typeDay('2026-11-10');
		for (const day of ['2026-11-09', '2026-11-10']) {
			typeDay(day);
			expect(bodyText()).toContain('นับมื้อเช้า กลางวัน เย็น ของผู้พักพิงที่อยู่ในศูนย์ทั้งวัน');
			expect(bodyText()).toContain('ผู้พักพิงในศูนย์');
			expect(bodyText()).toContain('อยู่ในศูนย์ทั้งวัน');
		}
	});

	it('keeps the two-meal rule once two meals are served', () => {
		env.services.data = [service('ms:1', 'breakfast'), service('ms:2', 'lunch')];
		env.logs.data = { items: [todayLog('evacuee:A', 'breakfast')], skipped: [] };
		render();
		typeDay('2026-11-10');
		expect(document.body.textContent).toContain('รับ 2 มื้อขึ้นไป/วัน');
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
		expect(rowTexts()).toHaveLength(2);
		expect(rowTexts()[0]).toContain('สมชาย');
		expect(rowTexts()[0]).toContain('ยังไม่มีบันทึก');
		expect(rowTexts()[0]).toContain('ครัวเรือนมีบันทึกรับ: กลางวัน, เย็น');
	});

	it('advises that an unscanned meal may have been handed out without scanning', () => {
		env.evacuees.data = [person('evacuee:A', 'สมชาย')];
		env.logs.data = {
			items: [log('evacuee:A', 'breakfast'), log('evacuee:A', 'lunch')],
			skipped: []
		};
		const text = render();
		expect(text).toContain('ไม่มีบันทึกการแจกมื้อเย็นของวันที่เลือกเลย');
		expect(text).not.toContain('ไม่มีบันทึกการแจกมื้อเช้า');
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
		expect(text).not.toContain('ไม่มีบันทึกการแจกมื้อ');
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
		expect(csv).toContain('"รับไม่ถึง 2 มื้อ · ยังไม่มีบันทึกรับ"');

		search('ไม่มีใคร');
		expect(exportButton().disabled).toBe(true);
	});
});

describe('MealCoveragePanel overview and roster', () => {
	const tile = (label: string) =>
		Array.from(document.querySelectorAll('[data-card]')).find((b) =>
			b.textContent?.includes(label)
		) as HTMLElement;
	const tileText = (label: string) => (tile(label).textContent ?? '').replace(/\s+/g, ' ').trim();
	const cells = (tr: Element) =>
		Array.from(tr.querySelectorAll('td')).map((td) =>
			(td.textContent ?? '').replace(/\s+/g, ' ').trim()
		);

	beforeEach(() => {
		env.evacuees.data = [
			person('evacuee:A', 'กนก'),
			person('evacuee:B', 'ขวัญ'),
			person('evacuee:C', 'คม'),
			person('evacuee:D', 'งาม')
		];
		env.logs.data = {
			items: [
				log('evacuee:A', 'breakfast', 'amy'),
				log('evacuee:A', 'lunch', 'zed'),
				log('evacuee:A', 'dinner', 'amy'),
				log('evacuee:B', 'lunch', 'bob'),
				{ ...log('evacuee:B', 'dinner', 'voider'), status: 'voided' },
				log('evacuee:C', 'breakfast', 'cat'),
				log('evacuee:C', 'dinner', 'dan')
			],
			skipped: []
		};
	});

	it('shows four cards: the headcount, 2 meals or more, one meal, no record', () => {
		render();
		expect(tileText('ผู้พักพิงในศูนย์')).toContain('4');
		expect(tileText('ผู้พักพิงในศูนย์')).toContain('อยู่ในศูนย์ทั้งวัน');
		expect(tileText('ผู้พักพิงในศูนย์')).not.toContain('ไม่รวมผู้อยู่ไม่เต็มวัน');
		expect(tileText('รับ 2 มื้อขึ้นไป/วัน')).toContain('2');
		expect(tileText('รับ 2 มื้อขึ้นไป/วัน')).toContain('50% ของผู้พักพิง');
		expect(tileText('รับแค่ 1 มื้อ')).toBe('รับแค่ 1 มื้อ 1 ขาดอีก 1 มื้อ · 25%');
		expect(tileText('ยังไม่มีบันทึกรับ')).toBe('ยังไม่มีบันทึกรับ 1 ขาด 2 มื้อ · 25%');
	});

	it('shows how many people there only part of the day are left out of the headcount', () => {
		env.evacuees.data = [
			person('evacuee:A', 'สมชาย'),
			{
				...person('evacuee:C', 'ปราณี'),
				current_stay: { status: 'active', since: '2026-11-09T03:00:00Z' }
			}
		];
		render();
		expect(tileText('ผู้พักพิงในศูนย์')).toBe(
			'ผู้พักพิงในศูนย์ 1 อยู่ในศูนย์ทั้งวัน ไม่รวมผู้อยู่ไม่เต็มวัน 1 คน'
		);
	});

	it('words the cards for a range without contradicting the titles', () => {
		env.logs.data = {
			items: [log('evacuee:A', 'breakfast'), log('evacuee:A', 'lunch')],
			skipped: []
		};
		render(null);
		choosePreset('7d');
		expect(tileText('ผู้พักพิงในช่วงนี้')).toBe(
			'ผู้พักพิงในช่วงนี้ 4 อยู่ในศูนย์ทั้งวันอย่างน้อย 1 วัน'
		);
		expect(tileText('รับ 2 มื้อขึ้นไปทุกวัน')).toContain('0% ของผู้พักพิง');
		expect(tileText('รับไม่ถึง 2 มื้อบางวัน')).toContain('มีวันที่รับ 0–1 มื้อ · ');
		expect(tileText('ไม่มีบันทึกรับทั้งช่วง')).not.toContain('รับไม่ถึง');
		expect(tileText('ไม่มีบันทึกรับทั้งช่วง')).toContain('% ของผู้พักพิง');
	});

	it('has plain cards: no buttons, nothing pressed, and a click changes nothing', () => {
		render();
		const cards = Array.from(document.querySelectorAll('[data-card]'));
		expect(cards).toHaveLength(4);
		for (const c of cards) {
			expect(c.tagName).not.toBe('BUTTON');
			expect(c.hasAttribute('aria-pressed')).toBe(false);
			expect(c.className).not.toMatch(/cursor-pointer|hover:/);
		}
		click(tile('ยังไม่มีบันทึกรับ'));
		expect(rowTexts()).toHaveLength(4);
		expect(document.querySelector('[data-active-filters]')).toBeNull();
	});

	it('has a plain gauge legend and zone rows: nothing to press or hover', () => {
		env.evacuees.data = [
			{
				...person('evacuee:A', 'สมชาย'),
				current_stay: { status: 'active', since: '2026-11-01T00:00:00Z', zone: 'Z1' }
			}
		];
		render();
		expect(document.querySelectorAll('li[data-status] button')).toHaveLength(0);
		const zoneRow = Array.from(document.querySelectorAll('li')).find((li) =>
			li.textContent?.includes('Z1')
		) as HTMLElement;
		expect(zoneRow.querySelector('button')).toBeNull();
		expect(zoneRow.className).not.toMatch(/hover:|bg-slate-100|cursor-pointer/);
		expect(document.querySelector('[aria-live]')).toBeNull();
	});

	it('words the zone card: share of people with 2 meals or more per zone', () => {
		env.evacuees.data = [
			{
				...person('evacuee:A', 'สมชาย'),
				current_stay: { status: 'active', since: '2026-11-01T00:00:00Z', zone: 'Z1' }
			}
		];
		env.logs.data = {
			items: [log('evacuee:A', 'breakfast'), log('evacuee:A', 'lunch')],
			skipped: []
		};
		render();
		const text = bodyText().replace(/\s+/g, ' ');
		expect(text).toContain('สัดส่วนคนที่รับ 2 มื้อขึ้นไป แยกตามโซน · โซนที่ต้องดูแลก่อนอยู่บนสุด');
		expect(text).toContain('รับไปแล้ว 1 จาก 1 คน');
		choosePreset('7d');
		expect(bodyText().replace(/\s+/g, ' ')).toContain('รับไปแล้ว');
	});

	it('writes the gauge legend so colour is not the only signal', () => {
		render();
		const text = bodyText().replace(/\s+/g, ' ');
		expect(text).toContain('รับ 2 มื้อขึ้นไป/วัน 2 คน 50%');
		expect(text).toContain('รับแค่ 1 มื้อ 1 คน 25%');
		expect(text).toContain('ยังไม่มีบันทึกรับ 1 คน 25%');
	});

	it('filters to the people who got 2 meals or more from the status menu', () => {
		render();
		chooseStatus('รับ 2 มื้อขึ้นไป/วัน');
		expect(rowTexts()).toHaveLength(2);
		expect(rowTexts().every((t) => t.includes('รับ 2 มื้อขึ้นไป · 2/2 มื้อ'))).toBe(true);
	});

	it('calls out how many people are under 2 meals, as information only', () => {
		render();
		const text = bodyText();
		expect(text).toContain('2 คน');
		expect(text).toContain('รับไม่ถึง 2 มื้อ/วัน จากผู้พักพิงในศูนย์ 4 คน');
		expect(text).not.toContain('ดูเฉพาะรายชื่อนี้');
		expect(text).not.toContain('ดูทุกคน');
	});

	it('filters to the no-record and the one-meal groups from the status menu', () => {
		render();
		chooseStatus('ยังไม่มีบันทึกรับ');
		expect(rowTexts()).toHaveLength(1);
		expect(rowTexts()[0]).toContain('งาม');
		chooseStatus('รับแค่ 1 มื้อ');
		expect(rowTexts()).toHaveLength(1);
		expect(rowTexts()[0]).toContain('ขวัญ');
	});

	it('orders none, then partial, then complete by name', () => {
		render();
		const names = rowTexts().map((t) => ['งาม', 'ขวัญ', 'กนก', 'คม'].find((n) => t.includes(n)));
		expect(names).toEqual(['งาม', 'ขวัญ', 'กนก', 'คม']);
	});

	it('shows who handed the meals out, distinct and without voided logs', () => {
		render();
		const header = Array.from(document.querySelectorAll('thead th')).map((th) =>
			th.textContent?.trim()
		);
		expect(header).toEqual(['ชื่อ', 'โซน', 'มื้ออาหาร', 'ผู้แจก', 'สถานะ']);
		const byName = Object.fromEntries(
			Array.from(document.querySelectorAll('tbody tr')).map((tr) => {
				const c = cells(tr);
				return [c[0], c[3]];
			})
		);
		expect(byName['กนก ใจดี']).toBe('amy, zed');
		expect(byName['ขวัญ ใจดี']).toBe('bob');
		expect(byName['งาม ใจดี']).toBe('–');
	});

	it('exports the ผู้แจก column for the rows that match the filter', () => {
		render();
		chooseStatus('รับ 2 มื้อขึ้นไป/วัน');
		click(
			Array.from(document.querySelectorAll('button')).find((b) =>
				b.textContent?.includes('ส่งออก CSV')
			)
		);
		const [, csv] = env.downloadCsv.mock.calls[0] as [string, string];
		const lines = csv.split('\r\n');
		expect(lines).toHaveLength(3);
		expect(lines[0]).toContain('"ผู้แจก"');
		expect(lines[1]).toContain('"amy, zed"');
		expect(csv).not.toContain('งาม');
	});
});

describe('MealCoveragePanel over a range, partial days and other recipients', () => {
	const flat = () => bodyText().replace(/\s+/g, ' ');
	const outside = (meal: string, qty = '1', at = '2026-11-09T02:00:00Z') => ({
		...log('', meal),
		recipient_type: 'outside',
		recipient_id: null,
		distributed_at: at,
		qty
	});
	const headers = () =>
		Array.from(document.querySelectorAll('thead th')).map((th) => th.textContent?.trim());
	const cells = (tr: Element) =>
		Array.from(tr.querySelectorAll('td')).map((td) =>
			(td.textContent ?? '').replace(/\s+/g, ' ').trim()
		);

	beforeEach(() => {
		env.evacuees.data = [person('evacuee:A', 'สมชาย')];
	});

	it('counts the days under 2 meals and the meals received for each person over 7 days', () => {
		// 4-9 Nov are finished days; 10 Nov is today with no meal served yet and is judged too: 6 of 7 days are short.
		env.logs.data = {
			items: [log('evacuee:A', 'breakfast', 'amy'), log('evacuee:A', 'lunch', 'bob')],
			skipped: []
		};
		render(null);
		choosePreset('7d');
		expect(headers()).toEqual([
			'ชื่อ',
			'โซน',
			'มื้อที่ได้รับ',
			'จำนวนวันที่ไม่ถึง 2 มื้อ',
			'ผู้แจก',
			'สถานะ'
		]);
		expect(rowTexts()).toHaveLength(1);
		expect(cells(document.querySelector('tbody tr') as Element)).toEqual([
			'สมชาย ใจดี',
			'',
			'2 มื้อ',
			'6 / 7 วัน',
			'amy, bob',
			'รับไม่ถึง 2 มื้อบางวัน 6/7 วัน'
		]);
	});

	it('keeps one column per meal when the range is a single day', () => {
		render();
		expect(headers()).toEqual(['ชื่อ', 'โซน', 'มื้ออาหาร', 'ผู้แจก', 'สถานะ']);
	});

	it('adds up the portions handed out over every day of the range', () => {
		env.logs.data = {
			items: [
				{ ...log('evacuee:A', 'breakfast'), qty: '2', distributed_at: '2026-11-08T01:00:00Z' },
				{ ...log('evacuee:A', 'breakfast'), qty: '3' }
			],
			skipped: []
		};
		render(null);
		choosePreset('7d');
		expect(footerCells('อาหารที่แจกแล้ว')[0]).toContain('5 ชุด');
	});

	it('shows the daily trend chart for a range but not for a single day', () => {
		env.logs.data = { items: [log('evacuee:A', 'breakfast')], skipped: [] };
		render();
		expect(flat()).not.toContain('แนวโน้มรายวัน');
		choosePreset('7d');
		expect(flat()).toContain('แนวโน้มรายวัน');
	});

	it('lists someone there only part of the day with a badge, never as under 2 meals', () => {
		const arrived = {
			...person('evacuee:C', 'ปราณี'),
			current_stay: { status: 'active', since: '2026-11-09T03:00:00Z' }
		};
		env.evacuees.data = [person('evacuee:A', 'สมชาย'), arrived];
		env.logs.data = {
			items: [log('evacuee:A', 'breakfast'), log('evacuee:C', 'breakfast')],
			skipped: []
		};
		render();
		const partRow = rowTexts().find((t) => t.includes('ปราณี')) ?? '';
		expect(partRow).toContain('อยู่ในศูนย์ไม่เต็มวัน');
		expect(partRow).not.toContain('รับไม่ถึง 2 มื้อ');
		// Under the bar: only the one judged person is counted as short.
		expect(flat()).toContain('รับไม่ถึง 2 มื้อ/วัน จากผู้พักพิงในศูนย์ 1 คน');
		// Their breakfast counts toward the people per meal, their missing lunch does not.
		expect(footerCells('ผู้ที่มีบันทึกรับอาหาร').slice(0, 2)).toEqual([
			'เช้า 2/2 คน 100%',
			'กลางวัน 0/1 คน 0%'
		]);
	});

	it('shows outside, volunteer and staff hand-overs as their own lines, not as table rows', () => {
		env.logs.data = {
			items: [
				log('evacuee:A', 'breakfast'),
				outside('breakfast', '2'),
				{ ...log('', 'lunch'), recipient_type: 'volunteer', recipient_id: 'volunteer:V' },
				{ ...log('', 'dinner'), recipient_type: 'staff', recipient_id: 'user:s' }
			],
			skipped: []
		};
		render();
		const stat = (label: string) =>
			Array.from(
				document.querySelectorAll('#meal-coverage-others-title ~ ul > li, section ul > li')
			)
				.find((li) => li.querySelector('p')?.textContent?.trim().startsWith(label))
				?.textContent?.replace(/\s+/g, ' ')
				.trim();
		expect(stat('บุคคลภายนอก')).toContain('2 ชุด');
		expect(stat('บุคคลภายนอก')).toContain('เช้า 2 ชุด');
		expect(stat('บุคคลภายนอก')).toContain('กลางวัน 0 ชุด');
		expect(stat('จิตอาสา')).toContain('1 ชุด');
		expect(stat('จิตอาสา')).toContain('กลางวัน 1 ชุด');
		expect(stat('เจ้าหน้าที่')).toContain('เย็น 1 ชุด');
		expect(bodyText()).not.toMatch(/ครั้ง|รายการ/);
		expect(rowTexts()).toHaveLength(1);
		// The portions card still counts them: 1 evacuee portion + 2 outside.
		expect(footerCells('อาหารที่แจกแล้ว')[0]).toContain('3 ชุด');
	});

	it('does not warn about a meal that was handed out only to people outside the list', () => {
		env.logs.data = {
			items: [log('evacuee:A', 'breakfast'), outside('lunch'), outside('dinner')],
			skipped: []
		};
		expect(render()).not.toContain('ไม่มีบันทึกการแจกมื้อ');
	});

	it('names the day and the meal of each unscanned meal over a range', () => {
		env.logs.data = {
			items: [
				log('evacuee:A', 'breakfast'),
				log('evacuee:A', 'lunch'),
				log('evacuee:A', 'dinner'),
				{ ...log('evacuee:A', 'breakfast'), distributed_at: '2026-11-08T01:00:00Z' }
			],
			skipped: []
		};
		render(null);
		choosePreset('7d');
		const text = flat();
		expect(text).toContain('มื้อที่ให้บริการแต่ไม่มีบันทึกการแจกเลยในวันนั้น');
		expect(text).toMatch(/8 พ\.ย\.: กลางวัน, เย็น/);
		expect(text).toMatch(/7 พ\.ย\.: เช้า, กลางวัน, เย็น/);
	});

	it('keeps all three recipient cards, muted at 0 ชุด, when nobody outside the list was served', () => {
		render();
		const text = flat();
		for (const label of ['บุคคลภายนอก', 'จิตอาสา', 'เจ้าหน้าที่']) expect(text).toContain(label);
		expect(text).toContain('นับแยกจากรายชื่อผู้พักพิง แต่รวมอยู่ในจำนวนชุดที่แจก');
		expect(text.match(/\b0 ชุด/g)?.length).toBeGreaterThanOrEqual(3);
	});

	it('keeps the whole dashboard with zeros and says why when nothing happened in the range', () => {
		env.evacuees.data = [];
		const text = render(null) && flat();
		choosePreset('7d');
		const after = flat();
		expect(text).not.toContain('เลือกช่วงวันที่');
		for (const title of [
			'ภาพรวมการรับอาหาร',
			'ความครบรายโซน',
			'ผู้แจกอาหาร',
			'อาหารที่แจกแล้ว',
			'ผู้ที่มีบันทึกรับอาหาร',
			'แนวโน้มรายวัน'
		]) {
			expect(after).toContain(title);
		}
		expect(after).toContain('ไม่มีผู้ที่อยู่ในศูนย์ตลอดทั้งวันในช่วงนี้');
		// the bar at the top plus the distributor, portions and trend cards
		expect(after.split('ไม่มีการแจกจ่ายในช่วงนี้').length - 1).toBeGreaterThanOrEqual(4);
		expect(after).toContain('ไม่มีผู้พักพิงที่อยู่ในศูนย์ในช่วงนี้');
		expect(document.querySelectorAll('button[aria-pressed]').length).toBeGreaterThan(0);
	});

	it('describes the report in one short line and keeps the residents-only note for the table', () => {
		const text = render();
		expect(text).toContain('นับจากบันทึกการแจกทุกช่องทาง (สแกน QR, ค้นชื่อ, บุคคลภายนอก)');
		expect(flat()).toContain('รายชื่อนับเฉพาะผู้พักพิง');
		expect(text).not.toContain('มื้อที่แจกโดยไม่สแกนจะไม่ถูกนับ');
	});

	it('titles the page for any range and writes the selected range under the title', () => {
		render(null);
		expect(flat()).toContain('ภาพรวมการแจกจ่ายอาหาร 10 พ.ย. 2569');
		choosePreset('7d');
		expect(flat()).toContain('ภาพรวมการแจกจ่ายอาหาร 4–10 พ.ย. 2569');
		expect(flat()).not.toContain('การรับอาหารประจำวัน');
	});

	it('puts that today is not over and why cards are empty in one bar', () => {
		env.services.data = [service('ms:1', 'breakfast')];
		render(null);
		const bars = document.querySelectorAll('[role="status"]');
		const infoBars = Array.from(bars).filter((b) =>
			b.textContent?.includes('วันนี้แจกแล้ว 1 จาก 3')
		);
		expect(infoBars).toHaveLength(1);
		expect(infoBars[0].textContent).toContain('ไม่มีการแจกจ่ายในช่วงนี้');
	});

	it('has no second line about today when no meal is served: one bar only', () => {
		render(null);
		expect(flat()).not.toContain('วันนี้นับเฉพาะมื้อที่ให้บริการแล้ว');
		expect(flat()).not.toContain('ยังไม่มีมื้อที่ให้บริการวันนี้');
		const bars = Array.from(document.querySelectorAll('[role="status"]')).filter((b) =>
			b.textContent?.includes('วันนี้ยังไม่ได้แจกมื้อใด')
		);
		expect(bars).toHaveLength(1);
	});

	it('exports the range with the new columns and a range file name', () => {
		env.logs.data = { items: [log('evacuee:A', 'breakfast')], skipped: [] };
		render(null);
		choosePreset('7d');
		click(
			Array.from(document.querySelectorAll('button')).find((b) =>
				b.textContent?.includes('ส่งออก CSV')
			)
		);
		const [filename, csv] = env.downloadCsv.mock.calls[0] as [string, string];
		expect(filename).toBe('meal-coverage-SH001-2026-11-04_2026-11-10.csv');
		const [header, line] = csv.split('\r\n');
		expect(header).toContain('"จำนวนวันที่ไม่ถึง 2 มื้อ"');
		expect(line.endsWith('"รับไม่ถึง 2 มื้อบางวัน 7/7 วัน","","1","7","0"')).toBe(true);
	});
});

describe('MealCoveragePanel filters and tiles are the same on every day', () => {
	const tileLabels = () =>
		Array.from(document.querySelectorAll('[data-card]'))
			.filter((b) => b.hasAttribute('data-card'))
			.map((b) => (b.textContent ?? '').replace(/\s+/g, ' ').trim());
	const optionLabels = () => {
		const trigger = document.getElementById('meal-coverage-status') as HTMLElement;
		trigger.dispatchEvent(
			new MouseEvent('pointerdown', { bubbles: true, button: 0, ctrlKey: false })
		);
		trigger.click();
		flushSync();
		return Array.from(document.querySelectorAll('[role="option"]')).map((o) =>
			(o.textContent ?? '').trim()
		);
	};
	const FIXED = [
		'ทั้งหมด',
		'รับ 2 มื้อขึ้นไป/วัน',
		'รับไม่ถึง 2 มื้อ/วัน',
		'รับแค่ 1 มื้อ',
		'ยังไม่มีบันทึกรับ',
		'อยู่ในศูนย์ไม่เต็มวัน (ไม่นับเกณฑ์)'
	];

	beforeEach(() => {
		env.evacuees.data = [person('evacuee:A', 'สมชาย')];
	});

	it.each([
		['a finished day', '2026-11-09'],
		['today with nothing served', '2026-11-10']
	])('shows the same four cards on %s', (_name, day) => {
		render(day);
		expect(tileLabels()).toHaveLength(4);
		const expected = [
			'ผู้พักพิงในศูนย์',
			'รับ 2 มื้อขึ้นไป/วัน',
			'รับแค่ 1 มื้อ',
			'ยังไม่มีบันทึกรับ'
		];
		tileLabels().forEach((text, i) => expect(text).toContain(expected[i]));
	});

	it('shows the same filter options for a day, today and a range', () => {
		render();
		expect(optionLabels()).toEqual(FIXED);
	});

	it('has no helper text under the status filter', () => {
		render(null);
		expect(bodyText()).not.toContain('จึงยังไม่ตัดสินเกณฑ์');
	});
});
