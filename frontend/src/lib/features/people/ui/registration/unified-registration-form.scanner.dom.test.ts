// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { QueryClient } from '@tanstack/svelte-query';
import { toast } from 'svelte-sonner';
import { goto } from '$app/navigation';
import UnifiedRegistrationFormHarness from './__fixtures__/unified-registration-form-harness.svelte';

vi.mock('svelte-sonner', () => ({
	toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }
}));
vi.mock('$app/navigation', () => ({
	goto: vi.fn(),
	replaceState: vi.fn(),
	beforeNavigate: vi.fn()
}));

/** A card the desktop scanner client read (issue #1326 `scanner:card-read` detail). */
const card = {
	citizen_id: '1234567890123',
	first_name_th: 'สมหญิง',
	last_name_th: 'ใจดี',
	gender: 'female',
	birth_date: '2535-04-12',
	birth_year_ce: 1992,
	age: 34,
	address_no: '99/1',
	village_no: '3',
	lane: 'ซอย 5',
	road: '',
	subdistrict: 'ตำบลในเมือง',
	district: 'เมือง',
	province: 'ขอนแก่น',
	scanned_at: '2026-11-11T09:00:00+07:00'
};

let instance: ReturnType<typeof mount> | null = null;

beforeEach(() => {
	vi.clearAllMocks();
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => Response.json([]))
	);
});

afterEach(async () => {
	if (instance) unmount(instance);
	instance = null;
	await new Promise((resolve) => setTimeout(resolve, 50));
	document.body.innerHTML = '';
	vi.unstubAllGlobals();
});

const values = (suffix: string) =>
	[...document.querySelectorAll<HTMLInputElement>(`input[id$="${suffix}"]`)].map((i) => i.value);

/** Mounted the way the staff walk-in page `/onsite/people/new` mounts it. */
function renderWalkInForm(extraProps: Record<string, unknown> = {}) {
	instance = mount(UnifiedRegistrationFormHarness, {
		target: document.body,
		props: {
			client: new QueryClient({ defaultOptions: { queries: { retry: false } } }),
			channel: 'onsite',
			includeVehiclesAssets: true,
			shelterCode: 'SH001',
			onsubmit: vi.fn(),
			onDirtyChange: vi.fn(),
			...extraProps
		}
	});
	flushSync();
}

/** A different person, so a second read finds every member already holding data. */
const otherCard = {
	...card,
	citizen_id: '9876543210987',
	first_name_th: 'สมชาย',
	last_name_th: 'รักดี',
	gender: 'male'
};

const dispatchCardRead = (detail: typeof card = card) => {
	const event = new CustomEvent('scanner:card-read', { detail, cancelable: true });
	window.dispatchEvent(event);
	return event;
};

const settle = async () => {
	await tick();
	flushSync();
	await new Promise((resolve) => setTimeout(resolve, 0));
	flushSync();
};

const buttonByText = (text: string) =>
	[...document.querySelectorAll<HTMLButtonElement>('button')].find(
		(b) => b.textContent?.trim() === text
	);

/** First card fills member 1; a second, different card then asks what to do with it. */
async function readTwoDifferentCards() {
	renderWalkInForm();
	dispatchCardRead(card);
	await settle();
	dispatchCardRead(otherCard);
	await settle();
}

describe('UnifiedRegistrationForm — scanner client card read', () => {
	it('acknowledges scanner:card-read and fills the first empty member name and ID number', async () => {
		renderWalkInForm();
		expect(values('first-name')).toEqual(['']);

		const event = dispatchCardRead();
		await tick();
		flushSync();

		expect(event.defaultPrevented).toBe(true);
		expect(values('first-name')).toEqual(['สมหญิง']);
		expect(values('last-name')).toEqual(['ใจดี']);
		expect(values('card-number')).toEqual(['1234567890123']);
	});

	it('fills the empty household address from the card, normalized', async () => {
		renderWalkInForm();
		expect(values('address-no')).toEqual(['']);

		dispatchCardRead();
		await tick();
		flushSync();

		expect(values('address-no')).toEqual(['99/1']);
		expect(values('village-no')).toEqual(['3 ซอย 5']);
	});

	it('asks which member to overwrite when every member already has data, and overwrite replaces member 1', async () => {
		await readTwoDifferentCards();

		expect(values('first-name')).toEqual(['สมหญิง']);
		expect(buttonByText('เพิ่มเป็นสมาชิกใหม่')).toBeDefined();
		expect(buttonByText('ยกเลิก')).toBeDefined();
		buttonByText('ทับคนที่ 1')!.click();
		await settle();

		expect(values('first-name')).toEqual(['สมชาย']);
		expect(values('last-name')).toEqual(['รักดี']);
		expect(values('card-number')).toEqual(['9876543210987']);
	});

	it('overwrite replaces member 1 with a fresh member: the previous person phone and nickname do not carry over', async () => {
		renderWalkInForm();
		dispatchCardRead(card);
		await settle();
		const typeInto = (suffix: string, value: string) => {
			const input = document.querySelector<HTMLInputElement>(`input[id$="${suffix}"]`)!;
			input.value = value;
			input.dispatchEvent(new Event('input', { bubbles: true }));
		};
		typeInto('phone', '0812345678');
		typeInto('nickname', 'หญิง');
		await settle();
		expect(values('phone')[0]).toBe('0812345678');
		expect(values('nickname')).toEqual(['หญิง']);

		dispatchCardRead(otherCard);
		await settle();
		buttonByText('ทับคนที่ 1')!.click();
		await settle();

		expect(values('first-name')).toEqual(['สมชาย']);
		expect(values('card-number')).toEqual(['9876543210987']);
		expect(values('phone')[0]).toBe('');
		expect(values('nickname')).toEqual(['']);
	});

	it('adds the card as a new member when staff choose add-as-new', async () => {
		await readTwoDifferentCards();

		buttonByText('เพิ่มเป็นสมาชิกใหม่')!.click();
		await settle();

		expect(values('first-name')).toEqual(['สมหญิง', 'สมชาย']);
		expect(values('card-number')).toEqual(['1234567890123', '9876543210987']);
	});

	it('leaves the form unchanged and forgets the card on cancel', async () => {
		await readTwoDifferentCards();

		buttonByText('ยกเลิก')!.click();
		await settle();

		expect(values('first-name')).toEqual(['สมหญิง']);
		expect(values('card-number')).toEqual(['1234567890123']);
		expect(buttonByText('เพิ่มเป็นสมาชิกใหม่')).toBeUndefined();
	});

	it('tells staff the card is already in the form and changes nothing', async () => {
		renderWalkInForm();
		dispatchCardRead(card);
		await settle();

		const event = dispatchCardRead(card);
		await settle();

		expect(event.defaultPrevented).toBe(true);
		expect(toast.info).toHaveBeenCalledWith('บัตรนี้อยู่ในฟอร์มแล้ว');
		expect(values('first-name')).toEqual(['สมหญิง']);
		expect(buttonByText('เพิ่มเป็นสมาชิกใหม่')).toBeUndefined();
	});

	describe('duplicate lookup on scan (D3)', () => {
		const found = { name: 'สมหญิง ใจดี', href: '/onsite/people/evacuee-profile-view/EV-1' };

		it('names the person found and goes to their page, placing nothing', async () => {
			const lookup = vi.fn(async () => found);
			renderWalkInForm({ findScannedCardDuplicate: lookup });

			dispatchCardRead(card);
			await settle();

			expect(lookup).toHaveBeenCalledWith('1234567890123');
			expect(document.body.textContent).toContain('สมหญิง ใจดี');
			buttonByText('ไปหน้าคนนั้น')!.click();
			await settle();

			expect(goto).toHaveBeenCalledWith(found.href);
			expect(values('first-name')).toEqual(['']);
			expect(values('card-number')).toEqual(['']);
		});

		it('places the card as usual when staff choose to continue registering', async () => {
			renderWalkInForm({ findScannedCardDuplicate: vi.fn(async () => found) });

			dispatchCardRead(card);
			await settle();
			expect(values('first-name')).toEqual(['']);
			buttonByText('ลงทะเบียนต่อ')!.click();
			await settle();

			expect(goto).not.toHaveBeenCalled();
			expect(values('first-name')).toEqual(['สมหญิง']);
			expect(values('card-number')).toEqual(['1234567890123']);
		});

		it('places nothing and forgets the card when the dialog is closed without choosing', async () => {
			renderWalkInForm({ findScannedCardDuplicate: vi.fn(async () => found) });

			dispatchCardRead(card);
			await settle();
			document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
			await settle();

			expect(buttonByText('ไปหน้าคนนั้น')).toBeUndefined();
			expect(values('first-name')).toEqual(['']);
			expect(goto).not.toHaveBeenCalled();
		});

		it('warns and places the card as usual when the lookup fails', async () => {
			renderWalkInForm({
				findScannedCardDuplicate: vi.fn(async () => {
					throw new Error('offline');
				})
			});

			const event = dispatchCardRead(card);
			await settle();

			expect(event.defaultPrevented).toBe(true);
			expect(toast.warning).toHaveBeenCalledWith(
				'ตรวจสอบรายชื่อซ้ำไม่สำเร็จ — ลงทะเบียนต่อได้ตามปกติ'
			);
			expect(values('first-name')).toEqual(['สมหญิง']);
		});

		it('places the card straight away when nobody is found', async () => {
			renderWalkInForm({ findScannedCardDuplicate: vi.fn(async () => null) });

			dispatchCardRead(card);
			await settle();

			expect(values('first-name')).toEqual(['สมหญิง']);
			expect(buttonByText('ไปหน้าคนนั้น')).toBeUndefined();
		});

		it('does not look up a card that is already in the form', async () => {
			const lookup = vi.fn(async () => null);
			renderWalkInForm({ findScannedCardDuplicate: lookup });
			dispatchCardRead(card);
			await settle();
			lookup.mockClear();

			dispatchCardRead(card);
			await settle();

			expect(lookup).not.toHaveBeenCalled();
			expect(toast.info).toHaveBeenCalledWith('บัตรนี้อยู่ในฟอร์มแล้ว');
		});
	});
});
