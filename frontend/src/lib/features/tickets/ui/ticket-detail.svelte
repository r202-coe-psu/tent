<script lang="ts">
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import Check from '@lucide/svelte/icons/check';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import CircleDashed from '@lucide/svelte/icons/circle-dashed';
	import Ban from '@lucide/svelte/icons/ban';
	import ChefHat from '@lucide/svelte/icons/chef-hat';
	import PackageCheck from '@lucide/svelte/icons/package-check';
	import ClipboardList from '@lucide/svelte/icons/clipboard-list';
	import Truck from '@lucide/svelte/icons/truck';
	import PackageX from '@lucide/svelte/icons/package-x';
	import Lock from '@lucide/svelte/icons/lock';
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import * as Card from '$lib/components/ui/card';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { authStore } from '$lib/stores/auth.svelte';
	import { getShelterCode, resolveShelterCode } from '$lib/db/shelter';
	import { formatThaiDateTime } from '$lib/utils/date';
	import { persistQty, qtyGt, qtyStrCoerceNonNegativeSchema, subQty } from '$lib/utils/qty';
	import {
		useTicket,
		useApproveTicketWithAllocations,
		useDispatchTicket,
		useReceiveTicket,
		useCancelTicket,
		TICKET_STATUS_LABELS,
		type TicketItem,
		type TicketStatus
	} from '$lib/features/tickets';
	import { toLotPriorityItems, useLedger, useStockBalance } from '$lib/features/operations';
	import {
		PhysicalLotPicker,
		planAutoLotAllocation,
		sumDispatchAllocations,
		type DispatchLotAllocation
	} from '$lib/features/distribution';
	import { useMealPlans, toMealPlanMap } from '$lib/features/kitchen';
	import { useRecipes, formatUnit, useItemMasters, useUnitsOfMeasure } from '$lib/features/catalog';
	import { ticketActionsFor } from '../domain/ticket-actions';
	import { langState } from '$lib/states/i18n.svelte';

	let { id }: { id: string } = $props();

	const unitsQuery = useUnitsOfMeasure();
	const units = $derived(unitsQuery.data ?? []);
	const unitLabel = (code: string) => formatUnit(code, units, langState.current);

	const ticketQuery = useTicket(() => id);
	const ticket = $derived(ticketQuery.data ?? null);
	const plans = useMealPlans();
	const recipes = useRecipes(() => getShelterCode());
	const planById = $derived(toMealPlanMap(plans.data));
	const plan = $derived(ticket ? (planById[ticket.meal_plan_id] ?? null) : null);
	const recipeChip = $derived.by(() => {
		const recipeId = plan?.recipes?.[0]?.recipe_id;
		if (!recipeId || recipeId === 'recipe:custom') return null;
		const recipe = (recipes.data ?? []).find((r) => r._id === recipeId);
		return recipe ? `สูตร ${recipe.label}` : null;
	});
	const missionTitle = $derived(plan?.label ?? 'เมนูอาหาร');
	const missionQty = $derived(plan?.allocated_target ?? null);

	const approve = useApproveTicketWithAllocations();
	const stock = useStockBalance();
	const dispatch = useDispatchTicket();
	const ledgerQuery = useLedger();
	const itemMastersQuery = useItemMasters(() => getShelterCode());
	const receive = useReceiveTicket();
	const cancel = useCancelTicket();

	function ctx() {
		return { shelterCode: getShelterCode(), createdBy: authStore.user?.name ?? 'staff' };
	}

	// Same display-only labels as ticket-list.svelte (createTicketInputSchema defaults).
	const LOCATION_LABELS: Record<string, string> = {
		'warehouse:main': 'คลังเสบียงกลาง (ม.อ.)',
		kitchen: 'โรงครัวกลาง ประกอบอาหาร'
	};
	const locationLabel = (raw: string) => LOCATION_LABELS[raw] ?? raw;

	const STATUS_CLASS: Record<TicketStatus, string> = {
		PENDING_PICK: 'border border-amber-200 bg-amber-50 text-amber-900',
		READY_FOR_DISPATCH: 'border border-sky-200 bg-sky-50 text-sky-900',
		IN_TRANSIT: 'border border-indigo-200 bg-indigo-50 text-indigo-900',
		COMPLETED: 'border border-emerald-200 bg-emerald-50 text-emerald-900',
		CANCELLED: 'border border-slate-200 bg-slate-100 text-slate-600'
	};

	// Lifecycle shown as a stepper; `who` tells staff whose turn each step is.
	// `who` is split into phrases that never break mid-word: Thai has no spaces, so the browser
	// would otherwise cut a word like "ตัดสต็อก" in two at narrow widths.
	const STEPS: { status: Exclude<TicketStatus, 'CANCELLED'>; who: string[] }[] = [
		{ status: 'PENDING_PICK', who: ['คลังจัดของและอนุมัติ'] },
		{ status: 'READY_FOR_DISPATCH', who: ['คลังเลือก lot', 'ปล่อยของ', 'ตัดสต็อก'] },
		{ status: 'IN_TRANSIT', who: ['ครัวยืนยันรับ'] },
		{ status: 'COMPLETED', who: ['ครัวได้รับวัตถุดิบแล้ว'] }
	];
	const currentStep = $derived(ticket ? STEPS.findIndex((s) => s.status === ticket.status) : -1);

	// Which controls this user sees. Mirrors the VDU kitchen carve-out (rule 11); same shelter
	// resolution as the route guards (selected shelter, else the one in the roles).
	const actions = $derived(
		ticket
			? ticketActionsFor(ticket.status, authStore.user?.roles ?? [], resolveShelterCode())
			: { canAllocateApprove: false, canDispatch: false, canReceive: false, canCancel: false }
	);

	// Allocated qty is read-only once approved (warehouse edits only in PENDING_PICK).
	const qtyLocked = $derived(!!ticket && ticket.status !== 'PENDING_PICK');
	// Stock only matters to those who allocate (PENDING_PICK) or dispatch (READY_FOR_DISPATCH).
	const showStock = $derived(actions.canAllocateApprove || actions.canDispatch);

	// Grid templates are full literals so Tailwind can see them.
	const GRID_PENDING = 'sm:grid-cols-[minmax(0,1fr)_7rem_8rem_14rem]';
	const GRID_STOCK = 'sm:grid-cols-[minmax(0,1fr)_7rem_8rem_11rem]';
	const GRID_PLAIN = 'sm:grid-cols-[minmax(0,1fr)_7rem_11rem]';
	const GRID_LOT = 'sm:grid-cols-[minmax(0,1fr)_7rem_8rem_11rem_15rem]';
	// Lot step column (CR-178): only while the warehouse can dispatch.
	const showLotCol = $derived(
		!!ticket && ticket.status === 'READY_FOR_DISPATCH' && actions.canDispatch
	);
	const gridClass = $derived(
		!ticket
			? ''
			: showLotCol
				? GRID_LOT
				: ticket.status === 'PENDING_PICK' && showStock
					? GRID_PENDING
					: showStock
						? GRID_STOCK
						: GRID_PLAIN
	);

	// ---- warehouse allocation (PENDING_PICK) ----
	// Draft per line; defaults to the saved qty, or to what the kitchen requested
	// when nothing is saved yet ('0'). Approve writes all drafts in one go.
	let allocDraft = $state<Record<string, string>>({});

	function draftFor(item: TicketItem): string {
		return (
			allocDraft[item.item_id] ??
			(item.allocated_qty === '0' ? item.requested_qty : item.allocated_qty)
		);
	}
	function parseDraft(item: TicketItem): string | null {
		const parsed = qtyStrCoerceNonNegativeSchema.safeParse(draftFor(item).trim());
		return parsed.success ? persistQty(parsed.data) : null;
	}
	// ---- stock on hand (same ledger balance dispatchTicket checks) ----
	const stockReady = $derived(!stock.isPending && !stock.isError && !!stock.data);
	function onHandFor(item: TicketItem): string {
		return stock.data?.get(item.item_id) ?? '0';
	}
	/** Qty this line will leave the warehouse with: the draft while picking, saved qty after. */
	function plannedQty(item: TicketItem): string | null {
		return ticket?.status === 'PENDING_PICK' ? parseDraft(item) : item.allocated_qty;
	}
	function stockShortBy(item: TicketItem): string | null {
		if (!showStock || !stockReady) return null;
		const qty = plannedQty(item);
		if (qty === null || !qtyGt(qty, 0)) return null; // a 0 line never draws stock
		return qtyGt(qty, onHandFor(item)) ? subQty(qty, onHandFor(item)) : null;
	}

	const shortStockCount = $derived(
		ticket && showStock ? ticket.items.filter((i) => stockShortBy(i) !== null).length : 0
	);
	const hasInvalidDraft = $derived(!!ticket && ticket.items.some((i) => parseDraft(i) === null));
	/** Every line is 0 → nothing would be supplied, so approval is blocked. */
	const allZeroDraft = $derived(
		!!ticket &&
			ticket.items.length > 0 &&
			ticket.items.every((i) => {
				const q = parseDraft(i);
				return q !== null && !qtyGt(q, 0);
			})
	);
	const canApprove = $derived(
		actions.canAllocateApprove &&
			!!ticket &&
			ticket.items.length > 0 &&
			!hasInvalidDraft &&
			!allZeroDraft &&
			stockReady &&
			shortStockCount === 0
	);

	// ---- lot picking at dispatch (CR-178) ----
	// Lines the warehouse supplies (allocated > 0); a 0 line needs no lot and writes no ledger row.
	const dispatchLines = $derived(
		ticket && actions.canDispatch && ticket.status === 'READY_FOR_DISPATCH'
			? ticket.items.filter((i) => qtyGt(i.allocated_qty, 0))
			: []
	);
	const lotsReady = $derived(!ledgerQuery.isPending && !itemMastersQuery.isPending);
	/** Auto plan per line (CR-143 §A order, expired lots excluded) — the default the picker starts from. */
	const autoPlans = $derived.by(() => {
		const plans: Record<string, { allocations: DispatchLotAllocation[]; valid: boolean }> = {};
		if (!lotsReady) return plans;
		const priority = toLotPriorityItems(itemMastersQuery.data ?? []);
		for (const item of dispatchLines) {
			const plan = planAutoLotAllocation(
				ledgerQuery.data,
				item.item_id,
				item.allocated_qty,
				priority
			);
			plans[item.item_id] = {
				allocations: plan.allocations.map((a) => ({ lot_ref: a.lot_ref, qty: a.qty })),
				valid: plan.complete
			};
		}
		return plans;
	});
	// What the warehouse changed in a picker; falls back to the auto plan until touched.
	let lotEdits = $state<Record<string, { allocations: DispatchLotAllocation[]; valid: boolean }>>(
		{}
	);
	const lotSelection = (itemId: string) => lotEdits[itemId] ?? autoPlans[itemId];
	const invalidLotCount = $derived(
		dispatchLines.filter((i) => !lotSelection(i.item_id)?.valid).length
	);
	const canDispatch = $derived(actions.canDispatch && lotsReady && invalidLotCount === 0);

	/** Why a line's lot selection is not valid, for the summary badge. */
	function lotProblem(itemId: string): string {
		const edited = lotEdits[itemId];
		if (!edited && autoPlans[itemId] && !autoPlans[itemId].valid) return 'lot ที่ใช้ได้ไม่พอ';
		return 'ยังเลือกไม่ครบ';
	}

	// "จัดการ lot" modal: works on a draft copy of one line; commit only on save.
	let lotDialogOpen = $state(false);
	let lotDialogItemId = $state<string | null>(null);
	let lotDraft = $state<{ allocations: DispatchLotAllocation[]; valid: boolean }>({
		allocations: [],
		valid: false
	});
	const lotDialogItem = $derived(dispatchLines.find((i) => i.item_id === lotDialogItemId) ?? null);

	function openLotDialog(item: TicketItem) {
		const current = lotSelection(item.item_id);
		lotDraft = {
			allocations: (current?.allocations ?? []).map((a) => ({ ...a })),
			valid: current?.valid ?? false
		};
		lotDialogItemId = item.item_id;
		lotDialogOpen = true;
	}
	function saveLotDraft() {
		if (!lotDialogItemId || !lotDraft.valid) return;
		lotEdits[lotDialogItemId] = { allocations: lotDraft.allocations, valid: true };
		lotDialogOpen = false;
	}

	async function handleApprove() {
		if (!ticket) return;
		const allocations: Record<string, string> = {};
		for (const item of ticket.items) {
			const qty = parseDraft(item);
			if (qty === null) {
				toast.error(`จำนวนของ "${item.item_name}" ไม่ถูกต้อง`);
				return;
			}
			allocations[item.item_id] = qty;
		}
		try {
			await approve.mutateAsync({ ticket, allocations, ctx: ctx() });
			allocDraft = {};
			toast.success('อนุมัติแล้ว รอคลังปล่อยของ');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'อนุมัติไม่สำเร็จ');
		}
	}

	async function handleDispatch() {
		if (!ticket || !canDispatch) return;
		try {
			const lotsByItem: Record<string, DispatchLotAllocation[]> = {};
			for (const item of dispatchLines) {
				lotsByItem[item.item_id] = lotSelection(item.item_id)?.allocations ?? [];
			}
			await dispatch.mutateAsync({ ticket, lotsByItem, ctx: ctx() });
			toast.success('ปล่อยของแล้ว ตัดสต็อกเรียบร้อย');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'ปล่อยของไม่สำเร็จ');
		}
	}

	async function handleReceive() {
		if (!ticket) return;
		try {
			await receive.mutateAsync({ ticket, ctx: ctx() });
			toast.success('ยืนยันรับวัตถุดิบแล้ว');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'ยืนยันรับไม่สำเร็จ');
		}
	}

	let cancelDialogOpen = $state(false);

	async function confirmCancel() {
		if (!ticket) return;
		try {
			await cancel.mutateAsync({ ticket });
			toast.success('ยกเลิกตั๋วแล้ว');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'ยกเลิกไม่สำเร็จ');
		} finally {
			cancelDialogOpen = false;
		}
	}
</script>

<div class="min-h-full bg-[#F8FAFC]">
	<div class="mx-auto max-w-[110rem] space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
		<Button
			variant="ghost"
			href={resolve('/back-office/tickets/kitchen')}
			class="-ml-2 gap-1.5 text-slate-600"
		>
			<ArrowLeft class="h-4 w-4" />
			กลับไปคิวตั๋ว
		</Button>

		{#if ticketQuery.isPending}
			<p class="py-12 text-center text-sm text-muted-foreground">กำลังโหลด...</p>
		{:else if !ticket}
			<p class="py-12 text-center text-sm text-muted-foreground">ไม่พบตั๋วนี้</p>
		{:else}
			<!-- Header: what, how much, which ticket, where it is in the flow -->
			<section
				class="space-y-5 rounded-2xl border border-orange-200 bg-white p-5 shadow-2xs sm:p-7"
			>
				<div class="flex flex-wrap items-start justify-between gap-3">
					<div class="space-y-2">
						<div
							class="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600"
						>
							<ChefHat class="h-3.5 w-3.5" />ใบเบิกวัตถุดิบเข้าครัว
						</div>
						<h1 class="text-3xl font-extrabold tracking-tight text-[#0A2647] sm:text-4xl">
							{missionTitle}
							{#if missionQty}
								<span class="font-semibold text-slate-500 tabular-nums">· {missionQty} กล่อง</span>
							{/if}
						</h1>
						<div class="flex flex-wrap items-center gap-2">
							<span
								class="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-sm font-semibold text-slate-700 tabular-nums"
							>
								{ticket.ticket_no}
							</span>
							{#if recipeChip}
								<span class="badge-domain-kitchen rounded-full px-2.5 py-1 text-xs font-semibold">
									{recipeChip}
								</span>
							{/if}
						</div>
					</div>
					<span
						class="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold {STATUS_CLASS[
							ticket.status
						]}"
					>
						{#if ticket.status === 'CANCELLED'}
							<Ban class="h-4 w-4" />
						{:else if ticket.status === 'COMPLETED'}
							<CheckCircle2 class="h-4 w-4" />
						{:else}
							<CircleDashed class="h-4 w-4" />
						{/if}
						{TICKET_STATUS_LABELS[ticket.status]}
					</span>
				</div>

				{#if ticket.status === 'CANCELLED'}
					<div
						class="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-100 p-3 text-sm font-semibold text-slate-600"
					>
						<Ban class="h-4 w-4" />
						ตั๋วนี้ถูกยกเลิกแล้ว ไม่มีการตัดสต็อก
					</div>
				{:else}
					<ol
						class="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-3 sm:grid-cols-[repeat(4,minmax(0,1fr))]"
						aria-label="ขั้นตอนของตั๋ว"
					>
						{#each STEPS as step, i (step.status)}
							{@const done = i < currentStep || ticket.status === 'COMPLETED'}
							{@const active = i === currentStep && ticket.status !== 'COMPLETED'}
							<li
								class="flex min-w-0 items-start gap-2.5 rounded-xl border p-3 {active
									? 'border-sky-200 bg-sky-50'
									: 'border-slate-200/80 bg-white'}"
								aria-current={active ? 'step' : undefined}
							>
								<span
									class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums {done
										? 'bg-emerald-600 text-white'
										: active
											? 'bg-sky-600 text-white'
											: 'bg-slate-100 text-slate-500'}"
								>
									{#if done}
										<Check class="h-3.5 w-3.5" />
										<span class="sr-only">เสร็จแล้ว</span>
									{:else}
										{i + 1}
									{/if}
								</span>
								<div class="min-w-0">
									<p
										class="text-sm font-semibold {active
											? 'text-sky-900'
											: done
												? 'text-slate-900'
												: 'text-slate-500'}"
									>
										{TICKET_STATUS_LABELS[step.status]}
									</p>
									<p class="hidden flex-wrap gap-x-1 text-xs text-slate-500 sm:flex">
										{#each step.who as phrase (phrase)}
											<span class="whitespace-nowrap">{phrase}</span>
										{/each}
									</p>
								</div>
							</li>
						{/each}
					</ol>
					{#if currentStep >= 0}
						<!-- Phones: one line for whose turn it is, instead of four cramped subtitles. -->
						<p class="text-sm text-slate-600 sm:hidden">
							ขั้นนี้: <span class="font-semibold text-slate-900"
								>{STEPS[currentStep].who.join(' ')}</span
							>
						</p>
					{/if}
				{/if}
			</section>

			<Card.Root class="rounded-2xl border border-slate-200/80 bg-white shadow-2xs">
				<Card.Header class="border-b pb-4">
					<Card.Title class="flex items-center gap-2 text-base font-bold text-slate-900">
						<ClipboardList class="h-4 w-4 text-slate-500" />
						ข้อมูลตั๋ว
					</Card.Title>
				</Card.Header>
				<Card.Content class="space-y-4 pt-4">
					<div class="flex flex-wrap items-center gap-2 text-base font-semibold text-slate-900">
						<Truck class="h-4 w-4 text-slate-500" />
						<span>{locationLabel(ticket.source_location)}</span>
						<ArrowRight class="h-4 w-4 text-slate-400" />
						<span>{locationLabel(ticket.destination_location)}</span>
					</div>
					<dl class="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
						{@render field('เปิดตั๋วเมื่อ', formatThaiDateTime(ticket.created_at))}
						{@render field('อัปเดตล่าสุด', formatThaiDateTime(ticket.updated_at))}
						{@render field('เปิดตั๋วโดย (ครัว)', ticket.requested_by)}
						{@render field('อนุมัติโดย', ticket.approved_by)}
						{@render field('ปล่อยของโดย (คลัง)', ticket.dispatched_by)}
						{@render field('รับของโดย (ครัว)', ticket.received_by)}
					</dl>
					{#if ticket.notes}
						<p class="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
							{ticket.notes}
						</p>
					{/if}
				</Card.Content>
			</Card.Root>

			<Card.Root
				class="gap-0 overflow-hidden rounded-2xl border border-slate-200/80 bg-white py-0 shadow-2xs"
			>
				<Card.Header class="gap-1 border-b border-slate-200/80 px-4 py-4 sm:px-5">
					<div class="flex flex-wrap items-center justify-between gap-3">
						<Card.Title class="flex items-center gap-2 text-base font-bold text-slate-900">
							<PackageCheck class="h-4 w-4 text-slate-500" />
							รายการวัตถุดิบ
							<span class="text-sm font-normal text-slate-500 tabular-nums"
								>({ticket.items.length} รายการ)</span
							>
						</Card.Title>
						{#if qtyLocked}
							<span class="inline-flex items-center gap-1.5 text-sm text-slate-500">
								<Lock class="h-3.5 w-3.5" />
								จำนวนถูกล็อกหลังอนุมัติแล้ว
							</span>
						{/if}
					</div>
					{#if showLotCol}
						<p class="text-sm text-slate-500">
							ระบบเติม lot ให้ตามลำดับที่ควรใช้ก่อน ปล่อยของได้เลยถ้าครบทุกรายการ หรือกด "จัดการ
							lot" เพื่อแก้ ห้ามใช้ lot ที่หมดอายุ
						</p>
					{/if}
					{#if actions.canAllocateApprove}
						<p class="text-sm text-slate-500">
							ตรวจจำนวนที่คลังจัดได้จริงของแต่ละรายการเทียบกับของคงเหลือในคลัง แก้ได้ถ้าของไม่พอ
							แล้วกดอนุมัติ ระบบจะบันทึกจำนวนให้
						</p>
					{/if}
				</Card.Header>
				<Card.Content class="p-0">
					<!-- Header row (sm+). Mobile stacks each item into its own block instead. -->
					<div
						class="hidden gap-4 bg-slate-50 px-5 py-2.5 text-sm font-semibold text-slate-600 sm:grid {gridClass}"
					>
						<span>รายการ</span>
						<span class="text-right">ครัวขอเบิก</span>
						{#if showStock}
							<span class="text-right">คงเหลือในคลัง</span>
						{/if}
						<!-- Editable rows put a fixed-width unit (w-16 + gap-2) after the input — line the
						     header up with the input, not the unit. -->
						<span class="text-right {actions.canAllocateApprove ? 'pr-[4.5rem]' : ''}"
							>คลังจัดให้</span
						>
						{#if showLotCol}
							<span class="text-right">lot ที่จะปล่อย</span>
						{/if}
					</div>
					<ul class="divide-y divide-slate-200/80">
						{#each ticket.items as item (item.item_id)}
							{@const pending = actions.canAllocateApprove}
							{@const awaitingPick = ticket.status === 'PENDING_PICK' && !pending}
							{@const parsed = parseDraft(item)}
							{@const stockShort = stockShortBy(item)}
							{@const draftZero = pending && parsed !== null && !qtyGt(parsed, 0)}
							{@const draftShort =
								pending && parsed !== null && qtyGt(parsed, 0) && qtyGt(item.requested_qty, parsed)}
							{@const lockedZero = qtyLocked && !qtyGt(item.allocated_qty, 0)}
							{@const diffShown = qtyLocked && ticket.status !== 'CANCELLED'}
							{@const lockedShort =
								diffShown && !lockedZero && qtyGt(item.requested_qty, item.allocated_qty)}
							<li
								class="grid grid-cols-[minmax(0,1fr)] gap-x-4 gap-y-2 px-4 py-3.5 sm:items-center sm:px-5 {gridClass} {stockShort
									? 'border border-red-200 bg-red-50'
									: ''}"
							>
								<div class="min-w-0">
									<p class="text-base font-semibold break-words text-slate-900">{item.item_name}</p>
									{#if stockShort}
										<p class="mt-0.5 flex items-center gap-1 text-sm font-semibold text-red-800">
											<CircleAlert class="h-4 w-4 shrink-0" />
											<span class="tabular-nums"
												>สต็อกไม่พอ ขาด {stockShort} {unitLabel(item.unit)}</span
											>
										</p>
									{/if}
									{#if draftZero}
										<p class="mt-0.5 flex items-center gap-1 text-xs font-semibold text-amber-800">
											<PackageX class="h-3.5 w-3.5 shrink-0" />
											ไม่จัดให้รายการนี้
										</p>
									{:else if draftShort}
										<p class="mt-0.5 flex items-center gap-1 text-xs font-semibold text-amber-800">
											<CircleAlert class="h-3.5 w-3.5" />
											จัดได้น้อยกว่าที่ขอ
										</p>
									{/if}
								</div>

								<div class="flex items-baseline justify-between gap-2 sm:justify-end">
									<span class="text-sm text-slate-500 sm:hidden">ครัวขอเบิก</span>
									<span class="text-base text-slate-700 tabular-nums">
										{item.requested_qty}
										<span class="text-sm text-slate-500">{unitLabel(item.unit)}</span>
									</span>
								</div>

								{#if showStock}
									<div class="flex items-baseline justify-between gap-2 sm:justify-end">
										<span class="text-sm text-slate-500 sm:hidden">คงเหลือในคลัง</span>
										{#if stock.isPending}
											<span class="text-sm text-slate-400">กำลังโหลด...</span>
										{:else if !stockReady}
											<span class="text-sm text-slate-500">โหลดสต็อกไม่สำเร็จ</span>
										{:else}
											<span
												class="text-base tabular-nums {stockShort
													? 'font-semibold text-red-800'
													: 'text-slate-700'}"
											>
												{onHandFor(item)}
												<span class="text-sm {stockShort ? 'text-red-800' : 'text-slate-500'}"
													>{unitLabel(item.unit)}</span
												>
											</span>
										{/if}
									</div>
								{/if}

								{#if pending}
									<div class="flex items-center justify-between gap-2 sm:justify-end">
										<span class="text-sm text-slate-500 sm:hidden">คลังจัดให้</span>
										<div class="flex items-center gap-2">
											<label for="alloc-{item.item_id}" class="sr-only"
												>จำนวนที่คลังจัดให้ {item.item_name}</label
											>
											<Input
												id="alloc-{item.item_id}"
												class="h-11 w-28 text-right text-base font-semibold tabular-nums sm:h-10"
												inputmode="decimal"
												aria-invalid={parsed === null || !!stockShort}
												value={draftFor(item)}
												oninput={(e) => (allocDraft[item.item_id] = e.currentTarget.value)}
											/>
											<span class="w-16 text-left text-sm text-slate-500"
												>{unitLabel(item.unit)}</span
											>
										</div>
									</div>
								{:else if awaitingPick}
									<div class="flex items-baseline justify-between gap-2 sm:justify-end">
										<span class="text-sm text-slate-500 sm:hidden">คลังจัดให้</span>
										<span class="text-sm text-slate-500">รอคลังจัด</span>
									</div>
								{:else}
									<div class="flex flex-col gap-0.5 sm:items-end">
										<div class="flex items-baseline justify-between gap-2 sm:justify-end">
											<span class="text-sm text-slate-500 sm:hidden">คลังจัดให้</span>
											<span class="text-base font-semibold text-slate-900 tabular-nums">
												{item.allocated_qty}
												<span class="text-sm font-normal text-slate-500"
													>{unitLabel(item.unit)}</span
												>
											</span>
										</div>
										{#if diffShown}
											{#if lockedZero}
												<span
													class="inline-flex items-center gap-1 self-end text-sm font-semibold text-amber-800"
												>
													<PackageX class="h-3.5 w-3.5" />
													ไม่ได้จัดให้
												</span>
											{:else if lockedShort}
												<span
													class="inline-flex items-center gap-1 self-end text-sm font-semibold text-amber-800 tabular-nums"
												>
													<CircleAlert class="h-3.5 w-3.5" />
													ขาด {subQty(item.requested_qty, item.allocated_qty)}
													{unitLabel(item.unit)}
												</span>
											{/if}
										{/if}
									</div>
								{/if}

								{#if showLotCol}
									{@const lotLine = qtyGt(item.allocated_qty, 0)}
									{@const sel = lotSelection(item.item_id)}
									{@const ok = sel?.valid === true}
									{@const picked = sumDispatchAllocations(sel?.allocations ?? [])}
									<div class="flex flex-col gap-2 sm:items-end">
										<span class="text-sm text-slate-500 sm:hidden">lot ที่จะปล่อย</span>
										{#if !lotLine}
											<span class="text-base text-slate-400">—</span>
										{:else if !lotsReady}
											<span class="text-sm text-slate-500">กำลังโหลด lot...</span>
										{:else}
											<div class="flex flex-wrap items-center gap-2 sm:justify-end">
												{#if ok}
													<span
														class="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-sm font-semibold text-emerald-800"
													>
														<Check class="h-4 w-4" />
														<span class="tabular-nums">{sel?.allocations.length ?? 0} lot</span> พร้อมปล่อย
													</span>
												{:else}
													<span
														class="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-sm font-semibold text-red-800"
													>
														<CircleAlert class="h-4 w-4" />
														{lotProblem(item.item_id)}
													</span>
												{/if}
												<Button
													variant="outline"
													class="h-11 sm:h-9"
													disabled={dispatch.isPending}
													onclick={() => openLotDialog(item)}
												>
													จัดการ lot
												</Button>
											</div>
											{#if !ok}
												<span class="text-sm text-slate-600 tabular-nums">
													เลือกแล้ว <span class="font-semibold">{picked}</span> / {item.allocated_qty}
													{unitLabel(item.unit)}
												</span>
											{/if}
										{/if}
									</div>
								{/if}
							</li>
						{/each}
					</ul>
				</Card.Content>
			</Card.Root>

			<!-- Action bar — controls are role-gated client-side (ticketActionsFor) and hidden, not
			     disabled, when the user cannot act. The hint says whose turn it is. The CouchDB
			     validate_doc_update guard (shelter-access-design.ts) is the real authorization boundary. -->
			{#if ticket.status !== 'COMPLETED' && ticket.status !== 'CANCELLED'}
				<div
					class="sticky bottom-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white p-3 shadow-xs"
				>
					<p class="text-sm text-slate-600">
						{#if actions.canDispatch && ticket.status === 'READY_FOR_DISPATCH'}
							{#if !lotsReady}
								กำลังโหลด lot ในคลัง...
							{:else if invalidLotCount > 0}
								<span class="inline-flex items-center gap-1.5 font-semibold text-red-800">
									<CircleAlert class="h-4 w-4" />
									เลือก lot ยังไม่ครบหรือไม่ถูกต้อง {invalidLotCount} รายการ ผลรวมต้องเท่ากับจำนวนที่ปล่อย
									และห้ามใช้ lot ที่หมดอายุ
								</span>
							{:else}
								ปล่อยของแล้วระบบจะตัดสต็อกตาม lot ที่เลือก
							{/if}
						{:else if actions.canAllocateApprove || actions.canDispatch}
							{#if stock.isPending}
								กำลังตรวจสต็อกคงเหลือ...
							{:else if !stockReady}
								โหลดสต็อกคงเหลือไม่สำเร็จ ตรวจสอบการเชื่อมต่อแล้วลองใหม่
							{:else if shortStockCount > 0}
								<span class="inline-flex items-center gap-1.5 font-semibold text-red-800">
									<CircleAlert class="h-4 w-4" />
									สต็อกไม่พอ {shortStockCount} รายการ
									{ticket.status === 'PENDING_PICK'
										? 'แก้จำนวนหรือรับของเข้าคลังก่อน'
										: 'รับของเข้าคลังก่อนปล่อยของ'}
								</span>
							{:else if actions.canAllocateApprove}
								{#if hasInvalidDraft}
									มีจำนวนที่กรอกไม่ถูกต้อง แก้ก่อนอนุมัติ
								{:else if allZeroDraft}
									ต้องจัดให้อย่างน้อย 1 รายการ
								{:else}
									กดอนุมัติเพื่อบันทึกจำนวนและส่งให้คลังปล่อยของ
								{/if}
							{:else}
								ปล่อยของแล้วระบบจะตัดสต็อกตามจำนวนที่คลังจัดให้
							{/if}
						{:else if actions.canReceive}
							คลังปล่อยของแล้ว กดยืนยันเมื่อได้รับวัตถุดิบ
						{:else if ticket.status === 'PENDING_PICK'}
							รอคลังจัดของและอนุมัติ
						{:else if ticket.status === 'READY_FOR_DISPATCH'}
							รอคลังปล่อยของ
						{:else}
							รอครัวยืนยันรับวัตถุดิบ
						{/if}
					</p>
					<div class="flex w-full flex-wrap items-center gap-2 sm:w-auto">
						{#if actions.canCancel}
							<Button
								variant="ghost"
								class="h-11 flex-1 text-destructive hover:bg-destructive/10 sm:h-10 sm:flex-none"
								disabled={cancel.isPending}
								onclick={() => (cancelDialogOpen = true)}
							>
								ยกเลิกตั๋ว
							</Button>
						{/if}
						{#if actions.canAllocateApprove}
							<Button
								class="h-11 flex-1 gap-1.5 sm:h-10 sm:flex-none"
								disabled={approve.isPending || !canApprove}
								onclick={handleApprove}
							>
								<CheckCircle2 class="h-4 w-4" />
								{approve.isPending ? 'กำลังอนุมัติ...' : 'อนุมัติ'}
							</Button>
						{:else if actions.canDispatch}
							<Button
								class="h-11 flex-1 gap-1.5 sm:h-10 sm:flex-none"
								disabled={dispatch.isPending || !canDispatch}
								onclick={handleDispatch}
							>
								<Truck class="h-4 w-4" />
								{dispatch.isPending ? 'กำลังปล่อยของ...' : 'ปล่อยของและตัดสต็อก'}
							</Button>
						{:else if actions.canReceive}
							<Button
								class="h-11 flex-1 gap-1.5 sm:h-10 sm:flex-none"
								disabled={receive.isPending}
								onclick={handleReceive}
							>
								<PackageCheck class="h-4 w-4" />
								{receive.isPending ? 'กำลังยืนยัน...' : 'ยืนยันรับวัตถุดิบ'}
							</Button>
						{/if}
					</div>
				</div>
			{/if}
		{/if}
	</div>
</div>

{#snippet field(label: string, value: string | undefined)}
	<div>
		<dt class="text-slate-500">{label}</dt>
		<dd class="mt-0.5 font-semibold text-slate-900">{value || '—'}</dd>
	</div>
{/snippet}

<AlertDialog.Root bind:open={cancelDialogOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>ยกเลิกตั๋ว {ticket?.ticket_no ?? ''}?</AlertDialog.Title>
			<AlertDialog.Description>
				ตั๋วที่ยกเลิกแล้วจะกู้คืนไม่ได้ และจะไม่มีการตัดสต็อก
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel disabled={cancel.isPending}>ไม่ยกเลิก</AlertDialog.Cancel>
			<AlertDialog.Action
				class="bg-destructive text-white hover:bg-destructive/90"
				disabled={cancel.isPending}
				onclick={(e) => {
					e.preventDefault();
					confirmCancel();
				}}
			>
				{cancel.isPending ? 'กำลังยกเลิก...' : 'ยกเลิกตั๋ว'}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<Dialog.Root bind:open={lotDialogOpen}>
	<Dialog.Content class="flex max-h-[90dvh] flex-col gap-3 sm:max-w-2xl">
		<Dialog.Header>
			<Dialog.Title>จัดการ lot</Dialog.Title>
			<Dialog.Description>
				เลือกจำนวนจากแต่ละ lot ให้รวมเท่ากับจำนวนที่ต้องปล่อย แล้วกดบันทึก
			</Dialog.Description>
		</Dialog.Header>
		<div class="min-h-0 flex-1 overflow-y-auto pr-1">
			{#if lotDialogItem}
				{#key lotDialogItem.item_id}
					<PhysicalLotPicker
						itemId={lotDialogItem.item_id}
						itemName={lotDialogItem.item_name}
						unit={unitLabel(lotDialogItem.unit)}
						allocatedQty={lotDialogItem.allocated_qty}
						allocations={lotDraft.allocations}
						onChange={(allocations, valid) => (lotDraft = { allocations, valid })}
					/>
				{/key}
			{/if}
		</div>
		<Dialog.Footer class="gap-2">
			<Button variant="outline" class="h-11" onclick={() => (lotDialogOpen = false)}>ยกเลิก</Button>
			<Button class="h-11" disabled={!lotDraft.valid} onclick={saveLotDraft}>บันทึก</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
