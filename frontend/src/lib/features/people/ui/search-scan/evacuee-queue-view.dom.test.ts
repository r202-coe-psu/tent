// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { langState } from '$lib/states/i18n.svelte';
import type { Evacuee } from '../../domain/people';
import EvacueeQueueView from './evacuee-queue-view.svelte';

const data = vi.hoisted(() => ({
	evacuees: [] as unknown[],
	households: [] as unknown[],
	screenings: [] as unknown[]
}));

vi.mock('../../application/queries', () => ({
	useEvacuees: () => ({ data: data.evacuees, isPending: false }),
	useHouseholds: () => ({ data: data.households, isPending: false }),
	useScreenings: () => ({ data: data.screenings, isPending: false })
}));
vi.mock('$lib/features/master-data', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/master-data')>()),
	useMasterData: () => ({ data: { items: [] } })
}));
vi.mock('$lib/features/shelters', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/shelters')>()),
	useShelter: () => ({ data: { zones: [] } })
}));
vi.mock('$lib/db/shelter', () => ({ getShelterCode: () => 'SH001' }));

let instance: ReturnType<typeof mount> | null = null;

async function settle() {
	for (let i = 0; i < 3; i++) {
		flushSync();
		await tick();
	}
}

type Callbacks = {
	onOpenRow: (e: Evacuee) => void;
	onReportIn: (e: Evacuee) => void;
	onProfile: (e: Evacuee) => void;
	onGoMedical: (e: Evacuee) => void;
	onGoZoning: (e: Evacuee) => void;
};

function callbacks(): Callbacks {
	return {
		onOpenRow: vi.fn(),
		onReportIn: vi.fn(),
		onProfile: vi.fn(),
		onGoMedical: vi.fn(),
		onGoZoning: vi.fn()
	};
}

async function render(
	props: Callbacks & {
		initialTab?: 'all' | 'pre_registered' | 'arriving';
		enableMedical?: boolean;
		canMedical?: boolean;
		canZoning?: boolean;
	}
) {
	instance = mount(EvacueeQueueView, { target: document.body, props });
	await settle();
}

const cards = () =>
	Array.from(document.querySelectorAll<HTMLElement>('[data-testid="queue-card"]'));
const button = (root: HTMLElement, name: string) =>
	Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.includes(name));

const PRE_REG = {
	_id: 'evacuee:SH001:0001',
	type: 'evacuee',
	first_name: 'สมหญิง',
	last_name: 'ศรีสุวรรณพิทักษ์',
	nickname: 'หญิง',
	person_id: { number: '1234567890123' },
	registered_via: 'web',
	phone: '0812345678',
	household_id: 'household:SH001:0001',
	special_needs: ['elderly'],
	updated_at: '2026-11-04T02:10:00.000Z',
	current_stay: { status: 'pre_registered' }
};

afterEach(async () => {
	if (instance) unmount(instance);
	instance = null;
	langState.current = 'th';
	data.evacuees = [];
	data.households = [];
	data.screenings = [];
	await new Promise((resolve) => setTimeout(resolve, 50));
	document.body.innerHTML = '';
});

describe('EvacueeQueueView mobile cards', () => {
	it('pre-registered tab: a card shows every column and both row actions', async () => {
		data.evacuees = [PRE_REG];
		data.households = [{ _id: 'household:SH001:0001', label: 'ครอบครัวศรีสุวรรณพิทักษ์' }];
		const cb = callbacks();
		await render({ ...cb, initialTab: 'pre_registered' });

		expect(cards()).toHaveLength(1);
		const card = cards()[0];
		const text = card.textContent ?? '';
		expect(text).toContain('สมหญิง ศรีสุวรรณพิทักษ์');
		expect(text).toContain('(หญิง)');
		expect(text).toContain('เลขที่เอกสาร');
		expect(text).toContain('123***123');
		expect(text).toContain('ออนไลน์ Web');
		expect(text).toContain('0812345678');
		expect(text).toContain('ครอบครัวศรีสุวรรณพิทักษ์');
		expect(text).toContain('elderly');
		expect(text).toContain('ลงทะเบียนล่วงหน้า');

		button(card, 'ดูโปรไฟล์')!.click();
		expect(cb.onProfile).toHaveBeenCalledWith(PRE_REG);
		button(card, 'รับรายงานตัว')!.click();
		expect(cb.onReportIn).toHaveBeenCalledWith(PRE_REG);
		button(card, 'สมหญิง')!.click();
		expect(cb.onOpenRow).toHaveBeenCalledWith(PRE_REG);
	});

	it('arriving tab with medical on: cards show screening state and the gated actions', async () => {
		const unscreened = {
			...PRE_REG,
			_id: 'evacuee:SH001:0002',
			first_name: 'ประสิทธิ์ชัย',
			last_name: 'วงศ์สกุลเจริญรุ่งเรือง',
			person_id: { number: '9876543210987' },
			household_id: null,
			updated_at: '2026-11-04T03:00:00.000Z',
			current_stay: { status: 'arriving' }
		};
		const screened = {
			...unscreened,
			_id: 'evacuee:SH001:0003',
			first_name: 'วันเพ็ญ',
			last_name: 'แสงจันทร์',
			household_id: 'household:SH001:0001',
			updated_at: '2026-11-04T02:00:00.000Z'
		};
		data.evacuees = [unscreened, screened];
		data.households = [{ _id: 'household:SH001:0001', label: 'ครอบครัวแสงจันทร์' }];
		data.screenings = [{ evacuee_id: 'evacuee:SH001:0003', triage_level: 'yellow' }];
		const cb = callbacks();
		await render({
			...cb,
			initialTab: 'arriving',
			enableMedical: true,
			canMedical: true,
			canZoning: true
		});

		expect(cards()).toHaveLength(2);
		const [first, second] = cards();

		// Unscreened: awaiting doctor -> screening + profile, no zoning yet.
		const firstText = first.textContent ?? '';
		expect(firstText).toContain('ประสิทธิ์ชัย วงศ์สกุลเจริญรุ่งเรือง');
		expect(firstText).toContain('987***987');
		expect(firstText).toContain('การแพทย์');
		expect(firstText).toContain('รอตรวจคัดกรอง');
		expect(firstText).toContain('คิวถัดไป');
		expect(firstText).toContain('รอแพทย์');
		expect(firstText).toContain('—');
		expect(button(first, 'คัดกรอง (S2)')).toBeTruthy();
		expect(button(first, 'จัดโซน (S3)')).toBeUndefined();
		button(first, 'คัดกรอง (S2)')!.click();
		expect(cb.onGoMedical).toHaveBeenCalledWith(unscreened);
		button(first, 'ดูโปรไฟล์')!.click();
		expect(cb.onProfile).toHaveBeenCalledWith(unscreened);

		// Screened: triage shown, awaiting zone -> zoning + profile, no screening.
		const secondText = second.textContent ?? '';
		expect(secondText).toContain('วันเพ็ญ แสงจันทร์');
		expect(secondText).toContain('ครอบครัวแสงจันทร์');
		expect(secondText).toContain('ตรวจแล้ว');
		expect(secondText).toContain('(เหลือง)');
		expect(secondText).toContain('รอโซน');
		expect(button(second, 'คัดกรอง (S2)')).toBeUndefined();
		button(second, 'จัดโซน (S3)')!.click();
		expect(cb.onGoZoning).toHaveBeenCalledWith(screened);
		expect(button(second, 'ดูโปรไฟล์')).toBeTruthy();
	});

	it('arriving tab with medical off: no medical field, zoning offered, role gates respected', async () => {
		const arriving = {
			...PRE_REG,
			current_stay: { status: 'arriving' }
		};
		data.evacuees = [arriving];
		const cb = callbacks();
		await render({ ...cb, initialTab: 'arriving', enableMedical: false, canZoning: true });

		const card = cards()[0];
		expect(card.textContent).not.toContain('การแพทย์');
		expect(card.textContent).not.toContain('รอตรวจคัดกรอง');
		expect(card.textContent).toContain('รอโซน');
		expect(button(card, 'คัดกรอง (S2)')).toBeUndefined();
		expect(button(card, 'จัดโซน (S3)')).toBeTruthy();
		expect(button(card, 'ดูโปรไฟล์')).toBeTruthy();
	});

	it('all tab: a card shows every column and only the profile action', async () => {
		const staying = {
			...PRE_REG,
			_id: 'evacuee:SH001:0004',
			first_name: 'บุญเลิศ',
			last_name: 'มหาสมุทรสาครบุรี',
			household_id: 'household:SH001:0001',
			special_needs: ['pregnant', 'elderly', 'disabled'],
			updated_at: '2026-11-04T02:10:00.000Z',
			current_stay: { status: 'active', zone: 'B2' }
		};
		data.evacuees = [staying];
		data.households = [{ _id: 'household:SH001:0001', label: 'ครอบครัวมหาสมุทรสาครบุรี' }];
		const cb = callbacks();
		await render({ ...cb, initialTab: 'all', canMedical: true, canZoning: true });

		expect(cards()).toHaveLength(1);
		const card = cards()[0];
		const text = card.textContent ?? '';
		expect(text).toContain('บุญเลิศ มหาสมุทรสาครบุรี');
		expect(text).toContain('เข้าพักแล้ว');
		expect(text).toContain('โซน B2');
		expect(text).toContain('ครอบครัวมหาสมุทรสาครบุรี');
		expect(text).toContain('pregnant, elderly');
		expect(text).not.toContain('disabled');
		expect(text).toContain('4 พ.ย. 2569 09:10');
		expect(text).toContain('รอยืนยันถึงโซน');

		const labels = Array.from(card.querySelectorAll('dt')).map((dt) => dt.textContent);
		expect(labels).toEqual([
			'สถานะ',
			'โซน',
			'ครอบครัว',
			'ความต้องการพิเศษ',
			'อัปเดตล่าสุด',
			'คิวถัดไป'
		]);
		expect(Array.from(card.querySelectorAll('button')).map((b) => b.textContent?.trim())).toEqual([
			'บุญเลิศ มหาสมุทรสาครบุรี',
			'ดูโปรไฟล์'
		]);
		button(card, 'ดูโปรไฟล์')!.click();
		expect(cb.onProfile).toHaveBeenCalledWith(staying);
	});

	it('all tab: the desktop table header and rows have the same eight columns', async () => {
		data.evacuees = [{ ...PRE_REG, current_stay: { status: 'active', zone: 'B2' } }];
		await render({ ...callbacks(), initialTab: 'all' });

		const headerRow = document.querySelector('thead tr')!;
		expect(headerRow.querySelectorAll('th')).toHaveLength(8);
		// A stray text node between the cells would render as an anonymous extra column.
		expect(
			Array.from(headerRow.childNodes).filter((n) => n.nodeType === 3 && n.textContent?.trim())
		).toEqual([]);
		expect(document.querySelectorAll('tbody tr:first-child td')).toHaveLength(8);
	});

	it('paginates the card list ten per page', async () => {
		data.evacuees = Array.from({ length: 11 }, (_, i) => ({
			...PRE_REG,
			_id: `evacuee:SH001:${String(100 + i)}`,
			first_name: `ผู้ประสบภัย${i}`,
			// Newest first: the last fixture is the oldest and lands on page 2.
			updated_at: `2026-11-04T02:${String(50 - i)}:00.000Z`
		}));
		await render({ ...callbacks(), initialTab: 'pre_registered' });

		expect(cards()).toHaveLength(10);
		const next = Array.from(document.querySelectorAll('button')).find((b) =>
			b.getAttribute('aria-label')?.match(/next|ถัดไป/i)
		);
		expect(next).toBeTruthy();
		next!.click();
		await settle();

		expect(cards()).toHaveLength(1);
		expect(cards()[0].textContent).toContain('ผู้ประสบภัย10');
	});
});
