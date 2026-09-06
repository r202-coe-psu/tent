import type { MealPeriod } from '$lib/features/kitchen';

// UI-only English subtitle for MealPeriod — kitchen's MEAL_PERIOD_LABELS is Thai-only.
export const MEAL_PERIOD_EN_LABELS: Record<MealPeriod, string> = {
	breakfast: 'Breakfast',
	lunch: 'Lunch',
	dinner: 'Dinner',
	snack: 'Snack'
};

export interface MealMenuItem {
	id: string;
	title: string;
	batchCode: string;
	cookTime: string;
	target: number;
	served: number;
	tags: string[];
	status: 'ready' | 'closed';
	closedNote?: string;
}

export interface MealDistributionSession {
	id: MealPeriod;
	timeRange: string;
	status: 'open' | 'closed';
	targetTotal: number;
	menus: MealMenuItem[];
}

export interface MealDistributionDay {
	date: string; // ISO yyyy-mm-dd
	sessions: MealDistributionSession[];
}

export type MealDateFilterMode = 'day' | 'all';

export interface MealRecipient {
	id: string;
	name: string;
	age: number;
	nationalId: string;
	phone: string;
	zone: string;
	bed: string;
	householdId: string | null;
	dietaryTags: string[];
	wristbandCode: string;
}

export interface MealDistributionTransaction {
	id: string;
	recipientId: string;
	recipientName: string;
	bed: string;
	menuId: string;
	menuTitle: string;
	time: string;
	portions: number;
	status: 'active' | 'voided';
	recipient_type?: 'evacuee' | 'volunteer' | 'outside';
	scanned_by?: string;
	voided_at?: string;
	voided_by?: string;
}

export const MEAL_FILTER_TAGS = [
	'ทั้งหมด',
	'Everyone (ทั่วไป)',
	'Halal (ฮาลาล)',
	'กลุ่มเปราะบาง',
	'มังสวิรัติ / เจ'
] as const;
export type MealFilterTag = (typeof MEAL_FILTER_TAGS)[number];

export function filterMenusByTag(menus: MealMenuItem[], filterTag: MealFilterTag): MealMenuItem[] {
	if (filterTag === 'ทั้งหมด') return menus;
	return menus.filter((menu) => {
		if (filterTag === 'Everyone (ทั่วไป)') {
			return menu.tags.includes('Everyone') || menu.tags.includes('ปกติ');
		}
		if (filterTag === 'Halal (ฮาลาล)') {
			return menu.tags.includes('Halal') || menu.tags.includes('อิสลาม');
		}
		if (filterTag === 'กลุ่มเปราะบาง') {
			return (
				menu.tags.includes('กลุ่มเปราะบาง') ||
				menu.tags.includes('ผู้สูงอายุ') ||
				menu.tags.includes('เด็กเล็ก')
			);
		}
		if (filterTag === 'มังสวิรัติ / เจ') {
			return menu.tags.includes('มังสวิรัติ') || menu.tags.includes('เจ');
		}
		return true;
	});
}

export function searchRecipients(recipients: MealRecipient[], query: string): MealRecipient[] {
	const q = query.trim().toLowerCase();
	if (!q) return [];
	return recipients.filter(
		(r) =>
			r.name.toLowerCase().includes(q) ||
			r.bed.toLowerCase().includes(q) ||
			r.phone.includes(q) ||
			r.nationalId.includes(q) ||
			r.wristbandCode.toLowerCase().includes(q)
	);
}

/** True when the recipient's dietary tags qualify them for this menu (or the menu is open to everyone). */
export function recipientMatchesMenu(recipient: MealRecipient, menu: MealMenuItem): boolean {
	if (menu.tags.some((t) => t === 'Everyone' || t === 'ปกติ')) return true;
	return recipient.dietaryTags.some((tag) => menu.tags.includes(tag));
}

export function hasReceivedMenu(
	transactions: MealDistributionTransaction[],
	recipientId: string,
	menuId: string
): boolean {
	return transactions.some(
		(t) => t.status === 'active' && t.recipientId === recipientId && t.menuId === menuId
	);
}

export function sessionServedTotal(session: MealDistributionSession): number {
	return session.menus.reduce((sum, m) => sum + m.served, 0);
}

export function quotaPercent(served: number, target: number): number {
	if (target <= 0) return 0;
	return Math.min(100, Math.round((served / target) * 100));
}

export function remainingPortions(menu: MealMenuItem): number {
	return Math.max(0, menu.target - menu.served);
}

// Combine every mock day's sessions into one "ทั้งหมด (all)" view: same period
// across days is summed into a single card, and its menus are concatenated so
// every day's batches still show up in the filtered menu list below. Menu item
// object identity is preserved (not cloned) so recordServe mutations on a menu
// keep hitting the one instance backing the store's `days` state.
export function mergeSessionsAcrossDays(days: MealDistributionDay[]): MealDistributionSession[] {
	const merged = new Map<MealPeriod, MealDistributionSession>();
	for (const day of days) {
		for (const session of day.sessions) {
			const existing = merged.get(session.id);
			if (!existing) {
				merged.set(session.id, { ...session, menus: [...session.menus] });
				continue;
			}
			existing.status = existing.status === 'open' || session.status === 'open' ? 'open' : 'closed';
			existing.targetTotal += session.targetTotal;
			existing.menus = [...existing.menus, ...session.menus];
		}
	}
	return Array.from(merged.values());
}

// Plain .ts (not .svelte.ts) so `new Date()` doesn't trip svelte/prefer-svelte-reactivity —
// this is a one-shot read, never stored as reactive state.
export function currentServeTimeLabel(): string {
	return new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
}

export function todayIsoDate(): string {
	return new Date().toISOString().slice(0, 10);
}

export function mealDateShortLabel(dateIso: string): string {
	return new Date(`${dateIso}T00:00:00`).toLocaleDateString('th-TH', {
		day: 'numeric',
		month: 'short'
	});
}
