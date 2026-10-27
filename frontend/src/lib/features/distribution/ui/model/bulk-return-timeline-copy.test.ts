import { describe, expect, it } from 'vitest';
import {
	formatSkippedDocIds,
	poolTimelineEmptyLabel,
	poolTimelineSkippedBadge,
	poolTimelineSkippedNotice
} from './bulk-return-timeline-copy';

describe('poolTimelineSkippedNotice', () => {
	it('interpolates the skipped count', () => {
		expect(poolTimelineSkippedNotice(3)).toBe(
			'พบเอกสารประวัติของกองนี้ที่ข้อมูลไม่ถูกต้อง 3 รายการ ระบบข้ามไว้ไม่แสดง ประวัติอาจไม่ครบ — ติดต่อผู้ดูแลระบบ'
		);
	});
});

describe('poolTimelineSkippedBadge', () => {
	it('interpolates the skipped count', () => {
		expect(poolTimelineSkippedBadge(2)).toBe('ข้าม 2 รายการ');
	});
});

describe('poolTimelineEmptyLabel', () => {
	it('says there is no history when nothing was skipped', () => {
		expect(poolTimelineEmptyLabel(0)).toBe('ยังไม่มีประวัติ');
	});

	it('says nothing displayable when docs were skipped', () => {
		expect(poolTimelineEmptyLabel(1)).toBe('ไม่มีประวัติที่แสดงได้');
	});
});

describe('formatSkippedDocIds', () => {
	it('joins ids with a comma and space', () => {
		expect(formatSkippedDocIds([{ _id: 'a' }, { _id: 'b' }])).toBe('a, b');
	});

	it('drops empty ids', () => {
		expect(formatSkippedDocIds([{ _id: 'a' }, { _id: '' }, { _id: 'c' }])).toBe('a, c');
	});

	it('returns an empty string for an empty array', () => {
		expect(formatSkippedDocIds([])).toBe('');
	});
});
