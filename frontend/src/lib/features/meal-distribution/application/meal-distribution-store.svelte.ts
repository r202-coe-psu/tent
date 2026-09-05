import { getContext, setContext } from 'svelte';
import { toast } from 'svelte-sonner';
import type { MealPeriod } from '$lib/features/kitchen';
import {
	currentServeTimeLabel,
	filterMenusByTag,
	hasReceivedMenu,
	mergeSessionsAcrossDays,
	recipientMatchesMenu,
	searchRecipients,
	todayIsoDate,
	type MealDateFilterMode,
	type MealDistributionDay,
	type MealDistributionSession,
	type MealDistributionTransaction,
	type MealFilterTag,
	type MealMenuItem,
	type MealRecipient
} from '../domain/meal-distribution';
import {
	createMockMealDays,
	createMockRecipients,
	createMockHistoricalTransactions,
	MOCK_BREAKFAST_PRE_SERVED
} from '../data/meal-distribution.mock-data';

/**
 * Kiosk state for the onsite meal-distribution mock (T-14 prototype). Plain
 * $state class per Svelte 5 conventions — everything here is still a static
 * UI mock (CLAUDE.md), not wired to CouchDB.
 */
class MealsStore {
	days = $state<MealDistributionDay[]>(createMockMealDays());
	transactions = $state<MealDistributionTransaction[]>(createMockHistoricalTransactions());
	// Static mock roster — not reactive state, only ever read.
	recipients: MealRecipient[] = createMockRecipients();

	selectedSessionId = $state<MealPeriod>('lunch');
	activeFilterTag = $state<MealFilterTag>('ทั้งหมด');
	dateFilterMode = $state<MealDateFilterMode>('day');

	activeKioskMenu = $state<MealMenuItem | null>(null);
	isKioskMode = $state(false);

	searchQuery = $state('');
	isScannerOpen = $state(false);

	selectedRecipient = $state<MealRecipient | null>(null);
	servePortions = $state(1);

	successMessage = $state('');
	showSuccessOverlay = $state(false);
	warningMessage = $state('');
	showWarningOverlay = $state(false);

	closeBatchTarget = $state<MealMenuItem | null>(null);
	historyTargetMenu = $state<MealMenuItem | null>(null);

	todayDay: MealDistributionDay = $derived(
		this.days.find((d) => d.date === todayIsoDate()) ?? this.days[0]
	);
	visibleSessions: MealDistributionSession[] = $derived(
		this.dateFilterMode === 'all' ? mergeSessionsAcrossDays(this.days) : this.todayDay.sessions
	);
	selectedSession: MealDistributionSession = $derived(
		this.visibleSessions.find((s) => s.id === this.selectedSessionId)!
	);
	filteredMenus: MealMenuItem[] = $derived(
		filterMenusByTag(this.selectedSession.menus, this.activeFilterTag)
	);
	searchResults: MealRecipient[] = $derived(searchRecipients(this.recipients, this.searchQuery));
	menuTransactions: MealDistributionTransaction[] = $derived.by(() => {
		const menu = this.activeKioskMenu;
		if (!menu) return [];
		return this.transactions.filter((t) => t.menuId === menu.id);
	});
	totalOpenSessions = $derived(this.visibleSessions.filter((s) => s.status === 'open').length);
	todayTotalServed = $derived(MOCK_BREAKFAST_PRE_SERVED + this.transactions.length);
	selectedRecipientAlreadyServed = $derived(
		this.selectedRecipient && this.activeKioskMenu
			? hasReceivedMenu(this.transactions, this.selectedRecipient.id, this.activeKioskMenu.id)
			: false
	);
	selectedRecipientMismatch = $derived(
		this.selectedRecipient && this.activeKioskMenu
			? !recipientMatchesMenu(this.selectedRecipient, this.activeKioskMenu)
			: false
	);

	hasReceived(recipientId: string, menuId: string): boolean {
		return hasReceivedMenu(this.transactions, recipientId, menuId);
	}

	selectSession(id: MealPeriod) {
		this.selectedSessionId = id;
	}

	setFilterTag(tag: MealFilterTag) {
		this.activeFilterTag = tag;
	}

	setDateFilterMode(mode: MealDateFilterMode) {
		this.dateFilterMode = mode;
	}

	requestCloseBatch(menu: MealMenuItem) {
		this.closeBatchTarget = menu;
	}

	cancelCloseBatch() {
		this.closeBatchTarget = null;
	}

	openMenuHistory(menu: MealMenuItem) {
		this.historyTargetMenu = menu;
	}

	closeMenuHistory() {
		this.historyTargetMenu = null;
	}

	getHistoryTransactions(menuId: string): MealDistributionTransaction[] {
		return this.transactions.filter((t) => t.menuId === menuId);
	}

	confirmCloseBatch(note: string) {
		const menu = this.closeBatchTarget;
		if (!menu) return;

		menu.status = 'closed';
		menu.closedNote = note.trim() || undefined;
		this.closeBatchTarget = null;

		toast.success(`ปิดรอบแจกจ่ายเมนู "${menu.title}" แล้ว`);
		this.stopKiosk();
	}

	startKiosk(menu: MealMenuItem) {
		this.activeKioskMenu = menu;
		this.isKioskMode = true;
		this.searchQuery = '';
		if (menu.status === 'closed') {
			toast.info(`แสดงประวัติการแจกเมนู: ${menu.title} (ปิดรอบแล้ว)`);
		} else {
			toast.success(`เริ่มจุดบริการ Kiosk: ${menu.title}`);
		}
	}

	stopKiosk() {
		this.activeKioskMenu = null;
		this.isKioskMode = false;
		this.deselectRecipient();
	}

	/** Open the confirm-serve card for a recipient found via search or scan. */
	selectRecipient(recipient: MealRecipient) {
		this.selectedRecipient = recipient;
		this.servePortions = 1;
		this.searchQuery = '';
	}

	deselectRecipient() {
		this.selectedRecipient = null;
		this.servePortions = 1;
	}

	setServePortions(count: number) {
		this.servePortions = Math.max(1, count);
	}

	/** Serve the recipient currently held in the confirm-serve card. */
	confirmServe() {
		const recipient = this.selectedRecipient;
		const menu = this.activeKioskMenu;
		if (!recipient || !menu) return;

		if (this.hasReceived(recipient.id, menu.id)) {
			this.warningMessage = `ผู้ประสบภัย ${recipient.name} ได้รับอาหารเมนูนี้ไปแล้ว!`;
			this.showWarningOverlay = true;
			setTimeout(() => {
				this.showWarningOverlay = false;
			}, 2500);
			this.deselectRecipient();
			return;
		}

		const portions = this.servePortions;
		menu.served += portions;

		const tx: MealDistributionTransaction = {
			id: `TX-${crypto.randomUUID()}`,
			recipientId: recipient.id,
			recipientName: recipient.name,
			bed: recipient.bed,
			menuId: menu.id,
			menuTitle: menu.title,
			time: currentServeTimeLabel(),
			portions
		};
		this.transactions = [tx, ...this.transactions];

		this.successMessage = recipient.name;
		this.showSuccessOverlay = true;
		setTimeout(() => {
			this.showSuccessOverlay = false;
		}, 1800);

		this.searchQuery = '';
		this.deselectRecipient();
		toast.success(`บันทึกการแจกจ่ายอาหารสำเร็จ: ${recipient.name}`);
	}

	handleSimulatedScan(recipient: MealRecipient) {
		this.isScannerOpen = false;
		if (!this.activeKioskMenu) return;
		if (this.hasReceived(recipient.id, this.activeKioskMenu.id)) return;
		this.selectRecipient(recipient);
	}
}

export type { MealsStore };

const MEALS_STORE_KEY = Symbol('ONSITE_MEALS_STORE');

export function setMealsStore(): MealsStore {
	return setContext(MEALS_STORE_KEY, new MealsStore());
}

export function getMealsStore(): MealsStore {
	const store = getContext<MealsStore>(MEALS_STORE_KEY);
	if (!store) {
		throw new Error('getMealsStore must be used under a component that called setMealsStore');
	}
	return store;
}
