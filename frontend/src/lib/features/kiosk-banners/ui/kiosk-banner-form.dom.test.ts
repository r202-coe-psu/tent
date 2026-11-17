// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { toast } from 'svelte-sonner';
import type { KioskBannerSummary } from '../data/kiosk-banner.repository';
import KioskBannerForm from './kiosk-banner-form.svelte';
import { TemplateExportError, exportTemplatePng } from './kiosk-banner-template-export';
import { prepareTemplateLogo } from './kiosk-banner-template-logo';
import type { KioskBannerSavePayload } from './kiosk-banner-save';

vi.mock('svelte-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('./kiosk-banner-template-export', async (importOriginal) => ({
	...(await importOriginal<typeof import('./kiosk-banner-template-export')>()),
	exportTemplatePng: vi.fn()
}));
// The real one shrinks through a canvas, which happy-dom cannot draw.
vi.mock('./kiosk-banner-template-logo', () => ({ prepareTemplateLogo: vi.fn() }));

const exported = { content_type: 'image/png', data_base64: 'RVhQT1JURUQ=' };

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

const GROUP_A = 'kiosk_banner_group:aaa';
const GROUP_B = 'kiosk_banner_group:bbb';
const groups = [
	{ _id: GROUP_A, name: 'โถงทางเข้า' },
	{ _id: GROUP_B, name: 'ห้องพยาบาล' }
];

let instance: ReturnType<typeof mount> | null = null;
let onsave: Mock<(payload: KioskBannerSavePayload) => Promise<void>>;
const createObjectURL = vi.fn();
const revokeObjectURL = vi.fn();

function render(
	banner?: KioskBannerSummary,
	defaultScreen?: 'compact' | 'portrait',
	extra: { groups?: { _id: string; name: string }[]; defaultGroupId?: string } = {
		defaultGroupId: GROUP_A
	}
) {
	instance = mount(KioskBannerForm, {
		target: document.body,
		props: { shelterCode: 'SH001', banner, defaultScreen, groups, ...extra, onsave }
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

const grouped: KioskBannerSummary = { ...stored, group_id: GROUP_B };

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
	vi.mocked(exportTemplatePng).mockResolvedValue(exported);
	vi.mocked(prepareTemplateLogo).mockImplementation(async (file) => ({ ok: true, file }));
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
			group_id: GROUP_A,
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
		render(grouped);

		await submit();

		expect(onsave).toHaveBeenCalledTimes(1);
		expect(onsave.mock.calls[0][0].input.group_id).toBe(GROUP_B);
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

	describe('banner group', () => {
		const trigger = () => q<HTMLButtonElement>('#banner-group_id') as HTMLButtonElement;

		async function fillAndSubmit() {
			type(field('title'), 'ป้ายใหม่');
			await setDateTime('start_at', '2026-10-15', '08:00');
			await setDateTime('end_at', '2026-10-15', '18:00');
			pick(png());
			await submit();
		}

		it('is pre-selected from defaultGroupId on create', () => {
			render(undefined, undefined, { defaultGroupId: GROUP_B });
			expect(trigger().textContent).toContain('ห้องพยาบาล');
		});

		it('is pre-selected from the banner on edit', () => {
			render(grouped);
			expect(trigger().textContent).toContain('ห้องพยาบาล');
		});

		it('does not save without a group and asks to choose one', async () => {
			render(undefined, undefined, {});

			await fillAndSubmit();

			expect(onsave).not.toHaveBeenCalled();
			expect(document.body.textContent).toContain('เลือกกลุ่มแบนเนอร์');
		});

		it('saves the group chosen from the select', async () => {
			render(undefined, undefined, {});
			await press(trigger());
			const option = [...lastOf('[role="listbox"]').querySelectorAll('[role="option"]')].find((o) =>
				o.textContent?.includes('โถงทางเข้า')
			) as HTMLElement;
			await press(option);

			await fillAndSubmit();

			expect(onsave).toHaveBeenCalledTimes(1);
			expect(onsave.mock.calls[0][0].input.group_id).toBe(GROUP_A);
		});

		it('hints to create a group first, linking to the new-group page, when there are none', () => {
			render(undefined, undefined, { groups: [] });
			expect(document.body.textContent).toContain('ยังไม่มีกลุ่มแบนเนอร์ — สร้างกลุ่มก่อน');
			expect(
				q<HTMLAnchorElement>('a[href$="/back-office/kiosks/banners/groups/new"]')
			).not.toBeNull();
		});

		it('tells the editor of an ungrouped (v1) banner to choose a group before saving', async () => {
			render(stored);
			expect(document.body.textContent).toContain(
				'แบนเนอร์นี้ยังไม่อยู่ในกลุ่ม เลือกกลุ่มก่อนบันทึก'
			);

			await submit();

			expect(onsave).not.toHaveBeenCalled();
		});
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
	});

	describe('template mode', () => {
		const templated: KioskBannerSummary = {
			...stored,
			schema_v: 4,
			group_id: GROUP_B,
			template: {
				heading: 'ปิดถนนชั่วคราว',
				body: 'ใช้เส้นทางสำรอง',
				align: 'left',
				bg_color: '#000000',
				text_color: '#ffffff',
				image: 'template_image'
			}
		};

		const modeButton = (label: string) =>
			[...document.body.querySelectorAll('button')].find(
				(b) => b.textContent?.trim() === label
			) as HTMLButtonElement;
		const swatch = (group: string, color: string) =>
			q<HTMLButtonElement>(
				`[role="group"][aria-label="${group}"] button[aria-label="${color}"]`
			) as HTMLButtonElement;
		const heading = () => q<HTMLInputElement>('#banner-template-heading') as HTMLInputElement;
		const body = () => q<HTMLTextAreaElement>('#banner-template-body') as HTMLTextAreaElement;
		const canvas = () => q('[data-testid="banner-template-canvas"]') as HTMLElement;
		const WARNING = 'สีตัวอักษรกับสีพื้นอ่านยาก';

		function useTemplate() {
			modeButton('สร้างจาก template').click();
			flushSync();
		}

		async function fillBase() {
			type(field('title'), 'ป้ายจาก template');
			await setDateTime('start_at', '2026-10-15', '08:00');
			await setDateTime('end_at', '2026-10-15', '18:00');
		}

		it('saves the structured template and the exported PNG as the image', async () => {
			render();
			useTemplate();
			type(heading(), 'ประกาศสำคัญ');
			type(body(), 'บรรทัดแรก\nบรรทัดสอง');
			swatch('สีพื้นหลัง', 'แดง').click();
			flushSync();
			type(q<HTMLInputElement>('#banner-template-text_color-hex') as HTMLInputElement, '#AA00FF');
			await fillBase();

			await submit();

			expect(onsave).toHaveBeenCalledTimes(1);
			const payload = onsave.mock.calls[0][0];
			expect(payload.input.template).toEqual({
				heading: 'ประกาศสำคัญ',
				body: 'บรรทัดแรก\nบรรทัดสอง',
				align: 'center',
				bg_color: '#b91c1c',
				text_color: '#aa00ff',
				image: null
			});
			expect(payload.image).toEqual(exported);
			expect(payload.templateImage).toBeUndefined();
			expect(exportTemplatePng).toHaveBeenCalledWith(expect.any(HTMLElement), 'compact');
		});

		it('sends a chosen logo as templateImage and points the template at it', async () => {
			render();
			useTemplate();
			type(heading(), 'ประกาศสำคัญ');
			pick(png());
			await fillBase();

			await submit();

			expect(onsave).toHaveBeenCalledTimes(1);
			const payload = onsave.mock.calls[0][0];
			expect(payload.templateImage).toMatchObject({ content_type: 'image/png' });
			expect(payload.input.template?.image).toBe('template_image');
		});

		it('does not save a template with neither heading nor body', async () => {
			render();
			useTemplate();
			await fillBase();

			await submit();

			expect(onsave).not.toHaveBeenCalled();
			expect(exportTemplatePng).not.toHaveBeenCalled();
			expect(document.body.textContent).toContain('ระบุหัวข้อหรือเนื้อหาประกาศ');
		});

		it('toasts and does not save when the PNG cannot be rendered', async () => {
			vi.mocked(exportTemplatePng).mockRejectedValue(new Error('boom'));
			render();
			useTemplate();
			type(heading(), 'ประกาศสำคัญ');
			await fillBase();

			await submit();

			expect(onsave).not.toHaveBeenCalled();
			expect(toast.error).toHaveBeenCalledWith('สร้างรูปประกาศไม่สำเร็จ');
		});

		it('toasts the actionable reason when the PNG is too large or the logo did not load', async () => {
			const reason = 'รูปประกาศใหญ่เกิน 2 MB ลองใช้รูป/โลโก้ที่เรียบขึ้นหรือลบรูปออก';
			vi.mocked(exportTemplatePng).mockRejectedValue(new TemplateExportError(reason));
			render();
			useTemplate();
			type(heading(), 'ประกาศสำคัญ');
			await fillBase();

			await submit();

			expect(onsave).not.toHaveBeenCalled();
			expect(toast.error).toHaveBeenCalledWith(reason);
		});

		it('warns when the text and background colours are hard to read, and only then', () => {
			render();
			useTemplate();
			expect(document.body.textContent).not.toContain(WARNING);

			type(q<HTMLInputElement>('#banner-template-text_color-hex') as HTMLInputElement, '#1e3a8a');
			expect(document.body.textContent).toContain(WARNING);

			swatch('สีตัวอักษร', 'เหลือง').click();
			flushSync();
			expect(document.body.textContent).not.toContain(WARNING);
		});

		it('opens a template banner in template mode with its fields and stored logo', async () => {
			render(templated);

			expect(heading().value).toBe('ปิดถนนชั่วคราว');
			expect(body().value).toBe('ใช้เส้นทางสำรอง');
			expect(swatch('สีพื้นหลัง', 'ดำ').getAttribute('aria-pressed')).toBe('true');
			expect(canvas().querySelector('img')?.getAttribute('src')).toBe(
				'/api/back-office/kiosk-banners/kiosk_banner%3Aabc/template-image?v=3-xyz'
			);

			await submit();

			expect(onsave).toHaveBeenCalledTimes(1);
			const payload = onsave.mock.calls[0][0];
			expect(payload.input.template?.heading).toBe('ปิดถนนชั่วคราว');
			expect(payload.input.template?.image).toBe('template_image');
			expect(payload.templateImage).toBeUndefined();
			expect(payload.image).toEqual(exported);
			expect(payload.rev).toBe('3-xyz');
		});

		it('keeps the stored logo after an invalid pick, and toasts instead of saving', async () => {
			vi.mocked(prepareTemplateLogo).mockResolvedValue({
				ok: false,
				error: 'รูป/โลโก้ต้องมีขนาดไม่เกิน 512 KB'
			});
			render(templated);
			pick(png());

			await vi.waitFor(() =>
				expect(document.body.textContent).toContain('รูป/โลโก้ต้องมีขนาดไม่เกิน 512 KB')
			);
			expect(canvas().querySelector('img')?.getAttribute('src')).toContain('/template-image');

			await submit();

			expect(onsave).not.toHaveBeenCalled();
			expect(exportTemplatePng).not.toHaveBeenCalled();
			expect(toast.error).toHaveBeenCalledWith('รูป/โลโก้ต้องมีขนาดไม่เกิน 512 KB');
			expect(document.activeElement?.id).toBe('banner-template-image');
		});

		it('sends template.image null once the stored logo is removed', async () => {
			render(templated);
			const remove = [...document.body.querySelectorAll('button')].find((b) =>
				b.textContent?.includes('ลบรูป/โลโก้')
			) as HTMLButtonElement;
			remove.click();
			flushSync();

			await submit();

			expect(onsave.mock.calls[0][0].input.template?.image).toBeNull();
			expect(onsave.mock.calls[0][0].templateImage).toBeUndefined();
		});

		it('shows the heading and body as literal text, never as markup', () => {
			render();
			useTemplate();
			type(heading(), '<b>ด่วน</b>');
			type(body(), '<img src=x onerror=alert(1)>');

			expect(canvas().textContent).toContain('<b>ด่วน</b>');
			expect(canvas().textContent).toContain('<img src=x onerror=alert(1)>');
			expect(canvas().querySelector('b')).toBeNull();
			expect(canvas().querySelector('img')).toBeNull();
		});

		it('keeps what was typed when switching between upload and template', () => {
			render();
			useTemplate();
			type(heading(), 'ประกาศสำคัญ');

			modeButton('อัปโหลดรูป').click();
			flushSync();
			expect(q('#banner-template-heading')).toBeNull();
			expect(q('label[for="banner-image"]')).not.toBeNull();

			useTemplate();
			expect(heading().value).toBe('ประกาศสำคัญ');
		});
	});
});
