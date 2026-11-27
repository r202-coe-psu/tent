<script lang="ts">
	import ClipboardList from '@lucide/svelte/icons/clipboard-list';
	import Clock3 from '@lucide/svelte/icons/clock-3';
	import Flame from '@lucide/svelte/icons/flame';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import PackageCheck from '@lucide/svelte/icons/package-check';
	import Search from '@lucide/svelte/icons/search';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import ArrowDown from '@lucide/svelte/icons/arrow-down';
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import ChefHat from '@lucide/svelte/icons/chef-hat';
	import Settings2 from '@lucide/svelte/icons/settings-2';
	import Layers from '@lucide/svelte/icons/layers';
	import Info from '@lucide/svelte/icons/info';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import * as Table from '$lib/components/ui/table';
	import * as Select from '$lib/components/ui/select';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { useTickets, TICKET_STATUS_LABELS, type TicketStatus } from '$lib/features/tickets';
	import {
		useMealPlans,
		useMealServices,
		useMealServiceReceipts,
		mealServiceReceiptOutcome,
		MEAL_PERIOD_LABELS,
		toMealPlanMap,
		mealServiceRef,
		type MealPlan,
		type MealService
	} from '$lib/features/kitchen';
	import { useRecipes } from '$lib/features/catalog';
	import { getShelterCode } from '$lib/db/shelter';
	import { formatThaiShortDate, formatThaiTime } from '$lib/utils/date';

	const tickets = useTickets();
	const plans = useMealPlans();
	const services = useMealServices();
	const receipts = useMealServiceReceipts();
	const recipes = useRecipes(() => getShelterCode());
	const planById = $derived(toMealPlanMap(plans.data));

	// Real doc values are always the same two codes today (createTicketInputSchema
	// defaults) — friendlier Thai labels for display only, not a schema change.
	const LOCATION_LABELS: Record<string, string> = {
		'warehouse:main': 'คลังเสบียงกลาง (ม.อ.)',
		kitchen: 'โรงครัวกลาง ประกอบอาหาร'
	};
	function locationLabel(raw: string): string {
		return LOCATION_LABELS[raw] ?? raw;
	}

	function recipeChipFor(plan: MealPlan | undefined): string | undefined {
		const recipeId = plan?.recipes?.[0]?.recipe_id;
		if (!recipeId || recipeId === 'recipe:custom') return undefined;
		const recipe = (recipes.data ?? []).find((r) => r._id === recipeId);
		return recipe ? `สูตร ${recipe.label}` : undefined;
	}

	// This page combines real data sources into one view, purely for display —
	// no new persisted doc type beyond `meal_service_receipt` (CR-144). "รับเข้า"
	// rows are derived read-only from meal_service + meal_service_receipt: a
	// service without a matching receipt is "รอตรวจรับเข้าคลัง" (PENDING_RECEIPT,
	// real state — warehouse hasn't confirmed count yet); once a receipt exists
	// it becomes "รับเข้าคลังแล้ว" (DELIVERED_IN) — the flow ends at warehouse
	// stock-in, CR-147 removed the CR-146 POS-push split. "จ่ายออก" rows are the
	// real requisition_ticket lifecycle unchanged.
	type RowCategory = 'PENDING_PICK' | 'COOKING' | 'PENDING_RECEIPT' | 'DELIVERED_IN' | 'OTHER_OUT';
	type UnifiedRow = {
		key: string;
		code: string;
		direction: 'in' | 'out' | 'internal';
		fromLabel: string;
		toLabel: string;
		missionTitle: string;
		recipeChip?: string;
		requestedCount?: number;
		producedQty?: number;
		unit?: string;
		createdAt: string;
		category: RowCategory;
		statusLabel: string;
		statusClass: string;
		manage: ManageTarget;
	};

	// Where "จัดการ" goes — kept as data so every goto() below resolves a literal route.
	type ManageTarget =
		| { kind: 'ticket'; ticketId: string }
		| { kind: 'board'; sessionId: string; planId: string }
		| { kind: 'receive'; sessionId: string; planId: string }
		| { kind: 'kitchen' };

	function openManage(target: ManageTarget) {
		switch (target.kind) {
			case 'ticket':
				return goto(resolve(`/back-office/tickets/${encodeURIComponent(target.ticketId)}`));
			case 'board':
				return goto(
					resolve(
						`/back-office/kitchen/production-board/${target.sessionId}?plan_id=${target.planId}&stage=C`
					)
				);
			case 'receive':
				return goto(
					resolve(`/back-office/kitchen/receive-stock/${target.sessionId}?plan_id=${target.planId}`)
				);
			case 'kitchen':
				return goto(resolve('/back-office/kitchen'));
		}
	}

	const outStatusMeta: Record<TicketStatus, { className: string }> = {
		PENDING_PICK: { className: 'border-amber-200 bg-amber-50 text-amber-900' },
		READY_FOR_DISPATCH: { className: 'border-sky-200 bg-sky-50 text-sky-900' },
		IN_TRANSIT: { className: 'border-indigo-200 bg-indigo-50 text-indigo-900' },
		COMPLETED: { className: 'border-emerald-200 bg-emerald-50 text-emerald-900' },
		CANCELLED: { className: 'border-slate-200 bg-slate-50 text-slate-700' }
	};

	function planLabel(planId: string | undefined, planMap: Record<string, MealPlan>): string {
		if (!planId) return 'เมนูอาหาร';
		const plan = planMap[planId];
		return plan?.label ?? (plan ? (MEAL_PERIOD_LABELS[plan.meal] ?? 'เมนูอาหาร') : 'เมนูอาหาร');
	}

	const unifiedRows = $derived.by((): UnifiedRow[] => {
		const planMap = planById;

		// A COMPLETED ticket means materials were handed to the kitchen (CR-143),
		// not that the meal is delivered — until meal_service is recorded, the
		// mission is still in the "ครัวกำลังปรุง" phase, not a finished/success state.
		const cookingTicketPlanIds = new Set(
			(tickets.data ?? [])
				.filter(
					(t) =>
						t.status === 'COMPLETED' &&
						!(services.data ?? []).some((s) => s.meal_plan_id === t.meal_plan_id)
				)
				.map((t) => t.meal_plan_id)
		);

		const outRows: UnifiedRow[] = (tickets.data ?? [])
			.filter((ticket) => {
				if (ticket.status !== 'COMPLETED') return true;
				const hasService = (services.data ?? []).some(
					(s) => s.meal_plan_id === ticket.meal_plan_id
				);
				return !hasService; // superseded by the inRows entry once cooking is delivered
			})
			.map((ticket) => {
				const meta = outStatusMeta[ticket.status];
				const isCookingPhase = ticket.status === 'COMPLETED';
				const plan = planMap[ticket.meal_plan_id];
				const category: RowCategory =
					ticket.status === 'PENDING_PICK'
						? 'PENDING_PICK'
						: isCookingPhase
							? 'COOKING'
							: 'OTHER_OUT';
				return {
					key: `ticket:${ticket._id}`,
					code: ticket.ticket_no,
					direction: 'out',
					fromLabel: locationLabel(ticket.source_location),
					toLabel: locationLabel(ticket.destination_location),
					missionTitle: `ใบเบิกวัตถุดิบ: ${planLabel(ticket.meal_plan_id, planMap)}`,
					recipeChip: recipeChipFor(plan),
					requestedCount: ticket.items.length,
					producedQty: plan?.allocated_target,
					unit: 'กล่อง',
					createdAt: ticket.created_at,
					category,
					statusLabel: isCookingPhase ? 'ครัวกำลังปรุง' : TICKET_STATUS_LABELS[ticket.status],
					statusClass: isCookingPhase
						? 'border-orange-200 bg-orange-50 text-orange-900'
						: meta.className,
					manage:
						isCookingPhase && plan?.meal_session_id
							? {
									kind: 'board' as const,
									sessionId: plan.meal_session_id,
									planId: ticket.meal_plan_id
								}
							: { kind: 'ticket' as const, ticketId: ticket._id }
				};
			});

		// Fallback only for plans cooking without a linked ticket at all — plans
		// already covered by a COMPLETED ticket above aren't duplicated here.
		const cookingRows: UnifiedRow[] = (plans.data ?? [])
			.filter(
				(plan) =>
					plan.status === 'confirmed' &&
					!!plan.cooking_started_at &&
					!(services.data ?? []).some((s) => s.meal_plan_id === plan._id) &&
					!cookingTicketPlanIds.has(plan._id)
			)
			.map((plan) => ({
				key: `cooking:${plan._id}`,
				code: `PRD-${plan._id.slice(-6).toUpperCase()}`,
				direction: 'internal' as const,
				fromLabel: 'โรงครัวกลาง',
				toLabel: 'กำลังปรุง',
				missionTitle: `กำลังปรุง: ${plan.label ?? 'เมนูอาหาร'}`,
				recipeChip: recipeChipFor(plan),
				producedQty: plan.allocated_target,
				unit: 'กล่อง',
				createdAt: plan.cooking_started_at ?? plan.updated_at,
				category: 'COOKING' as const,
				statusLabel: 'ครัวกำลังปรุง',
				statusClass: 'border-orange-200 bg-orange-50 text-orange-900',
				manage: plan.meal_session_id
					? { kind: 'board' as const, sessionId: plan.meal_session_id, planId: plan._id }
					: { kind: 'kitchen' as const }
			}));

		// Only the latest meal_service per plan matters — a rejected one (CR-145)
		// is superseded by whatever the kitchen re-records afterwards.
		const latestServicesByPlan: MealService[] = [];
		for (const service of services.data ?? []) {
			const key = service.meal_plan_id ?? service._id;
			const idx = latestServicesByPlan.findIndex((s) => (s.meal_plan_id ?? s._id) === key);
			if (idx === -1) latestServicesByPlan.push(service);
			else latestServicesByPlan[idx] = service;
		}

		const inRows: UnifiedRow[] = latestServicesByPlan.map((service) => {
			const plan = service.meal_plan_id ? planMap[service.meal_plan_id] : undefined;
			const receipt = (receipts.data ?? []).find((r) => r.meal_service_id === service._id);
			const outcome = receipt ? mealServiceReceiptOutcome(receipt) : undefined;
			const category: RowCategory =
				outcome === 'confirmed'
					? 'DELIVERED_IN'
					: outcome === 'rejected'
						? 'COOKING'
						: 'PENDING_RECEIPT';
			const statusLabel =
				outcome === 'confirmed'
					? 'รับเข้าคลังแล้ว'
					: outcome === 'rejected'
						? 'ถูกตีกลับ - รอปรุงใหม่'
						: 'รอตรวจรับเข้าคลัง';
			const statusClass =
				outcome === 'confirmed'
					? 'border-emerald-200 bg-emerald-50 text-emerald-900'
					: outcome === 'rejected'
						? 'border-red-200 bg-red-50 text-red-900'
						: 'border-sky-200 bg-sky-50 text-sky-900';
			return {
				key: `service:${service._id}`,
				code: mealServiceRef(service),
				direction: 'in' as const,
				fromLabel: 'โรงครัวกลาง',
				toLabel: 'คลังเสบียงกลาง',
				missionTitle: `รับอาหารปรุงเสร็จ: ${planLabel(service.meal_plan_id ?? undefined, planMap)}`,
				recipeChip: recipeChipFor(plan),
				producedQty: service.actual_yield,
				unit: 'กล่อง',
				createdAt: service.created_at,
				category,
				statusLabel,
				statusClass,
				manage:
					plan?.meal_session_id && service.meal_plan_id
						? {
								kind: 'receive' as const,
								sessionId: plan.meal_session_id,
								planId: service.meal_plan_id
							}
						: { kind: 'kitchen' as const }
			};
		});

		return [...outRows, ...cookingRows, ...inRows].sort((a, b) =>
			b.createdAt.localeCompare(a.createdAt)
		);
	});

	let search = $state('');
	let categoryFilter = $state<'ALL' | RowCategory>('ALL');
	let directionFilter = $state<'ALL' | 'in' | 'out'>('ALL');
	type DateRangePreset = 'ALL' | 'today' | 'last7' | 'last30';
	let dateRange = $state<DateRangePreset>('ALL');
	const CATEGORY_FILTER_LABELS: Record<'ALL' | RowCategory, string> = {
		ALL: 'ทุกสถานะ',
		PENDING_PICK: 'รอเบิกวัตถุดิบ',
		COOKING: 'ครัวกำลังปรุง',
		PENDING_RECEIPT: 'รอตรวจรับเข้าคลัง',
		DELIVERED_IN: 'รับเข้าคลังแล้ว',
		OTHER_OUT: 'อื่นๆ'
	};
	const CATEGORY_FILTER_OPTIONS: { value: 'ALL' | RowCategory; label: string }[] = [
		{ value: 'ALL', label: CATEGORY_FILTER_LABELS.ALL },
		{ value: 'PENDING_PICK', label: CATEGORY_FILTER_LABELS.PENDING_PICK },
		{ value: 'COOKING', label: CATEGORY_FILTER_LABELS.COOKING },
		{ value: 'PENDING_RECEIPT', label: CATEGORY_FILTER_LABELS.PENDING_RECEIPT },
		{ value: 'DELIVERED_IN', label: CATEGORY_FILTER_LABELS.DELIVERED_IN }
	];

	function isWithinDateRange(dateStr: string, preset: DateRangePreset): boolean {
		if (preset === 'ALL') return true;
		const todayMs = Date.now();
		const today = new Date(todayMs).toISOString().slice(0, 10);
		if (preset === 'today') return dateStr === today;
		const days = preset === 'last7' ? 7 : 30;
		const from = new Date(todayMs - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
		return dateStr >= from && dateStr <= today;
	}

	const rows = $derived.by(() => {
		const q = search.trim().toLowerCase();
		return unifiedRows.filter((row) => {
			if (categoryFilter !== 'ALL' && row.category !== categoryFilter) return false;
			if (directionFilter !== 'ALL' && row.direction !== directionFilter) return false;
			if (!isWithinDateRange(row.createdAt.slice(0, 10), dateRange)) return false;
			if (!q) return true;
			return (
				row.code.toLowerCase().includes(q) ||
				row.fromLabel.toLowerCase().includes(q) ||
				row.toLabel.toLowerCase().includes(q) ||
				row.missionTitle.toLowerCase().includes(q)
			);
		});
	});

	const counts = $derived({
		all: unifiedRows.length,
		PENDING_PICK: unifiedRows.filter((r) => r.category === 'PENDING_PICK').length,
		COOKING: unifiedRows.filter((r) => r.category === 'COOKING').length,
		PENDING_RECEIPT: unifiedRows.filter((r) => r.category === 'PENDING_RECEIPT').length,
		DELIVERED_IN: unifiedRows.filter((r) => r.category === 'DELIVERED_IN').length
	});

	const isLoading = $derived(
		tickets.isPending || plans.isPending || services.isPending || receipts.isPending
	);

	const hasActiveFilters = $derived(
		!!search || dateRange !== 'ALL' || categoryFilter !== 'ALL' || directionFilter !== 'ALL'
	);

	function clearFilters() {
		search = '';
		dateRange = 'ALL';
		categoryFilter = 'ALL';
		directionFilter = 'ALL';
	}

	const KITCHEN_KPI_CARDS = [
		{
			id: 'ALL',
			label: 'คำร้องทั้งหมด',
			hint: 'รวมทุกสถานะ',
			icon: Layers,
			count: (c: typeof counts) => c.all,
			border: 'border-slate-200/80',
			activeClass: 'border-slate-500 ring-slate-500',
			focusClass: 'focus-visible:ring-slate-500',
			labelClass: 'text-slate-500',
			iconClass: 'text-slate-400',
			hintClass: 'text-slate-400'
		},
		{
			id: 'PENDING_PICK',
			label: 'รอเบิกวัตถุดิบ',
			hint: 'รอคลังจ่ายวัตถุดิบ',
			icon: Clock3,
			count: (c: typeof counts) => c.PENDING_PICK,
			border: 'border-amber-200',
			activeClass: 'border-amber-500 ring-amber-500',
			focusClass: 'focus-visible:ring-amber-500',
			labelClass: 'text-amber-800',
			iconClass: 'text-amber-600',
			hintClass: 'text-amber-700'
		},
		{
			id: 'COOKING',
			label: 'ครัวกำลังปรุง',
			hint: 'อยู่ระหว่างปรุงอาหาร',
			icon: Flame,
			count: (c: typeof counts) => c.COOKING,
			border: 'border-orange-200',
			activeClass: 'border-orange-500 ring-orange-500',
			focusClass: 'focus-visible:ring-orange-500',
			labelClass: 'text-orange-800',
			iconClass: 'text-orange-600',
			hintClass: 'text-orange-700'
		},
		{
			id: 'PENDING_RECEIPT',
			label: 'รอตรวจรับเข้าคลัง',
			hint: 'ปรุงเสร็จ รอคลังตรวจรับ',
			icon: PackageCheck,
			count: (c: typeof counts) => c.PENDING_RECEIPT,
			border: 'border-sky-200',
			activeClass: 'border-sky-600 ring-sky-600',
			focusClass: 'focus-visible:ring-sky-600',
			labelClass: 'text-sky-800',
			iconClass: 'text-sky-600',
			hintClass: 'text-sky-700'
		},
		{
			id: 'DELIVERED_IN',
			label: 'รับเข้าคลังแล้ว',
			hint: 'เสร็จสมบูรณ์',
			icon: CheckCircle2,
			count: (c: typeof counts) => c.DELIVERED_IN,
			border: 'border-slate-200/80',
			activeClass: 'border-emerald-600 ring-emerald-600',
			focusClass: 'focus-visible:ring-emerald-600',
			labelClass: 'text-slate-700',
			iconClass: 'text-emerald-600',
			hintClass: 'text-slate-400'
		}
	] as const;
</script>

<div class="min-h-full bg-slate-50/50">
	<div class="mx-auto flex max-w-[110rem] flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
		<!-- Page Header -->
		<div class="flex items-center gap-3">
			<div
				class="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-orange-200/80 bg-orange-50 text-orange-600 shadow-2xs"
			>
				<ChefHat class="h-6 w-6" />
			</div>
			<div class="min-w-0">
				<h1 class="text-2xl font-bold tracking-tight text-slate-900">
					จัดการคำร้องโรงครัวและเสบียงอาหาร
				</h1>
				<p class="text-xs text-slate-500">
					เบิกวัตถุดิบสำหรับปรุงอาหารแต่ละมื้อ และตรวจรับอาหารปรุงเสร็จ/อาหารบริจาคเข้าสต็อก
				</p>
			</div>
		</div>

		<!-- Status KPI cards (also the status filter) -->
		<div
			class="flex flex-wrap justify-center gap-3 *:basis-[calc(50%-0.375rem)] sm:*:basis-[calc(33.333%-0.5rem)] lg:flex-nowrap lg:*:min-w-0 lg:*:flex-1 lg:*:basis-0"
		>
			{#each KITCHEN_KPI_CARDS as card (card.id)}
				{@const isActive = categoryFilter === card.id}
				<button
					type="button"
					aria-pressed={isActive}
					onclick={() => (categoryFilter = card.id)}
					class="cursor-pointer rounded-xl border bg-white p-4 text-left shadow-2xs transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:outline-none {card.focusClass} {isActive
						? `ring-1 ${card.activeClass}`
						: card.border}"
				>
					<div class="flex items-center justify-between">
						<span class="text-xs font-semibold {card.labelClass}">{card.label}</span>
						<card.icon class="h-4 w-4 {card.iconClass}" />
					</div>
					<div class="mt-2 text-2xl font-bold text-slate-900 tabular-nums">
						{card.count(counts)}
					</div>
					<p class="mt-0.5 text-xs {card.hintClass}">{card.hint}</p>
				</button>
			{/each}
		</div>

		<!-- Search + filters -->
		<div class="space-y-3">
			<div class="relative w-full">
				<Search
					class="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400"
				/><Input
					bind:value={search}
					placeholder="ค้นหาในแท็บนี้ (โรงครัวและเสบียงอาหาร)... รหัสคำสั่ง, แหล่งต้นทาง, ปลายทาง หรือชื่อวัสดุเสบียง"
					class="h-10 w-full rounded-lg pl-9 text-sm shadow-2xs placeholder:text-slate-400"
				/>
			</div>
			<div class="flex flex-wrap items-end gap-3">
				<div class="flex flex-col gap-1.5">
					<label for="kitchen-filter-date" class="text-xs font-semibold text-slate-600"
						>วันที่</label
					>
					<Select.Root type="single" bind:value={dateRange}
						><Select.Trigger
							id="kitchen-filter-date"
							class="h-9 rounded-lg bg-white px-2.5 text-sm shadow-2xs data-[size=default]:h-9 sm:w-40"
							><Select.Value placeholder="ทุกวันที่"
								>{dateRange === 'today'
									? 'วันนี้'
									: dateRange === 'last7'
										? '7 วันล่าสุด'
										: dateRange === 'last30'
											? '30 วันล่าสุด'
											: 'ทุกวันที่'}</Select.Value
							></Select.Trigger
						><Select.Content
							><Select.Item value="ALL" label="ทุกวันที่">ทุกวันที่</Select.Item><Select.Item
								value="today"
								label="วันนี้">วันนี้</Select.Item
							><Select.Item value="last7" label="7 วันล่าสุด">7 วันล่าสุด</Select.Item><Select.Item
								value="last30"
								label="30 วันล่าสุด">30 วันล่าสุด</Select.Item
							></Select.Content
						></Select.Root
					>
				</div>
				<div class="flex flex-col gap-1.5">
					<label for="kitchen-filter-direction" class="text-xs font-semibold text-slate-600"
						>ทิศทาง</label
					>
					<Select.Root type="single" bind:value={directionFilter}
						><Select.Trigger
							id="kitchen-filter-direction"
							class="h-9 rounded-lg bg-white px-2.5 text-sm shadow-2xs data-[size=default]:h-9 sm:w-48"
							><Select.Value placeholder="ทุกทิศทาง"
								>{directionFilter === 'in'
									? 'รับเข้า'
									: directionFilter === 'out'
										? 'จ่ายออก'
										: 'ทุกทิศทาง'}</Select.Value
							></Select.Trigger
						><Select.Content
							><Select.Item value="ALL" label="ทุกทิศทาง">ทุกทิศทาง</Select.Item><Select.Item
								value="in"
								label="รับเข้า">รับเข้า</Select.Item
							><Select.Item value="out" label="จ่ายออก">จ่ายออก</Select.Item></Select.Content
						></Select.Root
					>
				</div>
				<div class="flex flex-col gap-1.5">
					<label for="kitchen-filter-status" class="text-xs font-semibold text-slate-600"
						>สถานะ</label
					>
					<Select.Root
						type="single"
						value={categoryFilter}
						onValueChange={(v) => (categoryFilter = v as typeof categoryFilter)}
						><Select.Trigger
							id="kitchen-filter-status"
							class="h-9 rounded-lg bg-white px-2.5 text-sm shadow-2xs data-[size=default]:h-9 sm:w-44"
							><Select.Value placeholder="ทุกสถานะ"
								>{CATEGORY_FILTER_LABELS[categoryFilter]}</Select.Value
							></Select.Trigger
						><Select.Content
							>{#each CATEGORY_FILTER_OPTIONS as option (option.value)}<Select.Item
									value={option.value}
									label={option.label}>{option.label}</Select.Item
								>{/each}</Select.Content
						></Select.Root
					>
				</div>
			</div>
		</div>

		<section class="rounded-2xl border border-slate-200/80 bg-white shadow-2xs">
			{#if hasActiveFilters}<div
					class="flex items-center justify-between gap-3 border-b border-slate-200/80 bg-slate-50 px-5 py-3 text-sm text-slate-600 sm:px-6"
				>
					<span>พบ {rows.length} รายการ จากทั้งหมด {counts.all} รายการ</span><Button
						variant="ghost"
						size="sm"
						class="min-h-11"
						onclick={clearFilters}>ล้างตัวกรอง</Button
					>
				</div>{/if}

			<div class="overflow-x-auto">
				{#if isLoading}<div class="py-16 text-center text-base text-slate-500">
						กำลังโหลดคิวคำร้อง...
					</div>
				{:else if !rows.length}<div class="flex flex-col items-center gap-3 px-6 py-16 text-center">
						<ClipboardList class="h-12 w-12 text-slate-300" />
						<p class="text-base font-semibold text-slate-700">ไม่พบคำร้องที่ตรงกับเงื่อนไข</p>
						<p class="text-sm text-slate-500">ลองล้างตัวกรองหรือรอรายการใหม่</p>
					</div>
				{:else}
					<Table.Root
						><Table.Header
							><Table.Row class="bg-slate-50 hover:bg-slate-50"
								><Table.Head class="px-5 text-xs font-medium text-slate-500">รหัส</Table.Head
								><Table.Head class="text-xs font-medium text-slate-500"
									>ฝ่ายเบิก &amp; ทิศทางการส่งมอบ</Table.Head
								><Table.Head class="text-xs font-medium text-slate-500"
									>ภารกิจ / คำสั่งปันส่วนเสบียง</Table.Head
								><Table.Head class="text-xs font-medium text-slate-500">เวลาที่ออกคำสั่ง</Table.Head
								><Table.Head class="text-xs font-medium text-slate-500"
									><span class="inline-flex items-center gap-1"
										>สถานะธุรกรรม<Info
											class="h-3.5 w-3.5 text-slate-400"
											title="สถานะการดำเนินงานปัจจุบันของคำร้องนี้"
										/></span
									></Table.Head
								><Table.Head class="px-5 text-right text-xs font-medium text-slate-500"
									>สิทธิ์จัดการ</Table.Head
								></Table.Row
							></Table.Header
						><Table.Body>
							{#each rows as row (row.key)}
								<Table.Row
									class="cursor-pointer transition-colors hover:bg-orange-50/50"
									onclick={() => openManage(row.manage)}
									><Table.Cell class="px-5"
										><p class="inline-flex items-center gap-1 text-sm font-semibold text-[#0A2647]">
											{row.code}<ExternalLink class="h-3.5 w-3.5 text-slate-400" />
										</p></Table.Cell
									><Table.Cell
										><p
											class="mb-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium {row.direction ===
											'in'
												? 'bg-emerald-50 text-emerald-700'
												: row.direction === 'out'
													? 'bg-amber-50 text-amber-700'
													: 'bg-orange-50 text-orange-700'}"
										>
											{#if row.direction === 'in'}<ArrowDown class="h-3.5 w-3.5" />รับเข้า
											{:else if row.direction === 'out'}<ArrowUp class="h-3.5 w-3.5" />จ่ายออก
											{:else}<Flame class="h-3.5 w-3.5" />ภายใน
											{/if}
										</p>
										<p class="flex max-w-48 items-center gap-1.5 text-sm text-slate-700">
											<span class="shrink-0">{row.fromLabel}</span><ArrowRight
												class="h-4 w-4 shrink-0 text-slate-400"
											/><span class="truncate" title={row.toLabel}>{row.toLabel}</span>
										</p></Table.Cell
									><Table.Cell
										><p class="text-sm font-medium text-slate-800">{row.missionTitle}</p>
										<div class="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
											{#if row.recipeChip}
												<span
													class="rounded bg-indigo-50 px-1.5 py-0.5 text-xs font-semibold text-indigo-700"
													>{row.recipeChip}</span
												>
											{/if}
											<span class="text-sm text-slate-500">
												{#if row.requestedCount}ขอเบิก: {row.requestedCount} รายการ{/if}
												{#if row.requestedCount && row.producedQty}&middot;{/if}
												{#if row.producedQty}ผลิต: {row.producedQty} {row.unit ?? 'กล่อง'}{/if}
											</span>
										</div></Table.Cell
									><Table.Cell
										><p class="text-sm text-slate-700">
											{formatThaiShortDate(row.createdAt)}
										</p>
										<p class="text-sm text-slate-400">
											{formatThaiTime(row.createdAt)}
										</p></Table.Cell
									><Table.Cell
										><span
											class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium {row.statusClass}"
											><span class="h-1.5 w-1.5 rounded-full bg-current"
											></span>{row.statusLabel}</span
										></Table.Cell
									><Table.Cell class="px-5 text-right"
										><Button
											size="sm"
											class="min-h-11 gap-2"
											onclick={(event) => {
												event.stopPropagation();
												openManage(row.manage);
											}}
											><Settings2 class="h-4 w-4" />จัดการ<span class="sr-only">{row.code}</span
											></Button
										></Table.Cell
									></Table.Row
								>
							{/each}
						</Table.Body></Table.Root
					>
				{/if}
			</div>
		</section>
	</div>
</div>
