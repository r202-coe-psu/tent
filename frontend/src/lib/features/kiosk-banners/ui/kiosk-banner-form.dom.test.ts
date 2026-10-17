// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import type { KioskBannerSummary } from '../data/kiosk-banner.repository';
import KioskBannerForm from './kiosk-banner-form.svelte';
import type { KioskBannerSavePayload } from './kiosk-banner-save';

const stored: KioskBannerSummary = {
	_id: 'kiosk_banner:abc',
	_rev: '3-xyz',
	type: 'kiosk_banner',
	schema_v: 1,
	shelter_code: 'SH001',
	title: 'ตรวจสุขภาพฟรี',
	caption: 'ที่ห้องพยาบาล',
	order: 2,
	duration_sec: 15,
	start_at: '2026-10-16T02:00:00.000Z',
	end_at: '2026-10-16T05:00:00.000Z',
	status: 'inactive',
	created_at: '2026-10-14T00:00:00.000Z',
	updated_at: '2026-10-14T00:00:00.000Z',
	created_by: 'tester',
	image_content_type: 'image/png'
};

let instance: ReturnType<typeof mount> | null = null;
let onsave: Mock<(payload: KioskBannerSavePayload) => Promise<void>>;
const createObjectURL = vi.fn();
const revokeObjectURL = vi.fn();

function render(banner?: KioskBannerSummary, defaultScreen?: 'compact' | 'portrait') {
	instance = mount(KioskBannerForm, {
		target: document.body,
		props: { shelterCode: 'SH001', banner, defaultScreen, onsave }
	});
	flushSync();
}

const q = <T extends Element>(selector: string) => document.body.querySelector<T>(selector);
const field = (name: string) => q<HTMLInputElement>(`#banner-${name}`) as HTMLInputElement;

function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
	el.value = value;
	el.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
}

function pick(file: File) {
	const input = q<HTMLInputElement>('input[type="file"]') as HTMLInputElement;
	Object.defineProperty(input, 'files', { value: [file], configurable: true, writable: true });
	input.dispatchEvent(new Event('change', { bubbles: true }));
	flushSync();
}

function drop(file: File) {
	const zone = q<HTMLLabelElement>('label[for="banner-image"]') as HTMLLabelElement;
	const event = new Event('drop', { bubbles: true, cancelable: true });
	Object.defineProperty(event, 'dataTransfer', { value: { files: [file] } });
	zone.dispatchEvent(event);
	flushSync();
}

async function press(el: Element) {
	el.dispatchEvent(
		new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' })
	);
	el.dispatchEvent(
		new PointerEvent('pointerup', { bubbles: true, button: 0, pointerType: 'mouse' })
	);
	(el as HTMLElement).click();
	await tick();
	flushSync();
}

/** Portalled content lands at the end of `body`, so the newest match is the one just opened. */
const lastOf = (selector: string) =>
	[...document.body.querySelectorAll(selector)].at(-1) as Element;

/** Date: typed into the date picker. Time: hour and minute chosen in the time picker popover. */
async function setDateTime(name: 'start_at' | 'end_at', date: string, time: string) {
	type(field(name), date);
	const trigger = q(`#banner-${name}-time`) as HTMLElement;
	await press(trigger);
	const [hourSelect, minuteSelect] = lastOf('[data-slot="popover-content"]').querySelectorAll(
		'[data-slot="select-trigger"]'
	);
	for (const [select, part] of [
		[hourSelect, time.slice(0, 2)],
		[minuteSelect, time.slice(3, 5)]
	] as const) {
		await press(select);
		const option = [...lastOf('[role="listbox"]').querySelectorAll('[role="option"]')].find(
			(o) => o.textContent?.trim() === part
		) as HTMLElement;
		await press(option);
	}
}

const png = () => new File([new Uint8Array([137, 80, 78, 71])], 'a.png', { type: 'image/png' });

async function submit() {
	(q<HTMLButtonElement>('button[type="submit"]') as HTMLButtonElement).click();
	await vi.waitFor(() => flushSync());
	await tick();
	await new Promise((resolve) => setTimeout(resolve, 20));
	flushSync();
}

// happy-dom stores `input.files = undefined` (what Svelte's `bind:files` writes before a file is
// chosen) and then crashes in the `value` getter; browsers ignore the assignment.
const filesDescriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files');

beforeEach(() => {
	vi.clearAllMocks();
	Object.defineProperty(HTMLInputElement.prototype, 'files', {
		configurable: true,
		get: filesDescriptor?.get,
		set(value: FileList | null | undefined) {
			if (value) filesDescriptor?.set?.call(this, value);
		}
	});
	onsave = vi.fn<(payload: KioskBannerSavePayload) => Promise<void>>().mockResolvedValue(undefined);
	let n = 0;
	createObjectURL.mockImplementation(() => `blob:preview-${++n}`);
	URL.createObjectURL = createObjectURL;
	URL.revokeObjectURL = revokeObjectURL;
});
afterEach(async () => {
	if (filesDescriptor) Object.defineProperty(HTMLInputElement.prototype, 'files', filesDescriptor);
	if (instance) unmount(instance);
	instance = null;
	// bits-ui releases the body scroll lock on a 24 ms timer; let it run before happy-dom tears down.
	await new Promise((resolve) => setTimeout(resolve, 50));
	document.body.innerHTML = '';
});

function render_cleanup() {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
}

describe('KioskBannerForm', () => {
	it('shows the accepted types and size limit under the file field', () => {
		render();
		expect(document.body.textContent).toContain('รองรับ png / jpeg / webp ขนาดไม่เกิน 2 MB');
		expect(q('input[type="file"]')?.getAttribute('accept')).toBe('image/png,image/jpeg,image/webp');
	});

	it('shows the active shelter read-only and no current image on create', () => {
		render();
		expect(document.body.textContent).toContain('SH001');
		expect(q('[data-testid="banner-current-image"]')).toBeNull();
	});

	it('previews a chosen file at once and revokes the object URL when it changes or unmounts', () => {
		render();

		pick(png());
		expect(q('[data-testid="banner-new-image"]')?.getAttribute('src')).toBe('blob:preview-1');

		pick(png());
		expect(revokeObjectURL).toHaveBeenCalledWith('blob:preview-1');
		expect(q('[data-testid="banner-new-image"]')?.getAttribute('src')).toBe('blob:preview-2');

		unmount(instance as ReturnType<typeof mount>);
		instance = null;
		expect(revokeObjectURL).toHaveBeenCalledWith('blob:preview-2');
	});

	it('takes an image dropped on the drop box like a picked one', () => {
		render();

		drop(png());
		expect(q('[data-testid="banner-new-image"]')?.getAttribute('src')).toBe('blob:preview-1');
		expect(document.body.textContent).toContain('a.png');

		drop(new File(['x'], 'a.gif', { type: 'image/gif' }));
		expect(document.body.textContent).toContain('รองรับเฉพาะรูป png / jpeg / webp');
		expect(q('[data-testid="banner-new-image"]')).toBeNull();
	});

	it('rejects a wrong type client-side: message under the field, no preview', () => {
		render();

		pick(new File(['x'], 'a.gif', { type: 'image/gif' }));

		expect(document.body.textContent).toContain('รองรับเฉพาะรูป png / jpeg / webp');
		expect(q('[data-testid="banner-new-image"]')).toBeNull();
		expect(createObjectURL).not.toHaveBeenCalled();
	});

	it('edit mode fills the fields (Bangkok time) and shows the current image with its rev', () => {
		render(stored);

		expect(field('title').value).toBe('ตรวจสุขภาพฟรี');
		expect(field('start_at').value).toBe('16/10/2026');
		expect(q('#banner-start_at-time')?.textContent).toContain('09:00');
		expect(field('end_at').value).toBe('16/10/2026');
		expect(q('#banner-end_at-time')?.textContent).toContain('12:00');
		const current = q('[data-testid="banner-current-image"]');
		expect(current?.getAttribute('src')).toBe(
			'/api/back-office/kiosk-banners/kiosk_banner%3Aabc/image?v=3-xyz'
		);
	});

	it('edit mode shows the current and the new image side by side after choosing a file', () => {
		render(stored);
		pick(png());
		expect(q('[data-testid="banner-current-image"]')).not.toBeNull();
		expect(q('[data-testid="banner-new-image"]')).not.toBeNull();
	});

	it('requires an image when creating', async () => {
		render();
		type(field('title'), 'ป้ายใหม่');
		await setDateTime('start_at', '2026-10-15', '08:00');
		await setDateTime('end_at', '2026-10-15', '18:00');

		await submit();

		expect(onsave).not.toHaveBeenCalled();
		expect(document.body.textContent).toContain('เลือกรูปภาพแบนเนอร์');
	});

	it('shows the end-time error under the end field', async () => {
		render();
		type(field('title'), 'ป้ายใหม่');
		await setDateTime('start_at', '2026-10-15', '18:00');
		await setDateTime('end_at', '2026-10-15', '08:00');
		pick(png());

		await submit();

		expect(onsave).not.toHaveBeenCalled();
		const message = q('#banner-end_at-error');
		expect(message?.textContent).toContain('เวลาสิ้นสุดต้องหลังเวลาเริ่ม');
	});

	it('saves the mapped input and the image payload on create', async () => {
		render();
		type(field('title'), 'ป้ายใหม่');
		await setDateTime('start_at', '2026-10-15', '08:00');
		await setDateTime('end_at', '2026-10-15', '18:00');
		pick(png());

		await submit();

		expect(onsave).toHaveBeenCalledTimes(1);
		const payload = onsave.mock.calls[0][0];
		expect(payload.input).toMatchObject({
			title: 'ป้ายใหม่',
			caption: null,
			duration_sec: 10,
			start_at: '2026-10-15T01:00:00.000Z',
			end_at: '2026-10-15T11:00:00.000Z',
			status: 'active'
		});
		expect(payload.image).toMatchObject({ content_type: 'image/png' });
		expect(typeof payload.image?.data_base64).toBe('string');
	});

	it('keeps the stored image on edit when no new file is chosen', async () => {
		render(stored);

		await submit();

		expect(onsave).toHaveBeenCalledTimes(1);
		expect(onsave.mock.calls[0][0].image).toBeUndefined();
		expect(onsave.mock.calls[0][0].rev).toBe('3-xyz');
		expect(onsave.mock.calls[0][0].input.status).toBe('inactive');
	});

	it('opens the kiosk preview dialog from the form', async () => {
		render(stored);
		const button = [...document.body.querySelectorAll('button')].find((b) =>
			b.textContent?.includes('ดูตัวอย่างบน kiosk')
		) as HTMLButtonElement;

		button.click();
		await tick();
		flushSync();

		expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain(
			'ตัวอย่างบน kiosk'
		);
	});

	describe('screen type', () => {
		const radio = (type: string) =>
			q<HTMLButtonElement>(`[role="radio"][data-value="${type}"]`) as HTMLButtonElement;

		it('defaults to ตู้เล็ก on create, with the recommended size in the upload help', () => {
			render();
			expect(radio('compact').getAttribute('aria-checked')).toBe('true');
			expect(document.body.textContent).toContain(
				'แนะนำ 1024×600 px · รองรับ png / jpeg / webp ขนาดไม่เกิน 2 MB'
			);
		});

		it('switching to ตู้ใหญ่ updates the recommended size and saves screen_type portrait', async () => {
			render();
			radio('portrait').click();
			flushSync();
			expect(radio('portrait').getAttribute('aria-checked')).toBe('true');
			expect(document.body.textContent).toContain('แนะนำ 1080×1920 px');

			type(field('title'), 'ป้ายตู้ใหญ่');
			await setDateTime('start_at', '2026-10-15', '08:00');
			await setDateTime('end_at', '2026-10-15', '18:00');
			pick(png());
			await submit();

			expect(onsave).toHaveBeenCalledTimes(1);
			expect(onsave.mock.calls[0][0].input.screen_type).toBe('portrait');
		});

		it('create mode starts on the defaultScreen', () => {
			render(undefined, 'portrait');
			expect(radio('portrait').getAttribute('aria-checked')).toBe('true');
			expect(document.body.textContent).toContain('แนะนำ 1080×1920 px');
		});

		it('edit mode ignores defaultScreen', () => {
			render(stored, 'portrait');
			expect(radio('compact').getAttribute('aria-checked')).toBe('true');
		});

		it('edit mode shows a stored portrait banner as ตู้ใหญ่', () => {
			render({ ...stored, screen_type: 'portrait' });
			expect(radio('portrait').getAttribute('aria-checked')).toBe('true');
			expect(radio('compact').getAttribute('aria-checked')).toBe('false');
		});

		it('edit mode shows a legacy banner without screen_type as ตู้เล็ก', () => {
			render(stored);
			expect(radio('compact').getAttribute('aria-checked')).toBe('true');
		});

		it('shapes the image preview boxes like the chosen screen', () => {
			render({ ...stored, screen_type: 'portrait' });
			expect(q('[data-testid="banner-current-image"]')?.className).toContain('aspect-[9/16]');
			render_cleanup();
			render(stored);
			expect(q('[data-testid="banner-current-image"]')?.className).toContain('aspect-video');
		});
	});

	describe('order', () => {
		it('has no order input: the server assigns it and the reorder page changes it', () => {
			render();
			expect(q('#banner-order')).toBeNull();
			render_cleanup();
			render(stored);
			expect(q('#banner-order')).toBeNull();
		});

		it('does not send an order with the input', async () => {
			render(stored);
			await submit();
			expect(onsave.mock.calls[0][0].input).not.toHaveProperty('order');
		});
	});
});
