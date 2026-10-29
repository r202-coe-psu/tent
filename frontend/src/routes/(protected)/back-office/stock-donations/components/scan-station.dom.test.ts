// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { THAI_MOBILE_PHONE_MESSAGE } from '$lib/db/model';
import ScanStation from './scan-station.svelte';

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
const empty = { data: [] as unknown[], isLoading: false };

vi.mock('$lib/features/supply', () => ({ useSupplyItems: () => empty }));
vi.mock('$lib/features/shelters', () => ({ useShelters: () => empty }));
vi.mock('$lib/features/catalog', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/catalog')>()),
	useItemMasters: () => empty,
	useUnitsOfMeasure: () => empty
}));
vi.mock('$lib/features/operations', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/operations')>()),
	useStoragePoints: () => ({ points: [] })
}));
vi.mock('$lib/db/shelter', () => ({ getShelterCode: () => 'SH001' }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('svelte-sonner', () => ({ toast: toastMock }));

let instance: ReturnType<typeof mount> | null = null;

async function settle() {
	for (let i = 0; i < 3; i++) {
		flushSync();
		await tick();
	}
}

async function render() {
	instance = mount(ScanStation, { target: document.body, props: { initialView: 'walkin' } });
	await settle();
}

async function type(id: string, value: string) {
	const input = document.getElementById(id) as HTMLInputElement;
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	await settle();
	return input;
}

const save = () =>
	[...document.querySelectorAll<HTMLButtonElement>('[data-testid="walkin-footer"] button')].find(
		(b) => b.textContent?.includes('บันทึก')
	)!;

afterEach(async () => {
	vi.unstubAllGlobals();
	toastMock.error.mockReset();
	if (instance) unmount(instance);
	instance = null;
	await new Promise((resolve) => setTimeout(resolve, 50));
	document.body.innerHTML = '';
});

describe('scan-station walk-in', () => {
	it('stacks the footer buttons full-width on mobile', async () => {
		await render();
		const footer = document.querySelector('[data-testid="walkin-footer"]')!;
		expect(footer.className).toContain('flex-col-reverse');
		expect(footer.className).toContain('sm:flex-row');
		expect(footer.className).toContain('sm:justify-end');
		for (const button of footer.querySelectorAll('button')) {
			expect(button.className).toContain('w-full');
			expect(button.className).toContain('sm:w-auto');
		}
	});

	it('starts the received quantity of a walk-in line at 0', async () => {
		await render();
		const qty = document.querySelector<HTMLInputElement>('[id^="walkin-qty-"]')!;
		expect(qty.value).toBe('0');
	});

	it('clears letters typed into an empty phone field instead of leaving them on screen', async () => {
		await render();

		const phone = await type('donor-phone-input', 'ฟกหดน่หกด่');
		expect(phone.value).toBe('');

		await type('donor-phone-input', '08');
		const after = await type('donor-phone-input', '08abc');
		expect(after.value).toBe('08');
	});

	it('filters phone typing, shows the inline error and never calls fetch when invalid', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		await render();
		const phone = await type('donor-phone-input', '089-abc');
		expect(phone.value).toBe('089');
		expect(phone.getAttribute('inputmode')).toBe('numeric');
		expect(phone.placeholder).toBe('เช่น 0891234567');

		await type('donor-name-input', 'สมชาย');
		// Not shown while typing — only once the field is left or a save is tried.
		expect(document.querySelector('[data-testid="walkin-phone-error"]')).toBeNull();
		save().click();
		await settle();

		const message = THAI_MOBILE_PHONE_MESSAGE;
		expect(document.querySelector('[data-testid="walkin-phone-error"]')?.textContent?.trim()).toBe(
			message
		);
		expect(fetchMock).not.toHaveBeenCalled();
		// A blocked save says why and takes the user to the field, which may be off-screen.
		expect(toastMock.error).toHaveBeenCalledWith(message);
		expect(document.activeElement?.id).toBe('donor-phone-input');
		expect(phone.getAttribute('aria-describedby')).toBe('donor-phone-error');
		toastMock.error.mockReset();
		await type('donor-phone-input', '0891234567');
		expect(document.querySelector('[data-testid="walkin-phone-error"]')).toBeNull();
		save().click();
		await settle();
		expect(toastMock.error).toHaveBeenCalledWith(expect.stringContaining('รายการสิ่งของ'));
	});
});
