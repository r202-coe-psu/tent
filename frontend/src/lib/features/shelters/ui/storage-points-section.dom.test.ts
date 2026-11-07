// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { toast } from 'svelte-sonner';
import type { SubStorageItem, SubStorageType } from '../domain/schema';
import Harness from './__fixtures__/storage-points-harness.svelte';

vi.mock('svelte-sonner', () => ({ toast: { success: vi.fn(), info: vi.fn() } }));
// happy-dom's cloned <form> reports no method, which trips kit's dev-only `enhance` guard.
// Superforms still adds its own input/blur listeners on the form, which is what #1054 needs.
vi.mock('$app/forms', async (importOriginal) => ({
	...(await importOriginal<typeof import('$app/forms')>()),
	enhance: () => ({ destroy() {} })
}));

let instance: ReturnType<typeof mount> | null = null;

const POINT = {
	id: 'p1',
	name: 'คลัง 1',
	area_m2: null,
	accepts_donations: false,
	lat: null,
	lng: null,
	location_note: null
};

async function render(
	types: SubStorageType[],
	over: Partial<SubStorageItem> = {},
	{
		validated = false,
		stockedLotCount,
		stockReady
	}: {
		validated?: boolean;
		stockedLotCount?: (pointId: string) => number;
		stockReady?: boolean;
	} = {}
) {
	instance = mount(Harness, {
		target: document.body,
		props: { points: [{ ...POINT, types, ...over }], validated, stockedLotCount, stockReady }
	});
	flushSync();
	await tick();
	flushSync();
}

const chip = (label: string) =>
	[...document.body.querySelectorAll<HTMLButtonElement>('[data-slot="toggle-group-item"]')].find(
		(b) => b.textContent?.trim() === label
	)!;
const storedTypes = () =>
	JSON.parse(document.body.querySelector('[data-testid="types"]')!.textContent!)[0];

async function click(label: string) {
	chip(label).click();
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

describe('StoragePointsSection — storage types', () => {
	it('stores types in enum order whatever the click order', async () => {
		await render(['drinking_water']);
		await click('ทั่วไป');
		await click('อาหารเด็ก');
		expect(storedTypes()).toEqual(['general', 'baby_food', 'drinking_water']);
	});

	it('refuses to clear the last type and says why', async () => {
		await render(['food_dry']);
		await click('อาหารแห้ง');
		expect(storedTypes()).toEqual(['food_dry']);
		expect(chip('อาหารแห้ง').getAttribute('data-state')).toBe('on');
		expect(toast.info).toHaveBeenCalledWith('ต้องเลือกอย่างน้อย 1 ประเภท');
	});
});

const dropOffBox = () =>
	// Each row's checkbox names its point (#1004 review S2): "ใช้เป็นจุดรับบริจาค — คลัง 1".
	document.body.querySelector<HTMLButtonElement>('button[aria-label^="ใช้เป็นจุดรับบริจาค"]');
const pinButton = () =>
	[...document.body.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
		b.textContent?.includes('ปักหมุดตำแหน่ง')
	);
const storedPoint = () =>
	JSON.parse(document.body.querySelector('[data-testid="points"]')!.textContent!)[0];

async function settle() {
	flushSync();
	await tick();
	flushSync();
}

describe('StoragePointsSection — donation drop-off (CR-205)', () => {
	it('hides the pin button and note until the point is ticked (FR-DP-6..8)', async () => {
		await render(['general']);
		expect(dropOffBox()?.getAttribute('aria-label')).toBe('ใช้เป็นจุดรับบริจาค — คลัง 1');
		expect(pinButton()).toBeUndefined();
		expect(document.body.textContent).not.toContain('คำอธิบายตำแหน่งสำหรับผู้มาส่ง');

		dropOffBox()!.click();
		await settle();
		expect(storedPoint().accepts_donations).toBe(true);
		expect(pinButton()?.getAttribute('aria-label')).toBe('ปักหมุดตำแหน่ง — คลัง 1');
		expect(pinButton()).toBeDefined();
		expect(document.body.textContent).toContain('คำอธิบายตำแหน่งสำหรับผู้มาส่ง');
		expect(document.body.textContent).toContain('ยังไม่ได้ปักหมุด');
	});

	it('keeps the pin and note when unticked (FR-DP-5)', async () => {
		await render(['general'], {
			accepts_donations: true,
			lat: 7.0086,
			lng: 100.4747,
			location_note: 'ประตู 2'
		});
		expect(document.body.textContent).toContain('7.0086, 100.4747');

		dropOffBox()!.click();
		await settle();
		expect(storedPoint()).toMatchObject({
			accepts_donations: false,
			lat: 7.0086,
			lng: 100.4747,
			location_note: 'ประตู 2'
		});
		expect(pinButton()).toBeUndefined();
	});
});

/**
 * #1054: superforms writes its zod-parsed data (`location_note` trimmed) back after a change it
 * cannot tie to an `input` event — which is only reached on a valid form, so these mount the
 * harness `validated` (client validators + `<form use:enhance>`, as on the shelter page).
 */
describe('StoragePointsSection — typing the drop-off note (#1054)', () => {
	const NOTE = 'คณะสัตวแพทย์ ประตู 2';
	const PINNED = { accepts_donations: true, lat: 7.0086, lng: 100.4747 };
	const noteInput = () =>
		document.body.querySelector<HTMLInputElement>('input[placeholder="เช่น ประตู 2 ข้างโรงยิม"]')!;

	/** Superforms validates on a timer after each change, then awaits the async zod parse. */
	async function settleValidation() {
		await settle();
		await new Promise((resolve) => setTimeout(resolve, 20));
		await settle();
	}

	/** One keystroke at a time: the field shows whatever survived the previous one. */
	async function type(text: string) {
		const input = noteInput();
		for (const ch of text) {
			input.value += ch;
			input.dispatchEvent(new Event('input', { bubbles: true }));
			await settleValidation();
		}
	}

	it('keeps the spaces between words on a pinned point of a valid shelter', async () => {
		await render(['general'], PINNED, { validated: true });
		await type(NOTE);
		expect(noteInput().value).toBe(NOTE);
		expect(storedPoint().location_note).toBe(NOTE);
	});

	it('keeps them while the form is still invalid (point ticked but not pinned)', async () => {
		await render(
			['general'],
			{ accepts_donations: true, lat: null, lng: null },
			{ validated: true }
		);
		await type(NOTE);
		expect(noteInput().value).toBe(NOTE);
	});

	/** `blur` does not bubble — superforms hears the leave through `focusout` on the form. */
	async function leaveField() {
		noteInput().dispatchEvent(new FocusEvent('blur'));
		noteInput().dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
		await settleValidation();
	}

	it('keeps the inner spaces after leaving the field, trimming only the ends', async () => {
		await render(['general'], PINNED, { validated: true });
		await type(` ${NOTE} `);
		await leaveField();
		expect(storedPoint().location_note).toBe(NOTE);
	});

	it('stores a note of only spaces as null after leaving the field', async () => {
		await render(['general'], PINNED, { validated: true });
		await type('   ');
		await leaveField();
		expect(storedPoint().location_note).toBeNull();
	});
});

describe('StoragePointsSection — delete guard (CR-230 FR-11, AC-8)', () => {
	const deleteButton = () =>
		document.body.querySelector<HTMLButtonElement>(
			'button[title^="ลบจุดเก็บของ"], button[title^="ยังมีของ"]'
		)!;

	it('disables delete and shows the lot count while stock remains', async () => {
		await render(['general'], {}, { stockedLotCount: (id) => (id === 'p1' ? 2 : 0) });
		expect(deleteButton().disabled).toBe(true);
		expect(deleteButton().title).toBe('ยังมีของ 2 ล็อต');
		expect(document.body.textContent).toContain('ยังมีของ 2 ล็อต');
	});

	it('keeps delete off until the ledger has loaded', async () => {
		await render(['general'], {}, { stockedLotCount: () => 0, stockReady: false });
		expect(deleteButton().disabled).toBe(true);
	});

	it('keeps an empty point deletable', async () => {
		await render(['general'], {}, { stockedLotCount: () => 0 });
		expect(deleteButton().disabled).toBe(false);
		expect(document.body.textContent).not.toContain('ยังมีของ');
		deleteButton().click();
		await settle();
		expect(document.body.querySelector('[data-testid="points"]')!.textContent).toBe('[]');
	});

	it('defaults to deletable when no counter is supplied', async () => {
		await render(['general']);
		expect(deleteButton().disabled).toBe(false);
	});
});
