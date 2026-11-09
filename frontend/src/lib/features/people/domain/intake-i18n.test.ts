import { describe, expect, it } from 'vitest';
import {
	ZONE_KIND_LABELS,
	formatQueueWait,
	nextQueueLabelText,
	nextQueueLabelsEn,
	zoneKindLabelsByLanguage
} from './intake-pipeline';
import {
	INTAKE_SEARCH_PLACEHOLDER,
	NEW_REGISTRATION_CTA_LABEL,
	POOL_CLAIM_FORBIDDEN_HINT,
	intakeSearchCopyByLanguage,
	shelterHitStatusLabel
} from './intake-search';
import { PRIMARY_CONTACT_LABEL, memberCardLabel } from './unified-registration';
import {
	DEFAULT_HOUSING_TYPE_ITEMS_EN,
	DEFAULT_HOUSING_TYPE_ITEMS_TH,
	defaultHousingTypeItems
} from './housing-type-ui';

const sortedKeys = (o: object) => Object.keys(o).sort();
const hasThai = (v: unknown) => /[฀-๿]/.test(JSON.stringify(v));

describe('intake pipeline copy by language', () => {
	it('next-queue labels: Thai passes through, English maps every Thai value', () => {
		expect(nextQueueLabelText('รอแพทย์')).toBe('รอแพทย์');
		expect(nextQueueLabelText('รอแพทย์', 'en')).toBe('Awaiting doctor');
		expect(nextQueueLabelText('รอโซน', 'en')).toBe('Awaiting zone');
		expect(nextQueueLabelText('รอยืนยันถึงโซน', 'en')).toBe('Awaiting arrival confirmation');
		expect(nextQueueLabelText('พักแล้ว', 'en')).toBe('Settled in');
		expect(nextQueueLabelText('—', 'en')).toBe('—');
		expect(hasThai(Object.values(nextQueueLabelsEn))).toBe(false);
		expect(sortedKeys(nextQueueLabelsEn)).toHaveLength(5);
	});

	it('zone kind labels: Thai is the original map, English has the same keys', () => {
		expect(zoneKindLabelsByLanguage.th).toBe(ZONE_KIND_LABELS);
		expect(sortedKeys(zoneKindLabelsByLanguage.en)).toEqual(sortedKeys(ZONE_KIND_LABELS));
		expect(zoneKindLabelsByLanguage.en.quarantine).toBe('Quarantine zone (watch-list symptoms)');
		expect(zoneKindLabelsByLanguage.en.general).toBe('General zone');
	});

	it('formatQueueWait keeps Thai by default and speaks English on request', () => {
		const now = new Date('2026-01-01T12:00:00Z');
		const ago = (min: number) => new Date(now.getTime() - min * 60_000).toISOString();
		expect(formatQueueWait(ago(5), now)).toBe('รอ 5 นาที');
		expect(formatQueueWait(ago(0), now, 'en')).toBe('Just joined');
		expect(formatQueueWait(ago(5), now, 'en')).toBe('Waiting 5 min');
		expect(formatQueueWait(ago(130), now, 'en')).toBe('Waiting 2 hr 10 min');
		expect(formatQueueWait(ago(120), now, 'en')).toBe('Waiting 2 hr');
		expect(formatQueueWait(ago(27 * 60), now, 'en')).toBe('Waiting 1 day 3 hr');
		expect(formatQueueWait(ago(48 * 60), now, 'en')).toBe('Waiting 2 days');
		expect(formatQueueWait(null, now, 'en')).toBe('—');
	});
});

describe('intake search copy by language', () => {
	it('Thai copy is the existing constants', () => {
		expect(intakeSearchCopyByLanguage.th.searchPlaceholder).toBe(INTAKE_SEARCH_PLACEHOLDER);
		expect(intakeSearchCopyByLanguage.th.newRegistrationCta).toBe(NEW_REGISTRATION_CTA_LABEL);
		expect(intakeSearchCopyByLanguage.th.poolClaimForbiddenHint).toBe(POOL_CLAIM_FORBIDDEN_HINT);
	});

	it('English copy covers every Thai key with English text', () => {
		const { th, en } = intakeSearchCopyByLanguage;
		expect(sortedKeys(en)).toEqual(sortedKeys(th));
		expect(hasThai(en)).toBe(false);
		expect(en.reportInCta).toBe('Report in');
		expect(en.newRegistrationCta).toBe('+ New registration');
		expect(en.overrideCancel).toBe('Cancel');
	});

	it('shelterHitStatusLabel follows the language', () => {
		expect(shelterHitStatusLabel('active')).toBe('เข้าพักแล้ว');
		expect(shelterHitStatusLabel('active', 'en')).toBe('Checked in');
	});
});

describe('unified registration card labels', () => {
	it('memberCardLabel', () => {
		expect(memberCardLabel(0)).toBe(PRIMARY_CONTACT_LABEL);
		expect(memberCardLabel(2)).toBe('สมาชิก 3');
		expect(memberCardLabel(0, 'en')).toBe('Primary contact');
		expect(memberCardLabel(2, 'en')).toBe('Member 3');
	});
});

describe('housing type default items', () => {
	it('Thai is the original list, English mirrors its values in order', () => {
		expect(defaultHousingTypeItems('th')).toBe(DEFAULT_HOUSING_TYPE_ITEMS_TH);
		expect(defaultHousingTypeItems()).toBe(DEFAULT_HOUSING_TYPE_ITEMS_TH);
		expect(DEFAULT_HOUSING_TYPE_ITEMS_EN.map((i) => i.value)).toEqual(
			DEFAULT_HOUSING_TYPE_ITEMS_TH.map((i) => i.value)
		);
		expect(defaultHousingTypeItems('en')).toBe(DEFAULT_HOUSING_TYPE_ITEMS_EN);
		expect(DEFAULT_HOUSING_TYPE_ITEMS_EN.find((i) => i.value === 'apartment_dorm')?.label).toBe(
			'Apartment / dormitory'
		);
		expect(hasThai(DEFAULT_HOUSING_TYPE_ITEMS_EN)).toBe(false);
	});
});
