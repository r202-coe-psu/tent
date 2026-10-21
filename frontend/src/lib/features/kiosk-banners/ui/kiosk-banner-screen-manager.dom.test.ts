// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { KioskBannerApiError, type KioskBannerSummary } from '../data/kiosk-banner.repository';
import Harness from './__fixtures__/screen-manager-harness.svelte';

const reorder = vi.hoisted(() => ({ mutateAsync: vi.fn(), isPending: false }));
const setStatus = vi.hoisted(() => ({ mutate: vi.fn(), isPending: false }));
const remove = vi.hoisted(() => ({ mutate: vi.fn(), isPending: false }));
const invalidateQueries = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());

vi.mock('../application/kiosk-banner.queries', () => ({
	useReorderKioskBanners: () => reorder,
	useSetKioskBannerStatus: () => setStatus,
	useDeleteKioskBanner: () => remove,
	kioskBannerKeys: { all: ['kiosk-banners'] }
}));
vi.mock('@tanstack/svelte-query', () => ({ useQueryClient: () => ({ invalidateQueries }) }));
vi.mock('svelte-sonner', () => ({ toast: { success: toastSuccess } }));

const NOW = new Date('2026-10-15T05:00:00.000Z');

const banner = (
	id: string,
	over: Partial<Omit<KioskBannerSummary, 'schema_v'>> = {}
): KioskBannerSummary => ({
	_id: `kiosk_banner:${id}`,
	_rev: `1-${id}`,
	type: 'kiosk_banner',
	schema_v: 2,
	group_id: 'kiosk_banner_group:A',
	shelter_code: 'SH001',
	title: `แบนเนอร์ ${id}`,
	caption: null,
	order: 1,
	duration_sec: 10,
	start_at: '2026-10-15T01:00:00.000Z',
	end_at: '2026-10-15T11:00:00.000Z',
	status: 'active',
	created_at: '2026-10-14T00:00:00.000Z',
	updated_at: '2026-10-14T00:00:00.000Z',
	created_by: 'tester',
	image_content_type: 'image/png',
	...over
});

let instance: ReturnType<typeof mount> | null = null;

function render(props: {
	initialCurrent: KioskBannerSummary[];
	refreshed?: KioskBannerSummary[];
	expired?: KioskBannerSummary[];
	initialDraft?: KioskBannerSummary[] | null;
	loading?: boolean;
	errorMessage?: string | null;
	screen?: 'compact' | 'portrait';
	groupId?: string;
}) {
	instance = mount(Harness, {
		target: document.body,
		props: { now: NOW, ...props }
	});
	flushSync();
}

const rows = () => [...document.body.querySelectorAll<HTMLLIElement>('ol > li')];
const titles = () => rows().map((row) => row.querySelector('p.font-semibold')?.textContent?.trim());
const draftOut = () => document.body.querySelector('[data-testid="draft"]')?.textContent;
const byText = (selector: string, text: string) =>
	[...document.body.querySelectorAll<HTMLElement>(selector)].find((el) =>
		el.textContent?.includes(text)
	);
const moveDownFirst = () => {
	(document.body.querySelector('button[data-move="down"]') as HTMLButtonElement).click();
	flushSync();
};
const moveUpSecond = () => {
	(document.body.querySelectorAll('button[data-move="up"]')[1] as HTMLButtonElement).click();
	flushSync();
};

beforeEach(() => {
	vi.clearAllMocks();
	reorder.isPending = false;
});
afterEach(async () => {
	if (instance) unmount(instance);
	instance = null;
	// bits-ui releases the body scroll lock on a 24 ms timer; let it run before happy-dom tears down.
	await new Promise((resolve) => setTimeout(resolve, 50));
	document.body.innerHTML = '';
});

describe('KioskBannerScreenManager', () => {
	it('lists only this screen’s banners; a legacy doc without screen_type counts as compact', () => {
		render({
			initialCurrent: [
				banner('legacy', { order: 1 }),
				banner('big', { screen_type: 'portrait', order: 2 }),
				banner('small', { screen_type: 'compact', order: 3 })
			]
		});

		expect(titles()).toEqual(['แบนเนอร์ legacy', 'แบนเนอร์ small']);
	});

	it('lists only this group’s banners, not another group’s or an ungrouped one', () => {
		const GROUP_B = 'kiosk_banner_group:B';
		const current = [
			banner('mine', { order: 1 }),
			banner('theirs', { group_id: GROUP_B, order: 1 }),
			{ ...banner('v1', { group_id: undefined, order: 2 }), schema_v: 1 as const },
			banner('also-theirs', { group_id: GROUP_B, order: 2 })
		];

		render({ initialCurrent: current });
		expect(titles()).toEqual(['แบนเนอร์ mine']);

		unmount(instance!);
		document.body.innerHTML = '';
		render({ initialCurrent: current, groupId: GROUP_B });
		expect(titles()).toEqual(['แบนเนอร์ theirs', 'แบนเนอร์ also-theirs']);
	});

	it('counts only this group’s expired banners', () => {
		render({
			initialCurrent: [banner('live')],
			expired: [
				banner('old-a', { end_at: '2026-10-10T11:00:00.000Z' }),
				banner('old-b', { group_id: 'kiosk_banner_group:B', end_at: '2026-10-10T11:00:00.000Z' })
			]
		});

		expect((byText('[role="tab"]', 'หมดอายุ') as HTMLElement).textContent).toContain('(1)');
	});

	it('shows this screen’s expired banners without drag handles', async () => {
		render({
			initialCurrent: [banner('live')],
			expired: [
				banner('old-s', { end_at: '2026-10-10T11:00:00.000Z' }),
				banner('old-b', { screen_type: 'portrait', end_at: '2026-10-10T11:00:00.000Z' })
			]
		});
		const tab = byText('[role="tab"]', 'หมดอายุ') as HTMLElement;
		expect(tab.textContent).toContain('(1)');

		tab.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
		tab.click();
		await tick();
		flushSync();

		const body = document.body.textContent ?? '';
		expect(body).toContain('แบนเนอร์ old-s');
		expect(body).not.toContain('แบนเนอร์ old-b');
		const panel = document.body.querySelector('[role="tabpanel"]:not([hidden])') as HTMLElement;
		expect(panel.querySelector('[aria-label^="ลากเพื่อย้าย"]')).toBeNull();
		expect(panel.textContent).toContain('หมดอายุ');
	});

	it('creates a draft on an arrow move and clears it when the saved order is restored', () => {
		render({ initialCurrent: [banner('a', { order: 1 }), banner('b', { order: 2 })] });
		expect(byText('button', 'บันทึกลำดับ')).toBeUndefined();
		expect(draftOut()).toBe('none');

		moveDownFirst();

		expect(titles()).toEqual(['แบนเนอร์ b', 'แบนเนอร์ a']);
		expect(draftOut()).toBe('kiosk_banner:b,kiosk_banner:a');
		expect(document.body.textContent).toContain('มีลำดับที่ยังไม่บันทึก');
		expect(byText('button', 'บันทึกลำดับ')).toBeDefined();

		moveUpSecond();

		expect(titles()).toEqual(['แบนเนอร์ a', 'แบนเนอร์ b']);
		expect(draftOut()).toBe('none');
		expect(byText('button', 'บันทึกลำดับ')).toBeUndefined();
	});

	it('cancel drops the draft', () => {
		render({ initialCurrent: [banner('a', { order: 1 }), banner('b', { order: 2 })] });
		moveDownFirst();

		(byText('button', 'ยกเลิก') as HTMLButtonElement).click();
		flushSync();

		expect(draftOut()).toBe('none');
		expect(titles()).toEqual(['แบนเนอร์ a', 'แบนเนอร์ b']);
	});

	it('saves the draft order with the revs of the latest data, then toasts and clears', async () => {
		reorder.mutateAsync.mockResolvedValue(undefined);
		render({
			initialCurrent: [banner('a', { order: 1 }), banner('b', { order: 2 })],
			refreshed: [banner('a', { order: 1, _rev: '2-a' }), banner('b', { order: 2 })]
		});
		moveDownFirst();
		(document.body.querySelector('[data-testid="refetch"]') as HTMLButtonElement).click();
		flushSync();

		(byText('button', 'บันทึกลำดับ') as HTMLButtonElement).click();
		await tick();
		flushSync();

		expect(reorder.mutateAsync).toHaveBeenCalledWith({
			shelterCode: 'SH001',
			groupId: 'kiosk_banner_group:A',
			screenType: 'compact',
			items: [
				{ id: 'kiosk_banner:b', rev: '1-b' },
				{ id: 'kiosk_banner:a', rev: '2-a' }
			]
		});
		expect(toastSuccess).toHaveBeenCalledWith('บันทึกลำดับตู้เล็กแล้ว');
		expect(draftOut()).toBe('none');
	});

	it('drops the draft and refetches on a 409 conflict', async () => {
		reorder.mutateAsync.mockRejectedValue(new KioskBannerApiError(409, 'conflict', 'conflict'));
		render({ initialCurrent: [banner('a', { order: 1 }), banner('b', { order: 2 })] });
		moveDownFirst();

		(byText('button', 'บันทึกลำดับ') as HTMLButtonElement).click();
		await tick();
		await tick();
		flushSync();

		expect(draftOut()).toBe('none');
		expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['kiosk-banners'] });
		expect(toastSuccess).not.toHaveBeenCalled();
	});

	it('keeps the draft when saving fails for another reason', async () => {
		reorder.mutateAsync.mockRejectedValue(new Error('boom'));
		render({ initialCurrent: [banner('a', { order: 1 }), banner('b', { order: 2 })] });
		moveDownFirst();

		(byText('button', 'บันทึกลำดับ') as HTMLButtonElement).click();
		await tick();
		await tick();
		flushSync();

		expect(draftOut()).toBe('kiosk_banner:b,kiosk_banner:a');
		expect(invalidateQueries).not.toHaveBeenCalled();
	});

	it('shows「กำลังบันทึก...」and disables the footer buttons while saving', () => {
		reorder.isPending = true;
		const a = banner('a', { order: 1 });
		const b = banner('b', { order: 2 });
		render({ initialCurrent: [a, b], initialDraft: [b, a] });

		const save = byText('button', 'กำลังบันทึก...') as HTMLButtonElement;
		expect(save.disabled).toBe(true);
		expect((byText('button', 'ยกเลิก') as HTMLButtonElement).disabled).toBe(true);
	});

	it('shows a loading message instead of the list', () => {
		render({ initialCurrent: [], loading: true });

		expect(document.body.textContent).toContain('กำลังโหลดรายการแบนเนอร์');
		expect(document.body.querySelector('ol')).toBeNull();
	});

	it('shows the error message instead of the list', () => {
		render({ initialCurrent: [], errorMessage: 'โหลดไม่สำเร็จ' });

		expect(document.body.textContent).toContain('โหลดไม่สำเร็จ');
		expect(document.body.querySelector('ol')).toBeNull();
	});

	it('says so when the screen has no expired banners', async () => {
		render({ initialCurrent: [], expired: [banner('old-b', { screen_type: 'portrait' })] });
		const tab = byText('[role="tab"]', 'หมดอายุ') as HTMLElement;

		tab.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
		tab.click();
		await tick();
		flushSync();

		expect(document.body.textContent).toContain('ไม่มีแบนเนอร์ที่หมดอายุ');
	});

	it('opens the kiosk preview for this screen only, without a screen toggle', async () => {
		const a = banner('a', { order: 1 });
		const b = banner('b', { order: 2 });
		render({
			initialCurrent: [a, b, banner('big', { screen_type: 'portrait', order: 3 })],
			initialDraft: [b, a]
		});

		(document.body.querySelector('[data-testid="open-preview"]') as HTMLButtonElement).click();
		await tick();
		flushSync();

		expect(document.body.textContent).toContain('ตัวอย่างบน kiosk');
		expect(document.body.querySelector('[aria-pressed]')).toBeNull();
	});
});
