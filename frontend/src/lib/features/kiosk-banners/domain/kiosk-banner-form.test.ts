import { describe, expect, it } from 'vitest';
import {
	bannerFormToInput,
	bannerToFormValues,
	emptyKioskBannerForm,
	kioskBannerFormSchema,
	type KioskBannerFormValues
} from './kiosk-banner-form';
import { kioskBannerInputSchema } from './kiosk-banner';

const valid = (over: Partial<KioskBannerFormValues> = {}): KioskBannerFormValues => ({
	title: 'แจกอาหารกลางวัน',
	caption: '',
	duration_sec: 10,
	start_at: '2026-10-15T08:00',
	end_at: '2026-10-15T18:00',
	status: 'active',
	screen_type: 'compact',
	...over
});

const issuePaths = (values: unknown) => {
	const result = kioskBannerFormSchema.safeParse(values);
	return result.success ? [] : result.error.issues.map((i) => i.path.join('.'));
};

describe('kioskBannerFormSchema', () => {
	it('accepts a complete Bangkok-local form', () => {
		expect(kioskBannerFormSchema.safeParse(valid()).success).toBe(true);
	});

	it('puts the end-before-start message under end_at', () => {
		const result = kioskBannerFormSchema.safeParse(valid({ end_at: '2026-10-15T08:00' }));
		expect(result.success).toBe(false);
		const issue = result.error?.issues.find((i) => i.path[0] === 'end_at');
		expect(issue?.message).toBe('เวลาสิ้นสุดต้องหลังเวลาเริ่ม');
	});

	it('requires a title, a start and an end', () => {
		expect(issuePaths(valid({ title: '  ', start_at: '', end_at: '' }))).toEqual(
			expect.arrayContaining(['title', 'start_at', 'end_at'])
		);
	});

	it('rejects durations outside 3-60', () => {
		expect(issuePaths(valid({ duration_sec: 2 }))).toContain('duration_sec');
		expect(issuePaths(valid({ duration_sec: 61 }))).toContain('duration_sec');
	});

	it('rejects an unknown screen_type', () => {
		expect(issuePaths({ ...valid(), screen_type: 'landscape' })).toContain('screen_type');
	});

	it('rejects a caption over 200 characters', () => {
		expect(issuePaths(valid({ caption: 'ก'.repeat(201) }))).toContain('caption');
	});
});

describe('bannerFormToInput', () => {
	it('reads the local times as Asia/Bangkok and sends UTC ISO', () => {
		const input = bannerFormToInput(valid());
		expect(input.start_at).toBe('2026-10-15T01:00:00.000Z');
		expect(input.end_at).toBe('2026-10-15T11:00:00.000Z');
		expect(kioskBannerInputSchema.safeParse(input).success).toBe(true);
	});

	it('maps an empty caption to null and trims the title', () => {
		const input = bannerFormToInput(valid({ title: ' ป้าย ', caption: '  ' }));
		expect(input.title).toBe('ป้าย');
		expect(input.caption).toBeNull();
	});

	it('keeps a non-empty caption', () => {
		expect(bannerFormToInput(valid({ caption: 'ที่โรงอาหาร' })).caption).toBe('ที่โรงอาหาร');
	});
});

describe('bannerToFormValues', () => {
	it('turns a stored banner into Bangkok-local form values and back', () => {
		const stored = {
			title: 'ตรวจสุขภาพ',
			caption: null,
			duration_sec: 15,
			start_at: '2026-10-16T02:00:00.000Z',
			end_at: '2026-10-16T05:00:00.000Z',
			status: 'inactive' as const,
			screen_type: 'portrait' as const
		};
		const values = bannerToFormValues(stored);
		expect(values).toEqual({
			title: 'ตรวจสุขภาพ',
			caption: '',
			duration_sec: 15,
			start_at: '2026-10-16T09:00',
			end_at: '2026-10-16T12:00',
			status: 'inactive',
			screen_type: 'portrait'
		});
		expect(bannerFormToInput(values)).toEqual(stored);
	});
});

describe('emptyKioskBannerForm', () => {
	it('starts with the spec defaults and blank times', () => {
		expect(emptyKioskBannerForm()).toEqual({
			title: '',
			caption: '',
			duration_sec: 10,
			start_at: '',
			end_at: '',
			status: 'active',
			screen_type: 'compact'
		});
	});
});
