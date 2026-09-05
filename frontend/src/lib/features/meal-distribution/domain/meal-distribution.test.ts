import { describe, it, expect } from 'vitest';
import {
	filterMenusByTag,
	searchRecipients,
	hasReceivedMenu,
	recipientMatchesMenu,
	sessionServedTotal,
	quotaPercent,
	type MealMenuItem,
	type MealRecipient,
	type MealDistributionTransaction,
	type MealDistributionSession
} from './meal-distribution';

function menu(over: Partial<MealMenuItem> = {}): MealMenuItem {
	return {
		id: 'm-1',
		title: 'ข้าวสวย + ไข่ต้ม',
		batchCode: 'BATCH-1',
		cookTime: '10:00 น.',
		target: 10,
		served: 0,
		tags: ['Everyone', 'ปกติ'],
		status: 'ready',
		...over
	};
}

function recipient(over: Partial<MealRecipient> = {}): MealRecipient {
	return {
		id: 'EV-1',
		name: 'นายทดสอบ ใจดี',
		age: 30,
		nationalId: '1100200342121',
		phone: '081-234-5678',
		zone: 'A',
		bed: 'A-01',
		householdId: null,
		dietaryTags: ['ปกติ'],
		wristbandCode: 'WRISTBAND-EV-1',
		...over
	};
}

describe('filterMenusByTag', () => {
	it('returns every menu for the "ทั้งหมด" filter', () => {
		const menus = [menu({ id: 'a' }), menu({ id: 'b', tags: ['Halal'] })];
		expect(filterMenusByTag(menus, 'ทั้งหมด')).toHaveLength(2);
	});

	it('matches Halal menus tagged either Halal or อิสลาม', () => {
		const menus = [
			menu({ id: 'a', tags: ['Halal'] }),
			menu({ id: 'b', tags: ['อิสลาม'] }),
			menu({ id: 'c', tags: ['Everyone'] })
		];
		const result = filterMenusByTag(menus, 'Halal (ฮาลาล)');
		expect(result.map((m) => m.id)).toEqual(['a', 'b']);
	});

	it('matches vulnerable-group menus tagged เด็กเล็ก or ผู้สูงอายุ', () => {
		const menus = [
			menu({ id: 'a', tags: ['เด็กเล็ก'] }),
			menu({ id: 'b', tags: ['ผู้สูงอายุ'] }),
			menu({ id: 'c', tags: ['Everyone'] })
		];
		const result = filterMenusByTag(menus, 'กลุ่มเปราะบาง');
		expect(result.map((m) => m.id)).toEqual(['a', 'b']);
	});
});

describe('searchRecipients', () => {
	const recipients = [
		recipient({ id: 'EV-1', name: 'นายสมชาย รักดี', bed: 'A-01', phone: '081-234-5678' }),
		recipient({ id: 'EV-2', name: 'นางสมศรี รักดี', bed: 'A-02', phone: '089-999-0000' })
	];

	it('returns nothing for a blank query', () => {
		expect(searchRecipients(recipients, '   ')).toEqual([]);
	});

	it('matches by partial name, case-insensitively', () => {
		const result = searchRecipients(recipients, 'สมชาย');
		expect(result.map((r) => r.id)).toEqual(['EV-1']);
	});

	it('matches by bed number', () => {
		const result = searchRecipients(recipients, 'A-02');
		expect(result.map((r) => r.id)).toEqual(['EV-2']);
	});
});

describe('hasReceivedMenu', () => {
	it('is true only when a transaction matches both recipient and menu', () => {
		const tx: MealDistributionTransaction = {
			id: 'TX-1',
			recipientId: 'EV-1',
			recipientName: 'นายสมชาย รักดี',
			bed: 'A-01',
			menuId: 'm-1',
			menuTitle: 'ข้าวสวย + ไข่ต้ม',
			time: '12:00',
			portions: 1
		};
		expect(hasReceivedMenu([tx], 'EV-1', 'm-1')).toBe(true);
		expect(hasReceivedMenu([tx], 'EV-1', 'm-2')).toBe(false);
		expect(hasReceivedMenu([tx], 'EV-2', 'm-1')).toBe(false);
	});
});

describe('recipientMatchesMenu', () => {
	it('matches any recipient when the menu is open to everyone', () => {
		const m = menu({ tags: ['Everyone', 'ปกติ'] });
		expect(recipientMatchesMenu(recipient({ dietaryTags: ['ฮาลาล'] }), m)).toBe(true);
	});

	it('matches when a dietary tag overlaps the menu tags', () => {
		const m = menu({ tags: ['Halal', 'อิสลาม'] });
		expect(recipientMatchesMenu(recipient({ dietaryTags: ['ฮาลาล', 'อิสลาม'] }), m)).toBe(true);
	});

	it('does not match when no dietary tag overlaps a restricted menu', () => {
		const m = menu({ tags: ['Halal', 'อิสลาม'] });
		expect(recipientMatchesMenu(recipient({ dietaryTags: ['ปกติ'] }), m)).toBe(false);
	});
});

describe('sessionServedTotal', () => {
	it('sums served portions across every menu in the session', () => {
		const session: MealDistributionSession = {
			id: 'lunch',
			timeRange: '11:30 - 14:00 น.',
			status: 'open',
			targetTotal: 30,
			menus: [menu({ served: 10 }), menu({ id: 'm-2', served: 5 })]
		};
		expect(sessionServedTotal(session)).toBe(15);
	});
});

describe('quotaPercent', () => {
	it('caps at 100% even when served exceeds target', () => {
		expect(quotaPercent(150, 100)).toBe(100);
	});

	it('returns 0 for a zero or negative target instead of dividing by zero', () => {
		expect(quotaPercent(5, 0)).toBe(0);
	});

	it('rounds to the nearest percent', () => {
		expect(quotaPercent(1, 3)).toBe(33);
	});
});
