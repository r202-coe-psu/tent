// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import type { ParkingPoint } from '../domain/schema';
import Harness from './__fixtures__/parking-points-harness.svelte';

vi.mock('svelte-sonner', () => ({ toast: { success: vi.fn(), info: vi.fn() } }));
// happy-dom's cloned <form> reports no method, which trips kit's dev-only `enhance` guard.
vi.mock('$app/forms', async (importOriginal) => ({
	...(await importOriginal<typeof import('$app/forms')>()),
	enhance: () => ({ destroy() {} })
}));

let instance: ReturnType<typeof mount> | null = null;

const EMPTY_STATE = 'ยังไม่มีจุดจอดรถ กรุณาเพิ่มรายการใหม่';
const NAME_REQUIRED = 'กรุณาระบุชื่อที่จอดรถ';
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

const point = (id: string, name: string): ParkingPoint => ({
	id,
	name,
	note: null,
	lat: null,
	lng: null,
	vehicles: []
});

async function settle() {
	flushSync();
	await tick();
	flushSync();
}

async function render(points: ParkingPoint[] = []) {
	instance = mount(Harness, { target: document.body, props: { points } });
	await settle();
}

const storedPoints = () =>
	JSON.parse(document.body.querySelector('[data-testid="points"]')!.textContent!) as ParkingPoint[];
const addButton = () =>
	[...document.body.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
		b.textContent?.includes('เพิ่มจุดจอดรถ')
	)!;
const removeButtons = () =>
	document.body.querySelectorAll<HTMLButtonElement>('button[title="ลบจุดจอดรถ"]');
const nameInputs = () =>
	document.body.querySelectorAll<HTMLInputElement>(
		'input[placeholder="เช่น ลานจอดหน้าอาคารเรียน"]'
	);

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
	vi.clearAllMocks();
});

describe('ParkingPointsSection — list', () => {
	it('shows the empty-state prompt when there are no parking points', async () => {
		await render([]);
		expect(document.body.textContent).toContain(EMPTY_STATE);
		expect(nameInputs()).toHaveLength(0);
	});

	it('adds a row with a ULID id and an empty name when add is pressed', async () => {
		await render([]);
		addButton().click();
		await settle();

		const [added] = storedPoints();
		expect(storedPoints()).toHaveLength(1);
		expect(added.id).toMatch(ULID_RE);
		expect(added).toMatchObject({ name: '', note: null, lat: null, lng: null });
		expect(document.body.textContent).not.toContain(EMPTY_STATE);
	});

	it('removes only the chosen point and keeps the other ids', async () => {
		await render([point('p1', 'ลานหน้าอาคาร'), point('p2', 'ลานหลัง')]);
		removeButtons()[0].click();
		await settle();

		expect(storedPoints().map((p) => p.id)).toEqual(['p2']);
	});

	it('shows the schema error when a point name is emptied', async () => {
		await render([point('p1', 'ลานหน้าอาคาร')]);
		const input = nameInputs()[0];
		input.value = '';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		// `blur` does not bubble; superforms hears the leave through `focusout` on the form.
		input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
		// Superforms validates after a short timer, then awaits the async zod parse.
		await new Promise((resolve) => setTimeout(resolve, 20));
		await settle();

		expect(document.body.textContent).toContain(NAME_REQUIRED);
	});
});

describe('ParkingPointsSection — vehicles per point (CR-253)', () => {
	const carBox = () =>
		document.body.querySelector<HTMLElement>(
			'[data-testid="parking-vehicles-0"] button[role="checkbox"]'
		)!;
	const capacityInput = () =>
		document.body.querySelector<HTMLInputElement>('input[aria-label^="ความจุ"]');

	it('ticks a type once, stores its capacity, and unticks it again', async () => {
		await render([point('p1', 'ลานหน้าอาคาร')]);
		expect(capacityInput()).toBeNull();

		carBox().click(); // first checkbox = motorcycle
		await settle();
		const input = capacityInput()!;
		input.value = '30';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		await settle();
		expect(storedPoints()[0].vehicles).toEqual([{ type: 'motorcycle', max_capacity: 30 }]);

		carBox().click();
		await settle();
		expect(storedPoints()[0].vehicles).toEqual([]);
	});

	it('tells staff the note is public', async () => {
		await render([point('p1', 'ลานหน้าอาคาร')]);
		expect(document.body.textContent).toContain('ข้อความนี้แสดงต่อสาธารณะ ห้ามใส่ข้อมูลส่วนบุคคล');
	});
});
