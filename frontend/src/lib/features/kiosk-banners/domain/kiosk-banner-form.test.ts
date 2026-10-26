import { describe, expect, it } from 'vitest';
import {
	bannerFormToInput,
	bannerToFormValues,
	emptyKioskBannerForm,
	kioskBannerFormSchema,
	type KioskBannerFormValues
} from './kiosk-banner-form';
import { kioskBannerInputSchema } from './kiosk-banner';

const GROUP = 'kiosk_banner_group:A';

const valid = (over: Partial<KioskBannerFormValues> = {}): KioskBannerFormValues => ({
	group_id: GROUP,
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

	it('requires a banner group, reported under group_id', () => {
		expect(issuePaths(valid({ group_id: '' }))).toEqual(['group_id']);
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

	it('carries the chosen group into the API input', () => {
		expect(bannerFormToInput(valid({ group_id: 'kiosk_banner_group:B' })).group_id).toBe(
			'kiosk_banner_group:B'
		);
	});

	it('keeps a non-empty caption', () => {
		expect(bannerFormToInput(valid({ caption: 'ที่โรงอาหาร' })).caption).toBe('ที่โรงอาหาร');
	});
});

describe('bannerToFormValues', () => {
	it('turns a stored banner into Bangkok-local form values and back', () => {
		const stored = {
			group_id: GROUP,
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
			group_id: GROUP,
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

	it('prefills an empty group for a v1 banner that has none', () => {
		const legacy = {
			title: 'เดิม',
			caption: null,
			duration_sec: 10,
			start_at: '2026-10-16T02:00:00.000Z',
			end_at: '2026-10-16T05:00:00.000Z',
			status: 'active' as const
		};
		expect(bannerToFormValues(legacy).group_id).toBe('');
	});
});

describe('emptyKioskBannerForm', () => {
	it('starts with the spec defaults and blank times', () => {
		expect(emptyKioskBannerForm()).toEqual({
			group_id: '',
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
