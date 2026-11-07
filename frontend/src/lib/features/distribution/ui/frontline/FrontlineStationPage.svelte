<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import Truck from '@lucide/svelte/icons/truck';
	import UtensilsCrossed from '@lucide/svelte/icons/utensils-crossed';
	import Package from '@lucide/svelte/icons/package';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Layers from '@lucide/svelte/icons/layers';
	import Loader from '@lucide/svelte/icons/loader';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import { beforeNavigate, goto, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import {
		resolveAuthenticatedAuthorContext,
		useRequisitionTickets,
		useReceiveTicketAtDistributionPoint
	} from '../../application/queries';
	import { canPerformFrontlineDistribution } from '../../application/food-supplies/auth';
	import { compareByReconciliationProgress } from '../model/ticket-status';
	import Lock from '@lucide/svelte/icons/lock';
	import { ticketServiceDay, type RequisitionTicket } from '../../domain/food-supplies';
	import {
		ALL_POINTS,
		distributionPointOptions,
		filterTicketsByPoint,
		resolveDistributionPoint
	} from '../model/distribution-point';
	import { filterDeskTickets } from '../model/ticket-filters';
	import {
		DESK_MODES,
		DESK_MODE_IDS,
		STEP_TITLES,
		modePendingCount,
		needsCloseOutAction,
		isDeskMode,
		resolveInitialMode,
		stepAfterModeSwitch,
		stepLabel,
		ticketsForMode,
		type DeskMode,
		type StationTab
	} from '../model/desk-mode';
	import { readStoredDeskMode, storeDeskMode } from '../model/desk-mode-storage';
	import { DeskDrafts } from '../model/desk-draft';
	import { incomingLinkAction } from '../model/desk-link-gate';
	import {
		filterTicketsByServiceDay,
		resolveServiceDay,
		serviceDayOptions
	} from '../model/service-day';
	import FoodDistributionCard from './FoodDistributionCard.svelte';
	import InTransitTicketCard from './InTransitTicketCard.svelte';
	import TicketPicker from './TicketPicker.svelte';
	import {
		CLOSE_OUT_GROUPS,
		closeOutGroup,
		resolveCloseOutGroup,
		type CloseOutGroup
	} from '../model/ticket-picker';
	import {
		formatUnit,
		itemMasterUnit,
		useItemMasters,
		useUnitsOfMeasure
	} from '$lib/features/catalog';
	import { langState } from '$lib/states/i18n.svelte';
	import DistributionHistory from '../common/DistributionHistory.svelte';
	import SuppliesDistributionCard from './SuppliesDistributionCard.svelte';
	import LoanReturnCard from './LoanReturnCard.svelte';
	import BulkReturnPoolBoard from '../bulk-return/BulkReturnPoolBoard.svelte';
	import ShiftReconciliationCard from './ShiftReconciliationCard.svelte';
	import TicketStatusBadge from '../common/TicketStatusBadge.svelte';
	import { formatDistributionError } from '../model/distribution-error';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Label } from '$lib/components/ui/label/index.js';

	import {
		ONSITE_DISTRIBUTION_PATH,
		onsiteDeskHref,
		parseOnsiteDistributionParams
	} from '../model/pool-url-state';

	interface Props {
		/** Mode from the URL (`?mode=`, or forced by the tab); beats the remembered mode. */
		initialMode?: DeskMode | null;
		/** Active tab from the URL; local clicks override it until the next link. */
		initialTab?: StationTab;
		/** Bulk return pool to open on the returns tab (deep link). */
		initialPoolId?: string | null;
		/** Bumped on each real navigation, so following the same link again re-applies it. */
		linkKey?: number;
	}

	// Mode, tab and pool are re-applied whenever the link changes (new URL params or a new
	// navigation).
	let {
		initialMode = null,
		initialTab = 'receive',
		initialPoolId = null,
		linkKey = 0
	}: Props = $props();

	const currentShelterCode = $derived(shelterStore.selectedShelterCode ?? getShelterCode());

	// Authoritative session context — matches Slice 5.2 TicketActionPanel pattern.
	// Fails closed (canFrontline = false) if unauthenticated.
	const authContext = $derived.by(() => {
		try {
			return resolveAuthenticatedAuthorContext(currentShelterCode ?? undefined);
		} catch {
			return null;
		}
	});

	const canFrontline = $derived(authContext ? canPerformFrontlineDistribution(authContext) : false);

	// Receive-tab cards show allocated_qty in each item's base unit (#1183).
	const itemMastersQuery = useItemMasters(() => currentShelterCode);
	const unitsQuery = useUnitsOfMeasure();
	const unitByItemId = $derived.by(() => {
		const units = unitsQuery.data ?? [];
		return new Map(
			(itemMastersQuery.data ?? []).map((item) => {
				const code = itemMasterUnit(item);
				return [item._id, formatUnit(code, units, langState.current) || code];
			})
		);
	});
	const unitOf = (itemId: string) => unitByItemId.get(itemId) ?? '';

	// The link (props) sets mode / tab / pool; user actions override them locally. The URL is then
	// written whole from this state (`writeUrl`). The props follow the route's parse of
	// `page.state.deskSearch` (else `page.url`), so they track the desk's own writes; a real
	// navigation clears `page.state`, so the link's URL applies again.
	// `?mode=` beats the remembered mode (FR-DFS-07); the stored read is not a dependency.
	// One link object: any prop or `linkKey` change makes a fresh one, so mode, tab and pool are
	// applied together. `linkKey` re-derives it on a real navigation even when the parsed values
	// are unchanged. Local state and the written URL agree, since every local change writes the URL.
	// `explicit` is true when the link itself names a mode (FR-DFS-06).
	const link = $derived.by(() => {
		void linkKey;
		const m = resolveInitialMode(initialMode, untrack(readStoredDeskMode));
		return {
			mode: m,
			tab: stepAfterModeSwitch(initialTab, m),
			pool: initialPoolId,
			explicit: isDeskMode(initialMode)
		};
	});
	// Local state: derived from the link, overridden by user actions until the next link. (Writable
	// deriveds.) No gate effect is needed for FR-DFS-05: a mode-changing navigation with a draft is
	// stopped in `beforeNavigate` below, before the props can change, so the link only ever reaches
	// here once it is safe to apply. The desk's own shallow `replaceState` writes keep the mode, and
	// the initial load has no draft.
	let mode = $derived<DeskMode>(link.mode);
	let activeTab = $derived<StationTab>(link.tab);
	// Open bulk return pool; the local value keeps a closed pool closed when the user returns.
	let selectedPoolId = $derived<string | null>(link.pool);

	// FR-DFS-06: a link that names a mode is also the mode this device last used. Why an effect: it
	// writes localStorage. It reads only `link`, so it re-runs once per link (also the same link again).
	$effect(() => {
		if (link.explicit) storeDeskMode(link.mode);
	});

	// One URL model: `?mode=&tab=[&pool=]`, always written whole. Shallow, so a goto does not
	// cancel the phone scroll. Never called on initial load. Skipped once the user has navigated
	// away (a late board callback or awaited receive must not overwrite another page's URL).
	function writeUrl() {
		if (page.url.pathname !== resolve(ONSITE_DISTRIBUTION_PATH)) return;
		const href = onsiteDeskHref({ mode, tab: activeTab, pool: selectedPoolId });
		// The query is kept in `page.state`: history restores it on Back, while `page.url` stays stale.
		replaceState(resolve(href), { deskSearch: href.slice(href.indexOf('?') + 1) });
	}

	const steps = $derived(DESK_MODES[mode].steps);

	let contentEl = $state<HTMLElement | null>(null);

	// Phone only: the tab strip and selectors sit above the detail, so bring it into view after a
	// user action. Called from handlers (never an effect) so initial load does not scroll.
	async function scrollToContent() {
		if (typeof window === 'undefined' || !window.matchMedia('(max-width: 1023.98px)').matches) {
			return;
		}
		await tick();
		const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		contentEl?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
	}

	const drafts = new DeskDrafts();
	// FR-DFS-05: a switch unmounts the step's form, so typed input waits on this confirm.
	// One confirm for both paths: the in-page switcher and a navigation that changes the mode.
	type PendingSwitch =
		| { kind: 'mode'; mode: DeskMode }
		| { kind: 'nav'; mode: DeskMode; url: URL; popDelta: number | null };
	let pendingSwitch = $state.raw<PendingSwitch | null>(null);
	const pendingMode = $derived(pendingSwitch?.mode ?? null);

	function selectMode(next: DeskMode) {
		if (next === mode) return;
		if (drafts.hasDraft()) {
			pendingSwitch = { kind: 'mode', mode: next };
			return;
		}
		switchMode(next);
	}

	// One-shot: the `href` of the navigation we re-run after a confirm, so it is not held again.
	let bypassHref: string | null = null;

	// FR-DFS-05 for navigations. A same-route navigation that changes the mode would unmount the
	// step's form, so while a draft exists it is cancelled here and waits on the confirm. Cancelling
	// leaves the URL and history exactly as they were: for a link nothing was pushed yet, and for
	// popstate SvelteKit's `block` undoes the move with `history.go(-delta)`. Limit: SvelteKit can
	// only cancel popstates it handles as navigations; a popstate within one navigation entry (the
	// desk's own shallow writes) is not a navigation, never reaches here, and keeps the mode anyway.
	// A popstate reads the target mode from `location`: kit sets `to.url` from the entry's original
	// URL, but the browser is already on the entry, whose address is the desk's last write.
	beforeNavigate((nav) => {
		const bypass = bypassHref;
		bypassHref = null;
		if (nav.willUnload || nav.to === null) return;
		if (nav.to.url.pathname !== resolve(ONSITE_DISTRIBUTION_PATH)) return;
		if (bypass === nav.to.url.href) return;

		const targetParams =
			nav.type === 'popstate' ? new URL(location.href).searchParams : nav.to.url.searchParams;
		const targetMode = resolveInitialMode(
			parseOnsiteDistributionParams(targetParams).mode,
			untrack(readStoredDeskMode)
		);
		const action = incomingLinkAction({
			currentMode: mode,
			linkMode: targetMode,
			hasDraft: drafts.hasDraft()
		});
		if (action === 'apply') {
			// Proceeds. Any open confirm is now stale (the user went elsewhere), so drop it.
			pendingSwitch = null;
			return;
		}
		nav.cancel();
		pendingSwitch = {
			kind: 'nav',
			mode: targetMode,
			url: nav.to.url,
			popDelta: nav.type === 'popstate' && nav.delta !== undefined ? nav.delta : null
		};
	});

	// Cancel (or closing the dialog). Nothing to undo: a held navigation was cancelled, so the
	// URL, history position and draft are untouched. The desk URL is deliberately not rewritten.
	function cancelPending() {
		pendingSwitch = null;
	}

	function confirmPending() {
		const held = pendingSwitch;
		if (!held) return;
		if (held.kind === 'mode') {
			switchMode(held.mode);
			return;
		}
		pendingSwitch = null;
		// Re-run the navigation once; `bypassHref` keeps `beforeNavigate` from holding it again.
		// A link push (`replaceState: false`) matches what the click would have done. Scroll is
		// left at its default; the phone then brings the detail into view like any desk action.
		bypassHref = held.url.href;
		if (held.popDelta !== null) {
			history.go(held.popDelta);
			return;
		}
		const href = `${ONSITE_DISTRIBUTION_PATH}${held.url.search}${held.url.hash}`;
		void goto(resolve(href as typeof ONSITE_DISTRIBUTION_PATH), { replaceState: false }).then(() =>
			scrollToContent()
		);
	}

	function switchMode(next: DeskMode) {
		pendingSwitch = null;
		mode = next;
		activeTab = stepAfterModeSwitch(activeTab, next);
		if (activeTab !== 'returns') selectedPoolId = null;
		storeDeskMode(next);
		writeUrl();
		void scrollToContent();
	}

	function selectTab(tab: StationTab) {
		activeTab = tab;
		if (tab !== 'returns') selectedPoolId = null;
		writeUrl();
		void scrollToContent();
	}

	// Board callback (select / close); also fires after an awaited action, so it only writes.
	function selectPool(poolId: string | null) {
		selectedPoolId = poolId;
		writeUrl();
	}

	function pickTicket(set: (id: string) => void) {
		return (id: string) => {
			set(id);
			void scrollToContent();
		};
	}

	// Fetch tickets for frontline station
	const ticketsQuery = useRequisitionTickets(undefined, () => currentShelterCode);
	const allTickets = $derived(filterDeskTickets(ticketsQuery.data ?? []));

	// Every step sees only the current mode's tickets (food and supplies never mix).
	const modeTickets = $derived(ticketsForMode(allTickets, mode));

	// Categorize tickets by frontline workflow relevance
	const inTransitTickets = $derived(modeTickets.filter((t) => t.status === 'IN_TRANSIT'));

	// Desk tickets before the point filter. Tab badges count these, so a point picked on one tab
	// never hides work from the badges shown while the filter itself is out of sight.
	const allDistributingFood = $derived(
		allTickets.filter((t) => t.status === 'DISTRIBUTING' && t.requisition_type === 'food')
	);
	const allDistributingSupplies = $derived(
		allTickets.filter((t) => t.status === 'DISTRIBUTING' && t.requisition_type === 'supplies')
	);
	// DISTRIBUTING or post-distribution tickets needing close or submit, ordered by workflow
	// progress so unfinished tickets surface first and COMPLETED ones sink to the bottom.
	const allReconciliationTickets = $derived(
		modeTickets
			.filter(
				(t) =>
					t.status === 'DISTRIBUTING' ||
					t.status === 'SHIFT_CLOSED' ||
					t.status === 'RETURN_PENDING_RECEIPT' ||
					t.status === 'RETURN_COMPLETED' ||
					t.status === 'COMPLETED'
			)
			.sort(compareByReconciliationProgress)
	);

	// Optional distribution-point filter for the food, supplies and close-out tabs. Defaults to
	// every point, so it narrows the view without deciding which tickets a point may see. Points
	// come from tickets still in play at the desk (not COMPLETED), so the list does not grow with
	// history or offer points that only have tickets waiting at the warehouse.
	let pickedPoint = $state<string | null>(null);
	const pointSourceTickets = $derived(
		allReconciliationTickets.filter((t) => t.status !== 'COMPLETED')
	);
	const pointOptions = $derived(distributionPointOptions(pointSourceTickets));
	const point = $derived(resolveDistributionPoint(pickedPoint, pointSourceTickets));

	const distributingFoodTickets = $derived(filterTicketsByPoint(allDistributingFood, point));
	const distributingSuppliesTickets = $derived(
		filterTicketsByPoint(allDistributingSupplies, point)
	);

	// Food tickets are filtered by service day (derived from created_at — FR-MQW-03 A). Defaults to
	// today when any ticket is for today, otherwise every day, so older open tickets stay visible.
	let pickedFoodDay = $state<string | null>(null);
	const foodDayOptions = $derived(serviceDayOptions(distributingFoodTickets));
	const foodDay = $derived(resolveServiceDay(pickedFoodDay, distributingFoodTickets));
	const visibleFoodTickets = $derived(filterTicketsByServiceDay(distributingFoodTickets, foodDay));

	// Ticket the user picked in each selector. The effective selection falls back to the first
	// active ticket whenever the pick is empty or no longer listed.
	let pickedFoodTicketId = $state<string>('');
	let pickedSuppliesTicketId = $state<string>('');

	const selectedFoodTicketId = $derived(
		visibleFoodTickets.some((t) => t._id === pickedFoodTicketId)
			? pickedFoodTicketId
			: (visibleFoodTickets[0]?._id ?? '')
	);
	const selectedSuppliesTicketId = $derived(
		distributingSuppliesTickets.some((t) => t._id === pickedSuppliesTicketId)
			? pickedSuppliesTicketId
			: (distributingSuppliesTickets[0]?._id ?? '')
	);

	const activeFoodTicket = $derived(
		visibleFoodTickets.find((t) => t._id === selectedFoodTicketId) ?? null
	);
	const activeSuppliesTicket = $derived(
		distributingSuppliesTickets.find((t) => t._id === selectedSuppliesTicketId) ?? null
	);

	const reconciliationEligibleTickets = $derived(
		filterTicketsByPoint(allReconciliationTickets, point)
	);
	const showPointFilter = $derived(pointOptions.length > 1 || point !== ALL_POINTS);

	// Tickets that specifically need a direct frontline action right now: shift closed but
	// returns not yet submitted, or warehouse already verified the return but the ticket still
	// needs to be closed. Excludes DISTRIBUTING (already surfaced by the food/supplies tabs),
	// RETURN_PENDING_RECEIPT (waiting on the warehouse, not frontline), and COMPLETED.
	// Counted before the point filter — it feeds a tab badge.
	const reconciliationPendingActionCount = $derived(
		allReconciliationTickets.filter(needsCloseOutAction).length
	);

	let pickedReconciliationTicketId = $state<string>('');

	// Close-out tickets are grouped (ต้องทำ / รอคลัง / เสร็จแล้ว); a ticket just closed or submitted
	// pins the view to its new group.
	let pickedCloseOutGroup = $state<CloseOutGroup | null>(null);
	const closeOutGroupShown = $derived(
		resolveCloseOutGroup(
			pickedCloseOutGroup,
			reconciliationEligibleTickets,
			pickedReconciliationTicketId
		)
	);
	const closeOutGroupTickets = $derived(
		reconciliationEligibleTickets.filter((t) => closeOutGroup(t.status) === closeOutGroupShown)
	);
	function pinCloseOutTicket(ticket: RequisitionTicket) {
		pickedCloseOutGroup = null;
		pickedReconciliationTicketId = ticket._id;
	}

	const TAB_STYLE: Record<
		StationTab,
		{ Icon: typeof Truck; active: string; icon: string; badge: string }
	> = {
		receive: {
			Icon: Truck,
			active: 'border-sky-500 bg-sky-50/50 shadow-xs ring-2 ring-sky-500/20',
			icon: 'bg-sky-600 text-white',
			badge: 'bg-blue-100 text-blue-900'
		},
		food: {
			Icon: UtensilsCrossed,
			active: 'border-amber-500 bg-amber-50/50 shadow-xs ring-2 ring-amber-500/20',
			icon: 'bg-amber-600 text-white',
			badge: 'bg-amber-100 text-amber-900'
		},
		supplies: {
			Icon: Package,
			active: 'border-indigo-500 bg-indigo-50/50 shadow-xs ring-2 ring-indigo-500/20',
			icon: 'bg-indigo-600 text-white',
			badge: 'bg-indigo-100 text-indigo-900'
		},
		returns: {
			Icon: RotateCcw,
			active: 'border-emerald-500 bg-emerald-50/50 shadow-xs ring-2 ring-emerald-500/20',
			icon: 'bg-emerald-600 text-white',
			badge: ''
		},
		reconciliation: {
			Icon: Lock,
			active: 'border-teal-500 bg-teal-50/50 shadow-xs ring-2 ring-teal-500/20',
			icon: 'bg-teal-600 text-white',
			badge: 'bg-amber-100 text-amber-900'
		}
	};

	const tabBadges = $derived<Record<StationTab, { text: string; pulse?: boolean } | null>>({
		receive:
			inTransitTickets.length > 0
				? { text: `รอรับ ${inTransitTickets.length}`, pulse: true }
				: null,
		food: allDistributingFood.length > 0 ? { text: `เปิดแจก ${allDistributingFood.length}` } : null,
		supplies:
			allDistributingSupplies.length > 0
				? { text: `เปิดแจก ${allDistributingSupplies.length}` }
				: null,
		returns: null,
		reconciliation:
			reconciliationPendingActionCount > 0
				? { text: `รอดำเนินการ ${reconciliationPendingActionCount}` }
				: null
	});

	// Falls back to the ticket open on the food tab, then the supplies tab, then the first one.
	const selectedReconciliationTicketId = $derived(
		[pickedReconciliationTicketId, activeFoodTicket?._id, activeSuppliesTicket?._id].find(
			(id) => !!id && closeOutGroupTickets.some((t) => t._id === id)
		) ??
			closeOutGroupTickets[0]?._id ??
			''
	);

	const activeReconciliationTicket = $derived(
		closeOutGroupTickets.find((t) => t._id === selectedReconciliationTicketId) ?? null
	);

	// Mutation for receiving cargo (IN_TRANSIT -> DISTRIBUTING)
	const receiveMutation = useReceiveTicketAtDistributionPoint();
	let receivingTicketId = $state<string | null>(null);

	async function handleReceiveCargo(ticket: RequisitionTicket) {
		if (!canFrontline) {
			toast.error('คุณไม่มีสิทธิ์ในการตรวจรับพัสดุเข้าจุดแจกจ่าย');
			return;
		}

		receivingTicketId = ticket._id;
		try {
			await receiveMutation.mutateAsync({
				ticketId: ticket._id,
				shelterCode: currentShelterCode
			});
			toast.success(`ตรวจรับสินค้าเข้าจุดแจกจ่ายเรียบร้อยแล้ว: ${ticket.ticket_no}`);
			// Show the received ticket in its tab, but only if the desk is still in its mode: the mode
			// buttons stay enabled during the await, and a jump would mix modes (and the URL).
			if (ticket.requisition_type === mode) {
				pickedPoint = null;
				if (ticket.requisition_type === 'food') {
					selectTab('food');
					pickedFoodDay = ticketServiceDay(ticket);
					pickedFoodTicketId = ticket._id;
				} else {
					selectTab('supplies');
					pickedSuppliesTicketId = ticket._id;
				}
			}
		} catch (err) {
			toast.error(formatDistributionError(err, 'ไม่สามารถตรวจรับสินค้าได้ กรุณาลองใหม่อีกครั้ง'));
		} finally {
			receivingTicketId = null;
		}
	}
</script>

<!-- Phone: tall enough that the scroll anchor can reach the top while a tab is still loading -->
<div
	class="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 max-lg:min-h-[calc(100dvh+18rem)] sm:px-6 sm:py-8"
>
	<!-- Back Navigation -->
	<div>
		<Button
			href={resolve('/portal')}
			variant="outline"
			class="h-auto rounded-full px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900"
		>
			<ArrowLeft class="h-3.5 w-3.5" />
			<span>กลับหน้าเลือกเมนูหลัก</span>
		</Button>
	</div>

	<!-- Station 4 Header -->
	<header class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
		<div class="flex items-center gap-3">
			<div
				class="flex h-12 w-12 items-center justify-center rounded-2xl border border-sky-200/80 bg-sky-50 text-sky-700 shadow-xs"
			>
				<Truck class="h-6 w-6" />
			</div>
			<div>
				<h1 class="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
					จุดแจกจ่ายพัสดุและอาหาร
				</h1>
			</div>
		</div>

		<div class="flex items-center gap-2.5">
			<span
				class="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 shadow-2xs"
			>
				<span class="h-2 w-2 rounded-full bg-emerald-500"></span>
				ศูนย์: {currentShelterCode}
			</span>
			<span
				class="inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-800 shadow-2xs"
			>
				<Layers class="h-3.5 w-3.5 text-sky-600" />
				จุดแจกจ่ายส่วนหน้า
			</span>
		</div>
	</header>

	<!-- Lands with the tab strip just under the sticky shelter header, detail right below it -->
	<div bind:this={contentEl} class="-mt-6 flow-root h-0 scroll-mt-10" aria-hidden="true"></div>

	<!-- Mode switch: food and supplies work never share a screen -->
	<div
		role="group"
		aria-label="โหมดงานของโต๊ะแจก"
		class="grid grid-cols-2 gap-1 rounded-xl border border-slate-200 bg-slate-100/70 p-1 sm:max-w-sm"
	>
		{#each DESK_MODE_IDS as id (id)}
			{@const isActive = mode === id}
			{@const pending = isActive ? 0 : modePendingCount(allTickets, id)}
			<button
				type="button"
				aria-pressed={isActive}
				onclick={() => selectMode(id)}
				class="flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-bold transition-all {isActive
					? 'bg-white text-slate-900 shadow-xs ring-1 ring-slate-200'
					: 'text-slate-600 hover:bg-white/60'}"
			>
				{DESK_MODES[id].label}
				{#if pending > 0}
					<span
						class="rounded-full bg-amber-100 px-2 py-0.5 text-2xs font-bold whitespace-nowrap text-amber-900"
					>
						มีงาน {pending}
					</span>
				{/if}
			</button>
		{/each}
	</div>

	<!-- Station Tabs: the steps of the current mode; every step stays visible on a phone -->
	<div
		class="grid grid-cols-2 gap-2 lg:gap-3 {steps.length === 3
			? 'lg:grid-cols-3'
			: 'lg:grid-cols-4'}"
	>
		{#each steps as tab, i (tab)}
			{@const meta = TAB_STYLE[tab]}
			{@const badge = tabBadges[tab]}
			{@const isActive = activeTab === tab}
			<button
				type="button"
				onclick={() => selectTab(tab)}
				aria-pressed={isActive}
				class="flex min-h-14 min-w-0 flex-wrap items-center justify-between gap-2 rounded-xl border p-2.5 text-left transition-all focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:outline-none lg:p-3.5 {i ===
					steps.length - 1 && steps.length % 2 === 1
					? 'col-span-2 lg:col-span-1'
					: ''} {isActive ? meta.active : 'border-slate-200 bg-white hover:border-slate-300'}"
			>
				<div class="flex min-w-0 items-center gap-2 lg:gap-3">
					<div
						class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg {isActive
							? meta.icon
							: 'bg-slate-100 text-slate-600'}"
					>
						<meta.Icon class="h-4 w-4" />
					</div>
					<div class="min-w-0">
						<p class="text-sm leading-snug font-bold text-slate-900 lg:text-xs">
							{stepLabel(mode, tab)}
						</p>
						<p class="hidden text-2xs text-slate-500 lg:block">{STEP_TITLES[tab].subtitle}</p>
					</div>
				</div>
				{#if badge}
					<span
						class="shrink-0 rounded-full px-2 py-0.5 text-2xs font-bold whitespace-nowrap {meta.badge} {badge.pulse
							? 'animate-pulse'
							: ''}"
					>
						{badge.text}
					</span>
				{/if}
			</button>
		{/each}
	</div>

	<!-- Main Station Content Surface -->
	{#if ticketsQuery.isPending && allTickets.length === 0}
		<div
			class="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white py-16 text-xs text-slate-500 shadow-2xs"
		>
			<Loader class="h-5 w-5 animate-spin text-sky-600" />
			<span>กำลังโหลดข้อมูลตั๋วเบิกจ่าย...</span>
		</div>
	{:else if ticketsQuery.isError && allTickets.length === 0}
		<div class="rounded-2xl border border-red-200 bg-red-50/60 p-8 text-center shadow-xs">
			<AlertCircle class="mx-auto mb-2 h-8 w-8 text-red-500" />
			<h3 class="text-sm font-bold text-red-900">ไม่สามารถโหลดข้อมูลตั๋วเบิกจ่ายได้</h3>
			<p class="mt-1 text-xs text-red-700">
				{formatDistributionError(ticketsQuery.error, 'กรุณาตรวจสอบการเชื่อมต่อแล้วลองใหม่อีกครั้ง')}
			</p>
			<Button
				type="button"
				variant="outline"
				onclick={() => ticketsQuery.refetch()}
				class="mt-4 h-auto rounded-lg border-red-200 px-3 py-1.5 text-xs font-semibold text-red-800 hover:bg-red-50 hover:text-red-800"
			>
				<RefreshCw class="h-3.5 w-3.5" />
				<span>ลองใหม่</span>
			</Button>
		</div>
	{:else if activeTab === 'receive'}
		<!-- TAB 1: Receive Cargo Surface (Slice 5.3) -->
		<div class="space-y-4 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs">
			<div class="border-b border-slate-100 pb-3">
				<h2 class="text-base font-bold text-slate-900">
					รายการตั๋วสินค้าที่กำลังนำส่งมายังจุดแจกจ่าย
				</h2>
				<p class="text-xs text-slate-500">
					เมื่อรถขนส่งเดินทางมาถึงจุดแจกจ่าย ให้เจ้าหน้าที่ตรวจนับจำนวนของจริง
					และกดยืนยันรับเพื่อเปลี่ยนสถานะเป็น "กำลังแจกจ่าย"
				</p>
			</div>

			{#if inTransitTickets.length === 0}
				<div
					class="flex flex-col items-center justify-center py-12 text-center text-xs text-slate-500"
				>
					<Truck class="mb-2 h-10 w-10 text-slate-300" />
					<p class="font-semibold text-slate-700">ไม่มีตั๋วสินค้าที่กำลังนำส่งในขณะนี้</p>
					<p class="mt-0.5 text-2xs text-slate-400">
						ตั๋วที่คลังสินค้าปล่อยรถแล้วและกำลังนำส่ง จะแสดงที่นี่เพื่อให้จุดแจกตรวจรับ
					</p>
				</div>
			{:else}
				<div class="grid grid-cols-1 gap-4">
					{#each inTransitTickets as ticket (ticket._id)}
						<InTransitTicketCard
							{ticket}
							{unitOf}
							receiving={receivingTicketId === ticket._id}
							canReceive={canFrontline}
							onReceive={handleReceiveCargo}
						/>
					{/each}
				</div>
			{/if}
		</div>
	{:else if activeTab === 'food'}
		<!-- TAB 2: Food Handover Surface-->
		<div class="space-y-4">
			{#if showPointFilter || foodDayOptions.length > 2 || visibleFoodTickets.length > 1}
				<div class="space-y-4 rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs">
					{#if showPointFilter || foodDayOptions.length > 2}
						<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
							{#if showPointFilter}
								{@render pointSelect()}
							{/if}
							{#if foodDayOptions.length > 2}
								<div class="space-y-2">
									<p id="food-day-label" class="text-sm font-semibold text-slate-700">วันที่แจก</p>
									<div class="flex flex-wrap gap-2" role="group" aria-labelledby="food-day-label">
										{#each foodDayOptions as option (option.value)}
											{@const isOn = option.value === foodDay}
											<button
												type="button"
												aria-pressed={isOn}
												onclick={() => (pickedFoodDay = option.value)}
												class="h-12 rounded-lg border px-4 text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none {isOn
													? 'border-sky-500 bg-sky-50 text-sky-900'
													: 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}"
											>
												{option.label}
											</button>
										{/each}
									</div>
								</div>
							{/if}
						</div>
					{/if}
					{#if visibleFoodTickets.length > 1}
						<TicketPicker
							id="food-ticket"
							label="ตั๋วอาหาร"
							tickets={visibleFoodTickets}
							selectedId={selectedFoodTicketId}
							onPick={pickTicket((v) => (pickedFoodTicketId = v))}
						/>
					{/if}
				</div>
			{/if}
			{#if distributingFoodTickets.length === 0}
				<div
					class="flex flex-col items-center justify-center rounded-2xl border border-slate-200/80 bg-white p-12 text-center shadow-xs"
				>
					<UtensilsCrossed class="mb-3 h-12 w-12 text-slate-300" />
					<h3 class="text-sm font-bold text-slate-800">ไม่มีตั๋วอาหารที่เปิดแจกจ่ายอยู่ในขณะนี้</h3>
					<p class="mt-1 max-w-md text-xs text-slate-500">
						ตั๋วอาหารต้องได้รับการตรวจรับเข้าจุดแจกจ่ายก่อน จึงจะสามารถแจกจ่ายให้ผู้ประสบภัยได้
					</p>
					{#if inTransitTickets.length > 0}
						<Button
							type="button"
							variant="outline"
							onclick={() => selectTab('receive')}
							class="mt-4 h-auto rounded-xl border-sky-300 bg-sky-50 px-4 py-2 text-xs font-semibold text-sky-800 hover:bg-sky-100 hover:text-sky-800"
						>
							<Truck class="h-3.5 w-3.5" />
							<span>ไปยังแท็บรับของเพื่อตรวจรับตั๋วอาหารเข้าจุดแจก</span>
						</Button>
					{/if}
				</div>
			{:else if activeFoodTicket}
				<FoodDistributionCard ticket={activeFoodTicket} shelterCode={currentShelterCode} {drafts} />
				<DistributionHistory ticket={activeFoodTicket} shelterCode={currentShelterCode} />
			{/if}
		</div>
	{:else if activeTab === 'supplies'}
		<!-- TAB 3: Supplies & Loans Surface -->
		<div class="space-y-4">
			{#if showPointFilter || distributingSuppliesTickets.length > 1}
				<div class="space-y-4 rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs">
					{#if showPointFilter}
						<div class="md:max-w-sm">{@render pointSelect()}</div>
					{/if}
					{#if distributingSuppliesTickets.length > 1}
						<TicketPicker
							id="supplies-ticket"
							label="ตั๋วพัสดุ"
							tickets={distributingSuppliesTickets}
							selectedId={selectedSuppliesTicketId}
							onPick={pickTicket((v) => (pickedSuppliesTicketId = v))}
						/>
					{/if}
				</div>
			{/if}
			{#if distributingSuppliesTickets.length === 0}
				<div
					class="flex flex-col items-center justify-center rounded-2xl border border-slate-200/80 bg-white p-12 text-center shadow-xs"
				>
					<Package class="mb-3 h-12 w-12 text-slate-300" />
					<h3 class="text-sm font-bold text-slate-800">ไม่มีตั๋วพัสดุที่เปิดแจกจ่ายอยู่ในขณะนี้</h3>
					<p class="mt-1 max-w-md text-xs text-slate-500">
						ตั๋วพัสดุต้องได้รับการตรวจรับเข้าจุดแจกจ่ายก่อน จึงจะสามารถแจกจ่ายหรือให้ยืมได้
					</p>
					{#if inTransitTickets.length > 0}
						<Button
							type="button"
							variant="outline"
							onclick={() => selectTab('receive')}
							class="mt-4 h-auto rounded-xl border-sky-300 bg-sky-50 px-4 py-2 text-xs font-semibold text-sky-800 hover:bg-sky-100 hover:text-sky-800"
						>
							<Truck class="h-3.5 w-3.5" />
							<span>ไปยังแท็บรับของเพื่อตรวจรับตั๋วพัสดุเข้าจุดแจก</span>
						</Button>
					{/if}
				</div>
			{:else if activeSuppliesTicket}
				<SuppliesDistributionCard
					ticket={activeSuppliesTicket}
					shelterCode={currentShelterCode}
					{drafts}
				/>
				<DistributionHistory ticket={activeSuppliesTicket} shelterCode={currentShelterCode} />
			{/if}
		</div>
	{:else if activeTab === 'returns'}
		<!-- TAB 4: Loan Return Surface (Slice 5.5A + 5.5B) -->
		<div class="space-y-6">
			<LoanReturnCard shelterCode={currentShelterCode} />
			<!-- Bulk return pools (#659): the desk adds / moves / voids entries; open / edit / cancel stay
				 hidden (canManage). -->
			<BulkReturnPoolBoard
				shelterCode={currentShelterCode ?? undefined}
				initialPoolId={selectedPoolId}
				onSelectedPoolChange={selectPool}
			/>
		</div>
	{:else if activeTab === 'reconciliation'}
		<!-- TAB 5: Shift Reconciliation & Close Surface -->
		<div class="space-y-4">
			{#if showPointFilter || reconciliationEligibleTickets.length > 1}
				<div class="space-y-4 rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs">
					{#if showPointFilter}
						<div class="md:max-w-sm">{@render pointSelect()}</div>
					{/if}
					{#if reconciliationEligibleTickets.length > 1}
						<div class="space-y-2">
							<p id="close-out-group-label" class="text-sm font-semibold text-slate-700">
								สถานะตั๋ว
							</p>
							<div
								class="grid grid-cols-3 gap-2"
								role="group"
								aria-labelledby="close-out-group-label"
							>
								{#each CLOSE_OUT_GROUPS as group (group.id)}
									{@const count = reconciliationEligibleTickets.filter(
										(t) => closeOutGroup(t.status) === group.id
									).length}
									{@const isOn = group.id === closeOutGroupShown}
									<button
										type="button"
										aria-pressed={isOn}
										disabled={count === 0}
										onclick={() => {
											pickedCloseOutGroup = group.id;
											pickedReconciliationTicketId = '';
										}}
										class="flex min-h-12 flex-col items-center justify-center rounded-lg border px-2 py-1.5 text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 sm:flex-row sm:gap-1.5 {isOn
											? 'border-sky-500 bg-sky-50 text-sky-900'
											: 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}"
									>
										<span>{group.label}</span>
										<span class="tabular-nums">({count})</span>
									</button>
								{/each}
							</div>
						</div>
						{#if closeOutGroupTickets.length > 1}
							<TicketPicker
								id="reconciliation-ticket"
								label="ตั๋ว"
								tickets={closeOutGroupTickets}
								selectedId={selectedReconciliationTicketId}
								onPick={pickTicket((v) => (pickedReconciliationTicketId = v))}
							>
								{#snippet badges(t)}
									<TicketStatusBadge status={t.status} class="shrink-0" />
								{/snippet}
							</TicketPicker>
						{/if}
					{/if}
				</div>
			{/if}
			{#if reconciliationEligibleTickets.length === 0}
				<div
					class="flex flex-col items-center justify-center rounded-2xl border border-slate-200/80 bg-white p-12 text-center shadow-xs"
				>
					<Lock class="mb-3 h-12 w-12 text-slate-300" />
					<h3 class="text-sm font-bold text-slate-800">
						ไม่มีตั๋วที่เปิดแจกจ่ายหรือรอส่งคืนในขณะนี้
					</h3>
					<p class="mt-1 max-w-md text-xs text-slate-500">
						เมื่อตั๋วได้รับการตรวจรับเข้าจุดแจกแล้ว จะสามารถปิดรอบและกระทบยอดได้ที่แท็บนี้
					</p>
				</div>
			{:else}
				<!-- Pin the acted-on ticket: the fallback selection follows the food/supplies tabs and
					 would swap the card to another ticket once this one leaves DISTRIBUTING. -->
				<ShiftReconciliationCard
					ticket={activeReconciliationTicket}
					shelterCode={currentShelterCode}
					{unitOf}
					onShiftClosed={pinCloseOutTicket}
					onReturnsSubmitted={pinCloseOutTicket}
					{drafts}
				/>
			{/if}
		</div>
	{/if}

	<AlertDialog.Root
		open={pendingMode !== null}
		onOpenChange={(open) => {
			if (!open) cancelPending();
		}}
	>
		<AlertDialog.Content class="max-w-md">
			<AlertDialog.Header>
				<AlertDialog.Title>
					สลับไปโหมด{pendingMode ? DESK_MODES[pendingMode].label : ''}?
				</AlertDialog.Title>
				<AlertDialog.Description>
					ยังมีข้อมูลที่กรอกไว้แต่ยังไม่ได้บันทึก ถ้าสลับโหมด ข้อมูลนี้จะหายไป
				</AlertDialog.Description>
			</AlertDialog.Header>
			<AlertDialog.Footer>
				<AlertDialog.Cancel>อยู่โหมดเดิม</AlertDialog.Cancel>
				<AlertDialog.Action onclick={confirmPending}>สลับโหมด</AlertDialog.Action>
			</AlertDialog.Footer>
		</AlertDialog.Content>
	</AlertDialog.Root>
</div>

{#snippet pointSelect()}
	<div class="space-y-2">
		<Label for="point-select" class="text-sm font-semibold text-slate-700">จุดแจก</Label>
		<Select.Root type="single" bind:value={() => point, (v) => (pickedPoint = v)}>
			<Select.Trigger
				id="point-select"
				class="h-12 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-900 shadow-2xs"
			>
				<span class="truncate">{point === ALL_POINTS ? 'ทุกจุด' : point}</span>
			</Select.Trigger>
			<Select.Content>
				<Select.Item value={ALL_POINTS} label="ทุกจุด" />
				{#each pointOptions as option (option)}
					<Select.Item value={option} label={option} />
				{/each}
			</Select.Content>
		</Select.Root>
	</div>
{/snippet}
