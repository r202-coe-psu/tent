// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import type { DonationCampaign, NeedCloseState, NeedItem } from '$lib/features/operations';
import NeedsBoardAdmin from './needs-board-admin.svelte';

vi.mock('$lib/features/catalog', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/catalog')>()),
	useUnitsOfMeasure: () => ({ data: [] })
}));

type NeedFixture = { itemId: string; name: string; closeState: NeedCloseState; manual?: boolean };

function campaign(
	id: string,
	needs: NeedFixture[],
	opts: { showOnHome?: boolean; closed?: boolean } = {}
): NeedItem {
	const doc = {
		_id: id,
		type: 'donation_campaign',
		schema_v: 1,
		shelter_code: 'SH001',
		title: id,
		status: opts.closed ? 'closed' : 'open',
		visible_on_home: opts.showOnHome ?? true,
		needs: needs.map((n) => ({
			item_id: n.itemId,
			qty_target: '100',
			unit: 'kg',
			status: n.manual ? 'closed' : 'open'
		})),
		created_at: '2026-10-01T00:00:00Z',
		updated_at: '2026-10-01T00:00:00Z',
		created_by: 'test'
	} as unknown as DonationCampaign;
	return {
		id,
		title: id,
		location: '',
		showOnHome: opts.showOnHome ?? true,
		closeState: opts.closed ? 'closed' : 'open',
		isManualClosed: !!opts.closed,
		needs: needs.map((n) => ({
			itemId: n.itemId,
			name: n.name,
			reserved: '0',
			onHand: n.closeState === 'reached' ? '100' : '10',
			target: '100',
			remaining: n.closeState === 'open' ? '90' : '0',
			unit: 'kg',
			closeState: n.closeState,
			isManualClosed: !!n.manual
		})),
		campaignDoc: doc
	};
}

const callbacks = {
	onAddRequest: vi.fn(),
	onToggleShowOnHome: vi.fn(),
	onToggleCutOff: vi.fn()
};

let instance: ReturnType<typeof mount> | null = null;

async function render(items: NeedItem[]) {
	instance = mount(NeedsBoardAdmin, { target: document.body, props: { items, ...callbacks } });
	flushSync();
	await tick();
	flushSync();
}

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
	vi.clearAllMocks();
});

const text = (el: Element) => el.textContent?.replace(/\s+/g, ' ').trim() ?? '';
/** Mobile cards — one `<article>` per need row. */
const cards = () => [...document.body.querySelectorAll('article')];
/** Desktop table body rows. */
const tableRows = () => [...document.body.querySelectorAll('tbody tr')];
const buttons = (root: Element) => [...root.querySelectorAll('button')];
const buttonByText = (root: Element, label: string) =>
	buttons(root).find((b) => text(b) === label) as HTMLButtonElement | undefined;
const rowFor = (rows: Element[], name: string) => rows.find((r) => text(r).includes(name))!;
const bar = (root: Element) => root.querySelector('[style*="width"]') as HTMLElement;

const toggleOf = (row: Element) =>
	buttons(row).find((b) => ['กำลังโชว์บนหน้าเว็บ', 'ซ่อนจากหน้าเว็บ'].includes(text(b)));

describe('needs board row state (#816 / #817)', () => {
	it('shows a reached row as green "ครบถ้วน" with a green bar, not CUT-OFF', async () => {
		await render([campaign('c1', [{ itemId: 'item:rice', name: 'ข้าว', closeState: 'reached' }])]);

		for (const row of [cards()[0], tableRows()[0]]) {
			const badge = [...row.querySelectorAll('[data-slot="badge"]')].find(
				(b) => text(b) === 'ครบถ้วน'
			);
			expect(badge?.className).toContain('bg-success-muted');
			expect(badge?.className).toContain('text-success-dark');
			expect(text(row)).not.toContain('CUT-OFF');
			expect(bar(row).className).toContain('bg-success');
			expect(bar(row).className).not.toMatch(/bg-red-600|bg-rose-500/);
			expect(buttonByText(row, 'ปิดอัตโนมัติ (ครบเป้า)')?.disabled).toBe(true);
		}
	});

	it('keeps a force-cut-off row as red "CUT-OFF" with Restore', async () => {
		await render([
			campaign('c1', [{ itemId: 'item:rice', name: 'ข้าว', closeState: 'closed', manual: true }])
		]);

		const card = cards()[0];
		expect(text(card)).toContain('CUT-OFF');
		expect(text(card)).not.toContain('ครบถ้วน');
		expect(bar(card).className).toContain('bg-red-600');
		expect(bar(tableRows()[0]).className).toContain('bg-rose-500');

		buttonByText(card, 'เปิดรับบริจาค (Restore)')!.click();
		expect(callbacks.onToggleCutOff).toHaveBeenCalledWith('c1', 'item:rice');
	});

	it('offers no cut-off action on a need closed only through its campaign', async () => {
		await render([
			campaign('c1', [{ itemId: 'item:rice', name: 'ข้าว', closeState: 'closed' }], {
				closed: true
			})
		]);

		for (const row of [cards()[0], tableRows()[0]]) {
			expect(text(row)).toContain('CUT-OFF');
			expect(text(row)).not.toContain('ปิดอัตโนมัติ (ครบเป้า)');
			expect(text(row)).not.toContain('Force Cut-off');
			expect(text(row)).not.toContain('Restore');
		}
	});

	it('never says "กำลังโชว์บนหน้าเว็บ" on a reached or cut-off row (#817)', async () => {
		await render([
			campaign('c1', [
				{ itemId: 'item:rice', name: 'ข้าว', closeState: 'reached' },
				{ itemId: 'item:soap', name: 'สบู่', closeState: 'closed', manual: true }
			])
		]);

		for (const row of [...cards(), ...tableRows()]) {
			const toggle = toggleOf(row)!;
			expect(text(toggle)).toBe('ซ่อนจากหน้าเว็บ');
			expect(toggle.disabled).toBe(true);
		}
	});

	it('keeps the show-on-web toggle and Force Cut-off on an open row', async () => {
		await render([campaign('c1', [{ itemId: 'item:rice', name: 'ข้าว', closeState: 'open' }])]);

		const card = cards()[0];
		expect(card.querySelector('[data-slot="badge"]')).toBeNull();
		const toggle = buttonByText(card, 'กำลังโชว์บนหน้าเว็บ')!;
		expect(toggle.disabled).toBe(false);
		toggle.click();
		expect(callbacks.onToggleShowOnHome).toHaveBeenCalledWith('c1');
		buttonByText(card, 'Force Cut-off')!.click();
		expect(callbacks.onToggleCutOff).toHaveBeenCalledWith('c1', 'item:rice');
	});

	it('shows "ซ่อนจากหน้าเว็บ" on open rows of a hidden campaign', async () => {
		await render([
			campaign('c1', [{ itemId: 'item:rice', name: 'ข้าว', closeState: 'open' }], {
				showOnHome: false
			})
		]);

		for (const row of [cards()[0], tableRows()[0]]) {
			const toggle = buttonByText(row, 'ซ่อนจากหน้าเว็บ')!;
			expect(toggle.disabled).toBe(false);
		}
	});

	it('lets one reached and one open need in a campaign disagree only on their own row', async () => {
		await render([
			campaign('c1', [
				{ itemId: 'item:rice', name: 'ข้าว', closeState: 'reached' },
				{ itemId: 'item:water', name: 'น้ำ', closeState: 'open' }
			])
		]);

		for (const rows of [cards(), tableRows()]) {
			expect(toggleOf(rowFor(rows, 'ข้าว'))!.disabled).toBe(true);
			expect(text(rowFor(rows, 'ข้าว'))).toContain('ครบถ้วน');
			const open = buttonByText(rowFor(rows, 'น้ำ'), 'กำลังโชว์บนหน้าเว็บ');
			expect(open?.disabled).toBe(false);
		}
	});

	it('follows the campaign state for a campaign with no needs', async () => {
		await render([campaign('c-open', []), campaign('c-closed', [], { closed: true })]);

		const open = rowFor(cards(), 'c-open');
		const closed = rowFor(cards(), 'c-closed');
		expect(buttonByText(open, 'กำลังโชว์บนหน้าเว็บ')).toBeDefined();
		expect(open.querySelector('[data-slot="badge"]')).toBeNull();
		expect(text(closed)).toContain('CUT-OFF');
	});

	it('still shows the shared-campaign badge', async () => {
		await render([
			campaign('c1', [{ itemId: 'item:rice', name: 'ข้าว', closeState: 'open' }]),
			campaign('c2', [{ itemId: 'item:rice', name: 'ข้าว', closeState: 'open' }])
		]);

		expect(text(cards()[0])).toContain('รวมกับอีก 1 ประกาศบนหน้า public');
	});
});

describe('status filter (#816)', () => {
	it.each([
		['สถานะ', 'ทั้งหมด'],
		['เรียง', 'ความคืบหน้าน้อยไปมาก']
	])(
		'puts the "%s" label above its select and only the value in the button',
		async (label, value) => {
			await render([]);
			const labelEl = [...document.body.querySelectorAll('label')].find((l) => text(l) === label)!;
			const trigger = document.getElementById(labelEl.htmlFor)!;
			expect(trigger.tagName).toBe('BUTTON');
			expect(text(trigger)).toBe(value);
			// Named by the label and its own text, so the selected value is announced too.
			expect(trigger.getAttribute('aria-labelledby')).toBe(`${labelEl.id} ${trigger.id}`);
		}
	);

	it('defaults to "all" and lists every row', async () => {
		await render([
			campaign('c1', [
				{ itemId: 'item:rice', name: 'ข้าว', closeState: 'reached' },
				{ itemId: 'item:water', name: 'น้ำ', closeState: 'open' },
				{ itemId: 'item:soap', name: 'สบู่', closeState: 'closed', manual: true }
			])
		]);

		const label = [...document.body.querySelectorAll('label')].find((l) => text(l) === 'สถานะ')!;
		expect(text(document.getElementById(label.htmlFor)!)).toBe('ทั้งหมด');
		expect(cards()).toHaveLength(3);
	});
});

describe('Special Request button (#818)', () => {
	it('wraps instead of clipping and has a short label below sm', async () => {
		await render([]);

		const button = buttons(document.body).find((b) =>
			text(b).includes('สร้างประกาศแบบกำหนดเอง (Special Request)')
		)!;
		const classes = button.className.split(/\s+/);
		expect(classes).toEqual(expect.arrayContaining(['h-auto', 'min-h-11', 'whitespace-normal']));
		expect(classes).not.toContain('whitespace-nowrap');
		expect(classes).not.toContain('h-11');
		expect(text(button.querySelector('span.sm\\:hidden')!)).toBe('สร้างประกาศเอง');
		expect(button.querySelector('span.hidden.sm\\:inline')?.textContent).toContain(
			'(Special Request)'
		);

		button.click();
		expect(callbacks.onAddRequest).toHaveBeenCalledOnce();
	});
});
