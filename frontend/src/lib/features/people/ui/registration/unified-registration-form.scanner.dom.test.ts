// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { QueryClient } from '@tanstack/svelte-query';
import { toast } from 'svelte-sonner';
import { goto } from '$app/navigation';
import UnifiedRegistrationFormHarness from './__fixtures__/unified-registration-form-harness.svelte';

/** Every progress-toast call in order, so a test reads as the sequence staff see. */
const toastLog = vi.hoisted(
	() => [] as { method: string; message: string | undefined; id: unknown }[]
);
vi.mock('svelte-sonner', () => {
	const logged = (method: string) =>
		vi.fn((message: string, options?: { id?: unknown }) => {
			toastLog.push({ method, message, id: options?.id });
		});
	return {
		toast: {
			loading: logged('loading'),
			success: logged('success'),
			error: logged('error'),
			info: logged('info'),
			warning: vi.fn(),
			dismiss: vi.fn((id?: unknown) => {
				toastLog.push({ method: 'dismiss', message: undefined, id });
			})
		}
	};
});
const saveImageSpy = vi.hoisted(() => vi.fn());
// The CouchDB image adapter is the system boundary: `useSaveImage` reaches it, not the barrel.
vi.mock('$lib/features/images/data/image.remote', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/features/images/data/image.remote')>();
	return {
		...actual,
		imageRepository: () => ({
			saveImage: saveImageSpy,
			getThumbnailUrl: async () => {
				throw new Error('no thumbnail in tests');
			}
		})
	};
});
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
	toastLog.length = 0;
	saveImageSpy.mockReset();
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

/** What staff saw, in order. Every call must target one and the same toast: one progress toast per card. */
const progress = () => {
	expect(new Set(toastLog.map((entry) => entry.id)).size).toBeLessThanOrEqual(1);
	return toastLog.map((entry) =>
		entry.method === 'dismiss' ? 'dismiss' : `${entry.method}: ${entry.message}`
	);
};
const dispatchScannerEvent = (type: string, detail: unknown = {}) => {
	const event = new CustomEvent(type, { detail, cancelable: true });
	window.dispatchEvent(event);
	return event;
};

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
		expect(progress()).toContain('info: บัตรนี้อยู่ในฟอร์มแล้ว');
		expect(values('first-name')).toEqual(['สมหญิง']);
		expect(buttonByText('เพิ่มเป็นสมาชิกใหม่')).toBeUndefined();
	});

	describe('reading popup', () => {
		const readingDialog = () =>
			document.querySelector<HTMLElement>('[data-testid="scanner-reading-dialog"]');

		it('opens a blocking popup while the card is read and closes it once the text arrives', async () => {
			renderWalkInForm();

			dispatchScannerEvent('scanner:card-reading');
			await settle();
			expect(readingDialog()?.textContent).toContain('กำลังอ่านบัตร…');

			dispatchCardRead();
			await settle();
			expect(readingDialog()).toBeNull();
		});

		it('closes the popup when the card could not be read', async () => {
			renderWalkInForm();

			dispatchScannerEvent('scanner:card-reading');
			await settle();
			dispatchScannerEvent('scanner:card-error', { code: 'READ_FAILED' });
			await settle();

			expect(readingDialog()).toBeNull();
		});

		it('never leaves the popup up when the client goes silent', async () => {
			vi.useFakeTimers();
			try {
				renderWalkInForm();
				dispatchScannerEvent('scanner:card-reading');
				flushSync();
				expect(readingDialog()).not.toBeNull();

				vi.advanceTimersByTime(20_000);
				flushSync();
				await vi.runOnlyPendingTimersAsync();
				flushSync();

				expect(readingDialog()).toBeNull();
			} finally {
				vi.useRealTimers();
			}
		});
	});

	describe('one progress toast per card', () => {
		const photoDetail = {
			citizen_id: card.citizen_id,
			photo_base64: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ=='
		};

		it('walks reading, filled-into-member, photo-read and done on a single toast', async () => {
			saveImageSpy.mockResolvedValue({ _id: 'image:card-1' });
			renderWalkInForm();

			const reading = dispatchScannerEvent('scanner:card-reading');
			expect(reading.defaultPrevented).toBe(true);
			dispatchCardRead();
			await settle();
			dispatchScannerEvent('scanner:card-photo', photoDetail);
			await settle();

			expect(progress()).toEqual([
				'dismiss',
				'loading: เติมข้อมูลสมาชิกคนที่ 1 แล้ว · กำลังอ่านรูป…',
				'success: อ่านบัตรเรียบร้อย'
			]);
		});

		it('hands the same toast to the already-in-form notice', async () => {
			renderWalkInForm();
			dispatchCardRead();
			await settle();
			toastLog.length = 0;

			dispatchScannerEvent('scanner:card-reading');
			dispatchCardRead();
			await settle();

			expect(progress()).toEqual(['dismiss', 'info: บัตรนี้อยู่ในฟอร์มแล้ว']);
		});

		it('dismisses the toast while staff choose in the overwrite dialog, and after cancel', async () => {
			renderWalkInForm();
			dispatchCardRead(card);
			await settle();
			toastLog.length = 0;

			dispatchScannerEvent('scanner:card-reading');
			dispatchCardRead(otherCard);
			await settle();
			expect(progress()).toEqual(['dismiss', 'dismiss']);
			buttonByText('ยกเลิก')!.click();
			await settle();

			expect(progress()).toEqual(['dismiss', 'dismiss']);
		});

		it('moves on to the member number chosen in the overwrite dialog', async () => {
			await readTwoDifferentCards();
			toastLog.length = 0;

			buttonByText('เพิ่มเป็นสมาชิกใหม่')!.click();
			await settle();

			expect(progress()).toEqual(['loading: เติมข้อมูลสมาชิกคนที่ 2 แล้ว · กำลังอ่านรูป…']);
		});

		it('dismisses the toast while the duplicate dialog is open', async () => {
			renderWalkInForm({
				findScannedCardDuplicate: vi.fn(async () => ({ name: 'สมหญิง ใจดี', href: '/x' }))
			});

			dispatchScannerEvent('scanner:card-reading');
			dispatchCardRead();
			await settle();

			expect(progress()).toEqual(['dismiss', 'dismiss']);
		});

		it('dismisses the toast when the photo matches nobody in the form', async () => {
			renderWalkInForm();
			dispatchCardRead();
			await settle();
			toastLog.length = 0;

			dispatchScannerEvent('scanner:card-photo', {
				...photoDetail,
				citizen_id: otherCard.citizen_id
			});
			await settle();

			expect(progress()).toEqual(['dismiss']);
		});

		it('dismisses the toast when the member changed before the upload finished', async () => {
			let finishUpload!: (saved: { _id: string }) => void;
			saveImageSpy.mockReturnValue(new Promise((resolve) => (finishUpload = resolve)));
			renderWalkInForm();
			dispatchCardRead();
			await settle();
			toastLog.length = 0;

			dispatchScannerEvent('scanner:card-photo', photoDetail);
			await settle();
			const input = document.querySelector<HTMLInputElement>('input[id$="card-number"]')!;
			input.value = '1111111111111';
			input.dispatchEvent(new Event('input', { bubbles: true }));
			await settle();
			finishUpload({ _id: 'image:card-1' });
			await settle();

			expect(progress()).toEqual(['dismiss']);
		});

		it('reports a failed photo upload on the same toast', async () => {
			saveImageSpy.mockRejectedValue(new Error('offline'));
			renderWalkInForm();
			dispatchCardRead();
			await settle();
			toastLog.length = 0;

			dispatchScannerEvent('scanner:card-photo', photoDetail);
			await settle();

			expect(progress()).toEqual(['error: บันทึกรูปจากบัตรไม่สำเร็จ']);
		});

		it('turns a card read failure into an error on the toast', async () => {
			renderWalkInForm();

			dispatchScannerEvent('scanner:card-reading');
			const event = dispatchScannerEvent('scanner:card-error', { code: 'READ_FAILED' });

			expect(event.defaultPrevented).toBe(true);
			expect(progress()).toEqual(['dismiss', 'error: อ่านบัตรไม่สำเร็จ ลองเสียบใหม่']);
		});

		it('turns a card photo read failure into an error on the toast', async () => {
			renderWalkInForm();

			const event = dispatchScannerEvent('scanner:card-error', { code: 'PHOTO_FAILED' });

			expect(event.defaultPrevented).toBe(true);
			expect(progress()).toEqual(['error: อ่านรูปจากบัตรไม่สำเร็จ']);
		});

		it('ignores a card error with an unknown code without acknowledging it', async () => {
			renderWalkInForm();

			const event = dispatchScannerEvent('scanner:card-error', { code: 'SOMETHING_NEW' });

			expect(event.defaultPrevented).toBe(false);
			expect(progress()).toEqual([]);
		});
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
			expect(progress()).toContain('info: บัตรนี้อยู่ในฟอร์มแล้ว');
		});
	});

	describe('card photo (D2: the photo belongs to the member with that citizen ID)', () => {
		const photoDetail = (citizenId: string) => ({
			citizen_id: citizenId,
			photo_base64: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ=='
		});
		const dispatchCardPhoto = (detail: unknown) => {
			const event = new CustomEvent('scanner:card-photo', { detail, cancelable: true });
			window.dispatchEvent(event);
			return event;
		};
		/** The face-photo dot in the member card header: shown once the member holds a photo. */
		const photoMarkers = () => document.querySelectorAll('span[aria-label="ภาพถ่ายใบหน้า"]');
		const typeInto = (suffix: string, value: string) => {
			const input = document.querySelector<HTMLInputElement>(`input[id$="${suffix}"]`)!;
			input.value = value;
			input.dispatchEvent(new Event('input', { bubbles: true }));
		};

		it('saves the photo as a JPEG for the form shelter and attaches it to the member with that ID', async () => {
			saveImageSpy.mockResolvedValue({ _id: 'image:card-1' });
			renderWalkInForm({ shelterCode: 'SH777' });
			dispatchCardRead(card);
			await settle();
			expect(photoMarkers()).toHaveLength(0);

			const event = dispatchCardPhoto(photoDetail(card.citizen_id));
			expect(event.defaultPrevented).toBe(true);
			await settle();

			expect(saveImageSpy).toHaveBeenCalledTimes(1);
			const [file, ctx] = saveImageSpy.mock.calls[0];
			expect(file).toBeInstanceOf(File);
			expect(file.type).toBe('image/jpeg');
			expect([...new Uint8Array(await file.arrayBuffer()).slice(0, 4)]).toEqual([
				0xff, 0xd8, 0xff, 0xe0
			]);
			expect(ctx).toMatchObject({ shelterCode: 'SH777' });
			expect(photoMarkers()).toHaveLength(1);
		});

		it('discards a photo whose citizen ID matches no member without uploading it', async () => {
			renderWalkInForm();
			dispatchCardRead(card);
			await settle();

			const event = dispatchCardPhoto(photoDetail(otherCard.citizen_id));
			await settle();

			expect(event.defaultPrevented).toBe(true);
			expect(saveImageSpy).not.toHaveBeenCalled();
			expect(photoMarkers()).toHaveLength(0);
		});

		it('discards the photo when the member ID number changed before the upload finished', async () => {
			let finishUpload!: (saved: { _id: string }) => void;
			saveImageSpy.mockReturnValue(new Promise((resolve) => (finishUpload = resolve)));
			renderWalkInForm();
			dispatchCardRead(card);
			await settle();

			dispatchCardPhoto(photoDetail(card.citizen_id));
			await settle();
			typeInto('card-number', '1111111111111');
			await settle();
			finishUpload({ _id: 'image:card-1' });
			await settle();

			expect(saveImageSpy).toHaveBeenCalledTimes(1);
			expect(photoMarkers()).toHaveLength(0);
		});

		it('attaches the photo to the member staff add from the dialog, even though it arrived while the dialog was open', async () => {
			saveImageSpy.mockResolvedValue({ _id: 'image:card-2' });
			await readTwoDifferentCards();

			dispatchCardPhoto(photoDetail(otherCard.citizen_id));
			await settle();
			expect(saveImageSpy).not.toHaveBeenCalled();
			toastLog.length = 0;
			buttonByText('เพิ่มเป็นสมาชิกใหม่')!.click();
			await settle();

			expect(saveImageSpy).toHaveBeenCalledTimes(1);
			expect(photoMarkers()).toHaveLength(1);
			expect(progress()).toEqual([
				'loading: เติมข้อมูลสมาชิกคนที่ 2 แล้ว · กำลังอ่านรูป…',
				'success: อ่านบัตรเรียบร้อย'
			]);
		});

		it('attaches the photo to the member overwritten from the dialog', async () => {
			saveImageSpy.mockResolvedValue({ _id: 'image:card-2' });
			await readTwoDifferentCards();

			dispatchCardPhoto(photoDetail(otherCard.citizen_id));
			await settle();
			buttonByText('ทับคนที่ 1')!.click();
			await settle();

			expect(saveImageSpy).toHaveBeenCalledTimes(1);
			expect(photoMarkers()).toHaveLength(1);
		});

		it('drops the held photo when staff cancel the dialog', async () => {
			await readTwoDifferentCards();

			dispatchCardPhoto(photoDetail(otherCard.citizen_id));
			await settle();
			buttonByText('ยกเลิก')!.click();
			await settle();

			expect(saveImageSpy).not.toHaveBeenCalled();
			expect(photoMarkers()).toHaveLength(0);
		});

		it('attaches the photo after staff continue past the duplicate dialog', async () => {
			saveImageSpy.mockResolvedValue({ _id: 'image:card-1' });
			renderWalkInForm({
				findScannedCardDuplicate: vi.fn(async () => ({ name: 'สมหญิง ใจดี', href: '/x' }))
			});
			dispatchCardRead(card);
			await settle();

			dispatchCardPhoto(photoDetail(card.citizen_id));
			await settle();
			expect(saveImageSpy).not.toHaveBeenCalled();
			buttonByText('ลงทะเบียนต่อ')!.click();
			await settle();

			expect(saveImageSpy).toHaveBeenCalledTimes(1);
			expect(photoMarkers()).toHaveLength(1);
		});

		it('keeps the already-in-form notice on screen when that card photo arrives, without re-uploading', async () => {
			saveImageSpy.mockResolvedValue({ _id: 'image:card-1' });
			renderWalkInForm();
			dispatchCardRead(card);
			await settle();
			dispatchCardPhoto(photoDetail(card.citizen_id));
			await settle();
			toastLog.length = 0;

			dispatchScannerEvent('scanner:card-reading');
			dispatchCardRead(card);
			await settle();
			const event = dispatchCardPhoto(photoDetail(card.citizen_id));
			await settle();

			expect(event.defaultPrevented).toBe(true);
			expect(saveImageSpy).toHaveBeenCalledTimes(1);
			expect(progress()).toEqual(['dismiss', 'info: บัตรนี้อยู่ในฟอร์มแล้ว']);
		});

		it('quietly fills a missing photo when a card already in the form is read again', async () => {
			saveImageSpy.mockResolvedValue({ _id: 'image:card-1' });
			renderWalkInForm();
			dispatchCardRead(card);
			await settle();
			toastLog.length = 0;

			dispatchScannerEvent('scanner:card-reading');
			dispatchCardRead(card);
			await settle();
			dispatchCardPhoto(photoDetail(card.citizen_id));
			await settle();

			expect(saveImageSpy).toHaveBeenCalledTimes(1);
			expect(photoMarkers()).toHaveLength(1);
			expect(progress()).toEqual(['dismiss', 'info: บัตรนี้อยู่ในฟอร์มแล้ว']);
		});

		it('ignores a malformed photo event without acknowledging it', async () => {
			renderWalkInForm();
			dispatchCardRead(card);
			await settle();

			const event = dispatchCardPhoto({ citizen_id: card.citizen_id, photo_base64: 'nope' });
			await settle();

			expect(event.defaultPrevented).toBe(false);
			expect(saveImageSpy).not.toHaveBeenCalled();
		});
	});
});
