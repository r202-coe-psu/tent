<script lang="ts">
	import ClipboardList from '@lucide/svelte/icons/clipboard-list';
	import Clock3 from '@lucide/svelte/icons/clock-3';
	import Flame from '@lucide/svelte/icons/flame';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import PackageCheck from '@lucide/svelte/icons/package-check';
	import Truck from '@lucide/svelte/icons/truck';
	import Search from '@lucide/svelte/icons/search';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import ArrowDown from '@lucide/svelte/icons/arrow-down';
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import ChefHat from '@lucide/svelte/icons/chef-hat';
	import Settings2 from '@lucide/svelte/icons/settings-2';
	import Plus from '@lucide/svelte/icons/plus';
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
		useMealDistributionPushes,
		mealServiceReceiptOutcome,
		mealServicePushRemaining,
		MEAL_PERIOD_LABELS,
		toMealPlanMap,
		type MealPlan,
		type MealService
	} from '$lib/features/kitchen';
	import { useRecipes } from '$lib/features/catalog';
	import { getShelterCode } from '$lib/db/shelter';
	import { formatThaiDate, formatThaiTime } from '$lib/utils/date';

	const tickets = useTickets();
	const plans = useMealPlans();
	const services = useMealServices();
	const receipts = useMealServiceReceipts();
	const pushes = useMealDistributionPushes();
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
	// no new persisted doc type beyond `meal_service_receipt` (CR-142). "รับเข้า"
	// rows are derived read-only from meal_service + meal_service_receipt: a
	// service without a matching receipt is "รอตรวจรับเข้าคลัง" (PENDING_RECEIPT,
	// real state — warehouse hasn't confirmed count yet); once a receipt exists
	// it becomes "ส่งมอบเสร็จสิ้น" (DELIVERED_IN). "จ่ายออก" rows are the real
	// requisition_ticket lifecycle unchanged.
	type RowCategory =
		| 'PENDING_PICK'
		| 'COOKING'
		| 'PENDING_RECEIPT'
		| 'PENDING_DISPATCH'
		| 'DELIVERED_IN'
		| 'OTHER_OUT';
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
		manageHref: string;
	};

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

		// A COMPLETED ticket means materials were handed to the kitchen (CR-141),
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
					manageHref:
						isCookingPhase && plan
							? resolve(
									`/back-office/kitchen/production-board/${plan.meal_session_id}?plan_id=${ticket.meal_plan_id}&stage=C&role=warehouse`
								)
							: resolve(`/back-office/tickets/${encodeURIComponent(ticket._id)}`)
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
				manageHref: resolve(
					`/back-office/kitchen/production-board/${plan.meal_session_id}?plan_id=${plan._id}&stage=C&role=warehouse`
				)
			}));

		// Only the latest meal_service per plan matters — a rejected one (CR-143)
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
			const remaining = mealServicePushRemaining(
				service.actual_yield ?? 0,
				service._id,
				pushes.data ?? []
			);
			const category: RowCategory =
				outcome === 'confirmed'
					? remaining > 0
						? 'PENDING_DISPATCH'
						: 'DELIVERED_IN'
					: outcome === 'rejected'
						? 'COOKING'
						: 'PENDING_RECEIPT';
			const statusLabel =
				outcome === 'confirmed'
					? remaining > 0
						? 'รอส่งมอบ'
						: 'ส่งมอบเสร็จสิ้น'
					: outcome === 'rejected'
						? 'ถูกตีกลับ - รอปรุงใหม่'
						: 'รอตรวจรับเข้าคลัง';
			const statusClass =
				outcome === 'confirmed'
					? remaining > 0
						? 'border-purple-200 bg-purple-50 text-purple-900'
						: 'border-emerald-200 bg-emerald-50 text-emerald-900'
					: outcome === 'rejected'
						? 'border-red-200 bg-red-50 text-red-900'
						: 'border-sky-200 bg-sky-50 text-sky-900';
			// Once the warehouse confirms receipt (outcome === 'confirmed'), this row
			// stops being "รับเข้า: โรงครัวกลาง -> คลังเสบียงกลาง" (food arriving at the
			// warehouse) and becomes "จ่ายออก: คลังเสบียงกลาง -> ..." (food waiting to
			// leave the warehouse for a distribution point, CR-144) — same underlying
			// meal_service, but the direction/label must track which leg is next.
			const pushedStations = Array.from(
				new Set(
					(pushes.data ?? [])
						.filter((p) => p.items.some((i) => i.meal_service_id === service._id))
						.map((p) => p.pos_station)
				)
			);
			const outboundToLabel =
				remaining <= 0 && pushedStations.length > 0
					? pushedStations.length > 1
						? 'หลายจุดแจก'
						: pushedStations[0]
					: 'รอเลือกจุดแจก';
			return {
				key: `service:${service._id}`,
				code: `RCV-${service._id.slice(-6).toUpperCase()}`,
				direction: outcome === 'confirmed' ? ('out' as const) : ('in' as const),
				fromLabel: outcome === 'confirmed' ? 'คลังเสบียงกลาง' : 'โรงครัวกลาง',
				toLabel: outcome === 'confirmed' ? outboundToLabel : 'คลังเสบียงกลาง',
				missionTitle: `รับอาหารปรุงเสร็จ: ${planLabel(service.meal_plan_id ?? undefined, planMap)}`,
				recipeChip: recipeChipFor(plan),
				producedQty: service.actual_yield,
				unit: 'กล่อง',
				createdAt: service.created_at,
				category,
				statusLabel,
				statusClass,
				manageHref:
					outcome === 'confirmed'
						? resolve('/back-office/kitchen/distribute') +
							(service.meal_session_id
								? `?session=${encodeURIComponent(service.meal_session_id)}`
								: '')
						: plan
							? resolve(
									`/back-office/kitchen/production-board/${plan.meal_session_id}?plan_id=${service.meal_plan_id}&stage=C&role=warehouse`
								)
							: resolve('/back-office/kitchen')
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
	let statusLabelFilter = $state('ALL');

	function isWithinDateRange(dateStr: string, preset: DateRangePreset): boolean {
		if (preset === 'ALL') return true;
		const todayMs = Date.now();
		const today = new Date(todayMs).toISOString().slice(0, 10);
		if (preset === 'today') return dateStr === today;
		const days = preset === 'last7' ? 7 : 30;
		const from = new Date(todayMs - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
		return dateStr >= from && dateStr <= today;
	}

	const statusLabelOptions = $derived.by(() => {
		const labels: string[] = [];
		for (const row of unifiedRows) {
			if (!labels.includes(row.statusLabel)) labels.push(row.statusLabel);
		}
		return labels;
	});

	const rows = $derived.by(() => {
		const q = search.trim().toLowerCase();
		return unifiedRows.filter((row) => {
			if (categoryFilter !== 'ALL' && row.category !== categoryFilter) return false;
			if (directionFilter !== 'ALL' && row.direction !== directionFilter) return false;
			if (statusLabelFilter !== 'ALL' && row.statusLabel !== statusLabelFilter) return false;
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
		PENDING_DISPATCH: unifiedRows.filter((r) => r.category === 'PENDING_DISPATCH').length,
		DELIVERED_IN: unifiedRows.filter((r) => r.category === 'DELIVERED_IN').length
	});

	const isLoading = $derived(
		tickets.isPending ||
			plans.isPending ||
			services.isPending ||
			receipts.isPending ||
			pushes.isPending
	);
	const isFetching = $derived(
		tickets.isFetching ||
			plans.isFetching ||
			services.isFetching ||
			receipts.isFetching ||
			pushes.isFetching
	);

	function refreshAll() {
		tickets.refetch();
		plans.refetch();
		services.refetch();
		receipts.refetch();
		pushes.refetch();
	}

	const hasActiveFilters = $derived(
		!!search ||
			dateRange !== 'ALL' ||
			categoryFilter !== 'ALL' ||
			directionFilter !== 'ALL' ||
			statusLabelFilter !== 'ALL'
	);

	function clearFilters() {
		search = '';
		dateRange = 'ALL';
		categoryFilter = 'ALL';
		directionFilter = 'ALL';
		statusLabelFilter = 'ALL';
	}
</script>

<div class="min-h-full bg-[#F8FAFC]">
	<div class="mx-auto max-w-[110rem] space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
		<section class="rounded-2xl border border-orange-200 bg-white p-5 shadow-2xs sm:p-7">
			<div
				class="mb-3 inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600"
			>
				<ChefHat class="h-3.5 w-3.5" />สายงานโรงครัวและเสบียงอาหาร
			</div>
			<div class="flex flex-col justify-between gap-5 lg:flex-row lg:items-start">
				<div>
					<h1
						class="flex items-center gap-2 text-3xl font-extrabold tracking-tight text-[#0A2647] sm:text-4xl"
					>
						<ChefHat class="h-7 w-7 text-orange-600" />จัดการคำร้องโรงครัวและเสบียงอาหาร
					</h1>
					<p class="mt-2 max-w-2xl text-base leading-relaxed text-slate-600">
						ระบบประสานงานเบิกวัตถุดิบและแก๊สหุงต้มสำหรับการปรุงอาหารแต่ละมื้อ
						พร้อมตรวจรับอาหารปรุงเสร็จ/อาหารบริจาคเข้าสต็อก
					</p>
				</div>
				<div class="flex flex-wrap gap-2">
					<Button
						class="min-h-11 gap-2 bg-[#0A2647] hover:bg-[#051930]"
						onclick={() => goto(resolve('/back-office/kitchen/distribute'))}
					>
						<Plus class="h-4 w-4" />จัดสรรอาหารส่งจุดแจก (Push)
					</Button>
					<Button
						variant="outline"
						class="min-h-11 gap-2"
						disabled={isFetching}
						onclick={refreshAll}
					>
						<RefreshCw class="h-4 w-4 {isFetching ? 'animate-spin' : ''}" />รีเฟรชสต็อก
					</Button>
				</div>
			</div>

			<!-- Category tabs -->
			<div class="mt-6 flex flex-wrap gap-2">
				<button
					type="button"
					onclick={() => (categoryFilter = 'ALL')}
					class="inline-flex min-h-11 items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition {categoryFilter ===
					'ALL'
						? 'border-[#0A2647] bg-[#0A2647] text-white'
						: 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'}"
				>
					<Layers class="h-4 w-4" />คำร้องทั้งหมด
					<span
						class="rounded-full px-2 py-0.5 text-xs font-bold tabular-nums {categoryFilter === 'ALL'
							? 'bg-white/20'
							: 'bg-slate-100 text-slate-700'}">{counts.all}</span
					>
				</button>
				<button
					type="button"
					onclick={() => (categoryFilter = 'PENDING_PICK')}
					class="inline-flex min-h-11 items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition {categoryFilter ===
					'PENDING_PICK'
						? 'border-amber-400 bg-amber-500 text-white'
						: 'border-slate-200 bg-white text-slate-700 hover:border-amber-300'}"
				>
					<Clock3 class="h-4 w-4" />รอเบิกวัตถุดิบ
					<span
						class="rounded-full px-2 py-0.5 text-xs font-bold tabular-nums {categoryFilter ===
						'PENDING_PICK'
							? 'bg-white/20'
							: 'bg-amber-100 text-amber-800'}">{counts.PENDING_PICK}</span
					>
				</button>
				<button
					type="button"
					onclick={() => (categoryFilter = 'COOKING')}
					class="inline-flex min-h-11 items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition {categoryFilter ===
					'COOKING'
						? 'border-orange-400 bg-orange-500 text-white'
						: 'border-slate-200 bg-white text-slate-700 hover:border-orange-300'}"
				>
					<Flame class="h-4 w-4" />ครัวกำลังปรุง
					<span
						class="rounded-full px-2 py-0.5 text-xs font-bold tabular-nums {categoryFilter ===
						'COOKING'
							? 'bg-white/20'
							: 'bg-orange-100 text-orange-800'}">{counts.COOKING}</span
					>
				</button>
				<button
					type="button"
					onclick={() => (categoryFilter = 'PENDING_RECEIPT')}
					class="inline-flex min-h-11 items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition {categoryFilter ===
					'PENDING_RECEIPT'
						? 'border-sky-400 bg-sky-500 text-white'
						: 'border-slate-200 bg-white text-slate-700 hover:border-sky-300'}"
				>
					<PackageCheck class="h-4 w-4" />รอตรวจรับเข้าคลัง
					<span
						class="rounded-full px-2 py-0.5 text-xs font-bold tabular-nums {categoryFilter ===
						'PENDING_RECEIPT'
							? 'bg-white/20'
							: 'bg-sky-100 text-sky-800'}">{counts.PENDING_RECEIPT}</span
					>
				</button>
				<button
					type="button"
					onclick={() => (categoryFilter = 'PENDING_DISPATCH')}
					class="inline-flex min-h-11 items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition {categoryFilter ===
					'PENDING_DISPATCH'
						? 'border-purple-400 bg-purple-500 text-white'
						: 'border-slate-200 bg-white text-slate-700 hover:border-purple-300'}"
				>
					<Truck class="h-4 w-4" />รอส่งมอบ
					<span
						class="rounded-full px-2 py-0.5 text-xs font-bold tabular-nums {categoryFilter ===
						'PENDING_DISPATCH'
							? 'bg-white/20'
							: 'bg-purple-100 text-purple-800'}">{counts.PENDING_DISPATCH}</span
					>
				</button>
				<button
					type="button"
					onclick={() => (categoryFilter = 'DELIVERED_IN')}
					class="inline-flex min-h-11 items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition {categoryFilter ===
					'DELIVERED_IN'
						? 'border-emerald-400 bg-emerald-500 text-white'
						: 'border-slate-200 bg-white text-slate-700 hover:border-emerald-300'}"
				>
					<CheckCircle2 class="h-4 w-4" />ส่งมอบเสร็จสิ้น
					<span
						class="rounded-full px-2 py-0.5 text-xs font-bold tabular-nums {categoryFilter ===
						'DELIVERED_IN'
							? 'bg-white/20'
							: 'bg-emerald-100 text-emerald-800'}">{counts.DELIVERED_IN}</span
					>
				</button>
			</div>

			<!-- Search + filters -->
			<div class="mt-4 flex flex-col gap-2 sm:flex-row">
				<div class="relative min-w-0 flex-1">
					<Search
						class="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400"
					/><Input
						bind:value={search}
						placeholder="ค้นหาในแท็บนี้ (โรงครัวและเสบียงอาหาร)... รหัสคำสั่ง, แหล่งต้นทาง, ปลายทาง หรือชื่อวัสดุเสบียง"
						class="min-h-11 pl-9"
					/>
				</div>
				<Select.Root type="single" bind:value={dateRange}
					><Select.Trigger class="min-h-11 sm:w-40"
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
				<Select.Root type="single" bind:value={directionFilter}
					><Select.Trigger class="min-h-11 sm:w-48"
						><Select.Value placeholder="ทิศทาง: ทุกทิศทาง"
							>{directionFilter === 'in'
								? 'ทิศทาง: รับเข้า'
								: directionFilter === 'out'
									? 'ทิศทาง: จ่ายออก'
									: 'ทิศทาง: ทุกทิศทาง'}</Select.Value
						></Select.Trigger
					><Select.Content
						><Select.Item value="ALL" label="ทุกทิศทาง">ทุกทิศทาง</Select.Item><Select.Item
							value="in"
							label="รับเข้า">รับเข้า</Select.Item
						><Select.Item value="out" label="จ่ายออก">จ่ายออก</Select.Item></Select.Content
					></Select.Root
				>
				<Select.Root type="single" bind:value={statusLabelFilter}
					><Select.Trigger class="min-h-11 sm:w-44"
						><Select.Value placeholder="ทุกสถานะ"
							>{statusLabelFilter === 'ALL' ? 'ทุกสถานะ' : statusLabelFilter}</Select.Value
						></Select.Trigger
					><Select.Content
						><Select.Item value="ALL" label="ทุกสถานะ">ทุกสถานะ</Select.Item
						>{#each statusLabelOptions as label (label)}<Select.Item value={label} {label}
								>{label}</Select.Item
							>{/each}</Select.Content
					></Select.Root
				>
			</div>
		</section>

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
								><Table.Head class="px-5 font-semibold text-slate-700">รหัส</Table.Head><Table.Head
									class="font-semibold text-slate-700">ฝ่ายเบิก &amp; ทิศทางการส่งมอบ</Table.Head
								><Table.Head class="font-semibold text-slate-700"
									>ภารกิจ / คำสั่งปันส่วนเสบียง</Table.Head
								><Table.Head class="font-semibold text-slate-700">เวลาที่ออกคำสั่ง</Table.Head
								><Table.Head class="font-semibold text-slate-700"
									><span class="inline-flex items-center gap-1"
										>สถานะธุรกรรม<Info
											class="h-3.5 w-3.5 text-slate-400"
											title="สถานะการดำเนินงานปัจจุบันของคำร้องนี้"
										/></span
									></Table.Head
								><Table.Head class="px-5 text-right font-semibold text-slate-700"
									>สิทธิ์จัดการ</Table.Head
								></Table.Row
							></Table.Header
						><Table.Body>
							{#each rows as row (row.key)}
								<Table.Row
									class="cursor-pointer transition-colors hover:bg-orange-50/50"
									onclick={() => goto(row.manageHref)}
									><Table.Cell class="px-5"
										><p class="inline-flex items-center gap-1 text-sm font-bold text-[#0A2647]">
											{row.code}<ExternalLink class="h-3.5 w-3.5 text-slate-400" />
										</p></Table.Cell
									><Table.Cell
										><p
											class="mb-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-semibold {row.direction ===
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
										<p
											class="flex max-w-48 items-center gap-1.5 text-sm font-semibold text-slate-800"
										>
											<span class="shrink-0">{row.fromLabel}</span><ArrowRight
												class="h-4 w-4 shrink-0 text-slate-400"
											/><span class="truncate" title={row.toLabel}>{row.toLabel}</span>
										</p></Table.Cell
									><Table.Cell
										><p class="text-sm font-semibold text-slate-800">{row.missionTitle}</p>
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
										><p class="text-sm font-semibold text-slate-700">
											{formatThaiDate(row.createdAt)}
										</p>
										<p class="text-sm text-slate-400">
											{formatThaiTime(row.createdAt)}
										</p></Table.Cell
									><Table.Cell
										><span
											class="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold {row.statusClass}"
											><span class="h-1.5 w-1.5 rounded-full bg-current"
											></span>{row.statusLabel}</span
										></Table.Cell
									><Table.Cell class="px-5 text-right"
										><Button
											size="sm"
											class="min-h-11 gap-2"
											onclick={(event) => {
												event.stopPropagation();
												goto(row.manageHref);
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
