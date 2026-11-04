// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import type { KioskBannerSummary } from '../data/kiosk-banner.repository';
import Harness from './__fixtures__/order-list-harness.svelte';

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

function render(initial: KioskBannerSummary[], disabled = false, withRowActions = false) {
	instance = mount(Harness, {
		target: document.body,
		props: { initial, now: NOW, disabled, withRowActions }
	});
	flushSync();
}

const rows = () => [...document.body.querySelectorAll<HTMLLIElement>('ol > li')];
const order = () => document.body.querySelector('[data-testid="order"]')?.textContent;

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
});

describe('KioskBannerOrderList', () => {
	it('shows each row’s title, Bangkok time window and image', () => {
		render([banner('a')]);

		const row = rows()[0];
		expect(row.textContent).toContain('แบนเนอร์ a');
		expect(row.textContent).toContain('15 ต.ค. 08:00–18:00');
		const image = row.querySelector('img') as HTMLImageElement;
		expect(image.getAttribute('src')).toContain('/api/back-office/kiosk-banners/');
	});

	it('renders rows in items order with positions and status badges', () => {
		render([
			banner('a'),
			banner('b', { status: 'inactive' }),
			banner('c', { start_at: '2026-10-16T01:00:00.000Z', end_at: '2026-10-16T11:00:00.000Z' })
		]);

		const found = rows();
		expect(found).toHaveLength(3);
		expect(found.map((row) => row.querySelector('[data-testid="position"]')?.textContent)).toEqual([
			'1',
			'2',
			'3'
		]);
		expect(found[0].textContent).toContain('แบนเนอร์ a');
		expect(found[0].textContent).toContain('แสดงอยู่');
		expect(found[1].textContent).toContain('ปิดอยู่');
		expect(found[2].textContent).toContain('รอแสดง');
	});

	it('shows a muted message when there are no banners', () => {
		render([]);
		expect(rows()).toHaveLength(0);
		expect(document.body.textContent).toContain('ไม่มีแบนเนอร์ที่ยังไม่หมดอายุสำหรับขนาดจอนี้');
	});

	it('moves a row with the arrow buttons, announces it, and disables the edge buttons', () => {
		render([banner('a'), banner('b'), banner('c')]);

		const button = (label: string) =>
			document.body.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
		expect(button('เลื่อน แบนเนอร์ a ขึ้น').disabled).toBe(true);
		expect(button('เลื่อน แบนเนอร์ c ลง').disabled).toBe(true);
		expect(button('เลื่อน แบนเนอร์ a ลง').disabled).toBe(false);

		button('เลื่อน แบนเนอร์ a ลง').click();
		flushSync();

		expect(order()).toBe('kiosk_banner:b,kiosk_banner:a,kiosk_banner:c');
		expect(rows()[1].textContent).toContain('แบนเนอร์ a');
		expect(document.body.querySelector('[aria-live="polite"]')?.textContent).toBe(
			'ย้าย แบนเนอร์ a ไปลำดับ 2'
		);
	});

	it('renders the rowActions snippet once per row, before the arrow buttons', () => {
		render([banner('a'), banner('b'), banner('c')], false, true);

		const actions = [...document.body.querySelectorAll('[data-testid="row-action"]')];
		expect(actions.map((node) => node.textContent)).toEqual([
			'kiosk_banner:a',
			'kiosk_banner:b',
			'kiosk_banner:c'
		]);
		rows().forEach((row, i) => {
			expect(row.contains(actions[i])).toBe(true);
			const up = row.querySelector('button[data-move="up"]')!;
			expect(
				actions[i].compareDocumentPosition(up) & Node.DOCUMENT_POSITION_FOLLOWING
			).toBeTruthy();
		});
	});

	describe('keyboard focus after an arrow move', () => {
		/** The click handler awaits `tick()` before refocusing, so wait one more turn. */
		const settle = async () => {
			await tick();
			await tick();
		};
		const arrow = (title: string, dir: 'ขึ้น' | 'ลง') =>
			document.body.querySelector<HTMLButtonElement>(
				`button[aria-label="เลื่อน ${title} ${dir}"]`
			)!;

		it("keeps focus on the moved row's same arrow button", async () => {
			render([banner('a'), banner('b'), banner('c')]);

			const down = arrow('แบนเนอร์ a', 'ลง');
			down.focus();
			down.click();
			await settle();

			const active = document.activeElement as HTMLElement;
			expect(active.dataset.move).toBe('down');
			expect(active.dataset.bannerId).toBe('kiosk_banner:a');
		});

		it('focuses the other arrow when the row reaches the edge and the pressed one is disabled', async () => {
			render([banner('a'), banner('b'), banner('c')]);

			const down = arrow('แบนเนอร์ b', 'ลง');
			down.focus();
			down.click();
			await settle();

			expect(arrow('แบนเนอร์ b', 'ลง').disabled).toBe(true);
			const active = document.activeElement as HTMLElement;
			expect(active.dataset.move).toBe('up');
			expect(active.dataset.bannerId).toBe('kiosk_banner:b');
		});
	});

	describe('dragging', () => {
		/** happy-dom has no layout: give every row a 60px box stacked from the top. */
		function stubLayout() {
			rows().forEach((row, i) => {
				row.getBoundingClientRect = () =>
					({
						top: i * 60,
						height: 60,
						bottom: i * 60 + 60,
						left: 0,
						right: 300,
						width: 300
					}) as DOMRect;
			});
		}
		const handle = (title: string) =>
			document.body.querySelector<HTMLButtonElement>(`button[aria-label="ลากเพื่อย้าย ${title}"]`)!;
		const pointer = (target: Element, type: string, clientY: number) =>
			target.dispatchEvent(
				new PointerEvent(type, {
					bubbles: true,
					clientY,
					pointerId: 1,
					button: 0,
					pointerType: 'mouse'
				})
			);

		it('drops a dragged row at the position under the pointer', () => {
			render([banner('a'), banner('b'), banner('c'), banner('d')]);
			stubLayout();

			const grip = handle('แบนเนอร์ c');
			pointer(grip, 'pointerdown', 150);
			pointer(grip, 'pointermove', 10);
			flushSync();
			pointer(grip, 'pointerup', 10);
			flushSync();

			expect(order()).toBe('kiosk_banner:c,kiosk_banner:a,kiosk_banner:b,kiosk_banner:d');
			expect(document.body.querySelector('[aria-live="polite"]')?.textContent).toBe(
				'ย้าย แบนเนอร์ c ไปลำดับ 1'
			);
		});

		it('leaves the order unchanged when Escape cancels the drag', () => {
			render([banner('a'), banner('b'), banner('c'), banner('d')]);
			stubLayout();

			const grip = handle('แบนเนอร์ c');
			pointer(grip, 'pointerdown', 150);
			pointer(grip, 'pointermove', 10);
			flushSync();
			expect(rows()[2].getAttribute('style')).toContain('translateY');

			document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
			pointer(grip, 'pointerup', 10);
			flushSync();

			expect(order()).toBe('kiosk_banner:a,kiosk_banner:b,kiosk_banner:c,kiosk_banner:d');
			expect(rows().every((row) => !row.getAttribute('style'))).toBe(true);
		});

		it('does not start a drag while disabled, and disables the buttons', () => {
			render([banner('a'), banner('b'), banner('c')], true);
			stubLayout();

			const grip = handle('แบนเนอร์ c');
			pointer(grip, 'pointerdown', 150);
			pointer(grip, 'pointermove', 10);
			flushSync();
			expect(rows()[2].getAttribute('style')).toBeNull();
			pointer(grip, 'pointerup', 10);
			flushSync();

			expect(order()).toBe('kiosk_banner:a,kiosk_banner:b,kiosk_banner:c');
			const buttons = [...document.body.querySelectorAll<HTMLButtonElement>('button')];
			expect(buttons.length).toBeGreaterThan(0);
			expect(buttons.every((button) => button.disabled)).toBe(true);
		});
	});
});
