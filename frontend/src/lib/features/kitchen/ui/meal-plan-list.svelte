<script lang="ts">
	import CheckCircle from '@lucide/svelte/icons/check-circle';
	import Clock from '@lucide/svelte/icons/clock';
	import ClipboardList from '@lucide/svelte/icons/clipboard-list';
	import Play from '@lucide/svelte/icons/play';
	import FileText from '@lucide/svelte/icons/file-text';
	import PackageCheck from '@lucide/svelte/icons/package-check';
	import ClipboardCheck from '@lucide/svelte/icons/clipboard-check';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import * as Card from '$lib/components/ui/card';
	import * as Table from '$lib/components/ui/table';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import * as Pagination from '$lib/components/ui/pagination';
	import { Button } from '$lib/components/ui/button';
	import { toast } from 'svelte-sonner';
	import {
		useMealPlans,
		useConfirmMealPlan,
		useDeleteMealPlanDraft,
		useRequisitions,
		useMealServices,
		MEAL_PERIOD_LABELS,
		RICE_RECIPE_ID,
		RECIPE_LABELS,
		RECIPE_TO_STOCK_ITEM,
		MealPlanForm,
		RequisitionDialog,
		MealServiceForm,
		useGasCylinderTypes,
		useGasLedger,
		gasCylinderBalance,
		type MealPlan,
		type MealPlanRecipe
	} from '$lib/features/kitchen';
	import { useActiveSopProfile } from '$lib/features/sop-ratios';
	import { useSupplyItems } from '$lib/features/supply';
	import { useItemMasters, formatUnit, useUnitsOfMeasure } from '$lib/features/catalog';
	import { langState } from '$lib/states/i18n.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import { useStockBalance } from '$lib/features/operations';
	import { qtyGt } from '$lib/utils/qty';

	const plans = useMealPlans();
	const supplyItems = useSupplyItems();
	const itemMasters = useItemMasters(() => getShelterCode());
	const unitsQuery = useUnitsOfMeasure();
	const units = $derived(unitsQuery.data ?? []);
	const stockBalance = useStockBalance();
	const gasTypes = useGasCylinderTypes();
	const gasLedger = useGasLedger();
	let createOpen = $state(false);
	let createDefaultMode = $state<'sop' | 'recipe' | 'custom'>('sop');

	function openCreate(mode: 'sop' | 'recipe' | 'custom') {
		createDefaultMode = mode;
		createOpen = true;
	}
	const confirm = useConfirmMealPlan();
	const deletePlan = useDeleteMealPlanDraft();
	const sopProfile = useActiveSopProfile();
	const requisitions = useRequisitions();
	const mealServices = useMealServices();

	// Plans that already have a recorded service — drives the "✓ บันทึกแล้ว" hint.
	// meal_service.meal_plan_id links a service record to the specific plan it
	// reports on (same convention as requisitionedPlanIds below) — matching by
	// plan._id, not date+meal, since multiple plans can now share a date+meal
	// and only the one actually serviced should flip to "done".
	const servicedPlanIds = $derived(
		new Set(
			(mealServices.data ?? []).map((s) => s.meal_plan_id).filter((id): id is string => Boolean(id))
		)
	);

	// Meal plans that already have at least one requisition — drives the
	// "เบิกแล้ว" hint so staff don't accidentally double-deduct stock.
	const requisitionedPlanIds = $derived(
		new Set(
			(requisitions.data ?? []).map((r) => r.meal_plan_id).filter((id): id is string => Boolean(id))
		)
	);

	let reqOpen = $state(false);
	let reqPlan = $state<MealPlan | null>(null);

	let serviceOpen = $state(false);
	let servicePlan = $state<MealPlan | null>(null);

	function openService(plan: MealPlan) {
		servicePlan = plan;
		serviceOpen = true;
	}

	// Linear workflow, one action at a time — owner decision: re-issuing a
	// requisition is no longer offered (previously allowed for topping up a
	// short partial issue); a plan can only be เบิก once. Progress is driven
	// entirely by these two derived sets, not a manual step field.
	type PlanStage = 'draft' | 'awaiting_requisition' | 'awaiting_service' | 'done';
	function planStage(plan: MealPlan): PlanStage {
		if (plan.status === 'draft') return 'draft';
		if (servicedPlanIds.has(plan._id)) return 'done';
		if (requisitionedPlanIds.has(plan._id)) return 'awaiting_service';
		return 'awaiting_requisition';
	}

	// A BOM ingredient resolves to a real `supply_item` id when its item_master's
	// name auto-matches one (resolveItemMasterStock, meal-calc.ts) — otherwise
	// calculateMealIngredientsFromRecipe falls back to the item_master_id itself
	// (`item_master:*` prefix), which has no stock_ledger entry to draw down.
	// A plan blocks เบิก only while at least one of its ingredients is still
	// unresolved; a later name match un-blocks it automatically (no other code
	// to change) since recipe_id no longer carries that prefix once resolved.
	function isBomSourced(plan: MealPlan): boolean {
		return plan.recipes.some((r) => r.recipe_id.startsWith('item_master:'));
	}

	function openRequisition(plan: MealPlan) {
		reqPlan = plan;
		reqOpen = true;
	}

	// Edit/delete are draft-only (in-code guard in useDeleteMealPlanDraft /
	// updateMealPlanDraft mirrors this — a confirmed plan may already be
	// requisitioned/serviced, so changing or removing it would orphan those
	// records' meal_plan_id reference).
	let editOpen = $state(false);
	let editPlan = $state<MealPlan | null>(null);

	function openEdit(plan: MealPlan) {
		editPlan = plan;
		editOpen = true;
	}

	let deleteConfirmOpen = $state(false);
	let pendingDeletePlan = $state<MealPlan | null>(null);

	function openDeleteConfirm(plan: MealPlan) {
		pendingDeletePlan = plan;
		deleteConfirmOpen = true;
	}

	async function confirmDelete() {
		if (!pendingDeletePlan) return;
		const plan = pendingDeletePlan;
		try {
			await deletePlan.mutateAsync(plan);
			toast.success(`ลบแผน ${MEAL_PERIOD_LABELS[plan.meal]} วันที่ ${plan.date} แล้ว`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
		} finally {
			pendingDeletePlan = null;
			deleteConfirmOpen = false;
		}
	}

	const today = new Date().toISOString().slice(0, 10);

	const todayPlans = $derived((plans.data ?? []).filter((p) => p.date === today));

	// Newest meal date first; same-date plans break ties by created_at (newest first).
	const sortedPlans = $derived(
		[...(plans.data ?? [])].sort(
			(a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at)
		)
	);

	const PAGE_SIZE = 10;
	let currentPage = $state(1);
	const paginatedPlans = $derived.by(() => {
		const start = (currentPage - 1) * PAGE_SIZE;
		return sortedPlans.slice(start, start + PAGE_SIZE);
	});

	async function handleConfirm(plan: MealPlan) {
		// Fail fast at confirm instead of only at เบิก — a plan with unresolved
		// BOM ingredients can never actually be withdrawn, so don't let it move
		// past draft and look "ready" when it isn't.
		if (isBomSourced(plan)) {
			toast.error(
				'ยืนยันไม่ได้ — แผนนี้มีวัตถุดิบที่ยังไม่เชื่อมกับสต็อกจริง (ชื่อในสูตรกับชื่อในคลังไม่ตรงกัน) แก้ชื่อให้ตรงกันก่อนแล้วค่อยยืนยัน'
			);
			return;
		}
		// Same fail-fast for gas (CR-085) — a plan whose planned draw already
		// exceeds a cylinder's remaining balance can never actually be
		// withdrawn (requisition-dialog hard-blocks it), so don't let it move
		// past draft looking "ready".
		if (gasShortfalls(plan).length > 0) {
			toast.error(
				'ยืนยันไม่ได้ — ถังแก๊สบางใบเหลือไม่พอตามที่แผนนี้คำนวณไว้ เติมแก๊สหรือแก้แผนก่อนแล้วค่อยยืนยัน'
			);
			return;
		}
		try {
			await confirm.mutateAsync(plan);
			toast.success(`ยืนยันแผน ${MEAL_PERIOD_LABELS[plan.meal]} วันที่ ${plan.date} แล้ว`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
		}
	}

	// _id is a ulid now (multiple plans may share a date+meal) — show the plan's
	// own date+meal fields directly instead of parsing them back out of the id.
	function planRef(plan: MealPlan): string {
		return `${plan.date}:${plan.meal}`;
	}

	// Display label + unit for a recipe row: fixed SOP ids first, then a
	// supply_item lookup (custom mode, or a resolved/linked BOM ingredient),
	// then an item_master lookup (an unresolved BOM ingredient — still shows a
	// real name even though it can't be withdrawn yet), else the raw id.
	function recipeLabel(recipeId: string): { label: string; unit: string } {
		if (RECIPE_LABELS[recipeId]) {
			const recipe = RECIPE_LABELS[recipeId];
			return { ...recipe, unit: formatUnit(recipe.unit, units, langState.current) };
		}
		const supplyItem = supplyItems.data?.find((i) => i._id === recipeId);
		if (supplyItem)
			return {
				label: supplyItem.name,
				unit: formatUnit(supplyItem.unit, units, langState.current)
			};
		const itemMaster = itemMasters.data?.find((im) => im._id === recipeId);
		if (itemMaster)
			return {
				label: itemMaster.name,
				unit: formatUnit(itemMaster.base_unit, units, langState.current)
			};
		return { label: recipeId, unit: '' };
	}

	function formatTime(iso: string): string {
		return new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
	}

	// How much more than the shelter's current on-hand stock this recipe row
	// needs (0 = fully covered) — in the same display unit as planned_qty/meta.unit
	// (converted back from the stock unit when a static mapping applies, e.g.
	// rice: on-hand kg × 1000 → g). BOM rows (item_master:*) are skipped — they
	// already show their own "ยังเบิกไม่ได้จริง" note regardless of qty.
	function stockShortfall(recipe: MealPlanRecipe): number {
		if (recipe.recipe_id.startsWith('item_master:')) return 0;
		const stock = RECIPE_TO_STOCK_ITEM[recipe.recipe_id];
		const onHand = Number(stockBalance.data?.get(stock?.item_id ?? recipe.recipe_id) ?? '0');
		const onHandDisplayUnit = stock ? onHand * stock.recipe_per_stock_unit : onHand;
		return Math.max(0, recipe.planned_qty - onHandDisplayUnit);
	}

	// Gas cylinders (CR-085) this plan would draw short of — same "flag it in
	// the table" treatment as stockShortfall above, so a gas shortfall is
	// visible before staff even open the requisition dialog where it's a hard
	// block.
	function gasShortfalls(
		plan: MealPlan
	): { name: string; remaining: string; consumption_kg: string }[] {
		if (!plan.gas_usage?.length) return [];
		return plan.gas_usage
			.map((g) => {
				const cyl = (gasTypes.data ?? []).find((t) => t._id === g.cylinder_id);
				const remaining = cyl
					? gasCylinderBalance(gasLedger.data ?? [], g.cylinder_id, cyl.capacity_kg)
					: '0';
				return { name: cyl?.name ?? g.cylinder_id, remaining, consumption_kg: g.consumption_kg };
			})
			.filter((g) => qtyGt(g.consumption_kg, g.remaining));
	}
</script>

{#snippet stageBadge(stage: PlanStage)}
	{#if stage === 'draft'}
		<span
			class="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-900"
		>
			<Clock class="h-3 w-3" />
			รอยืนยัน
		</span>
	{:else if stage === 'awaiting_requisition'}
		<span
			class="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-900"
		>
			<Clock class="h-3 w-3" />
			รอเบิก
		</span>
	{:else if stage === 'awaiting_service'}
		<span
			class="inline-flex items-center gap-1 rounded-full border border-orange-200 bg-orange-50 px-2.5 py-1 text-xs font-medium text-orange-900"
		>
			<Clock class="h-3 w-3" />
			รอบันทึก
		</span>
	{:else}
		<span
			class="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-900"
		>
			<CheckCircle class="h-3 w-3" />
			สำเร็จ
		</span>
	{/if}
{/snippet}

{#snippet planRecipes(plan: MealPlan)}
	<p class="text-sm font-medium">
		{plan.label ?? MEAL_PERIOD_LABELS[plan.meal]}
	</p>
	{#each plan.recipes ?? [] as recipe (recipe.recipe_id)}
		{@const meta = recipeLabel(recipe.recipe_id)}
		{@const unresolved = recipe.recipe_id.startsWith('item_master:')}
		{@const shortfall = stockShortfall(recipe)}
		<p
			class="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground"
			title={unresolved
				? 'ชื่อวัตถุดิบในสูตรไม่ตรงกับชื่อในคลัง — แก้ชื่อให้ตรงกันเพื่อให้เบิกได้'
				: shortfall > 0
					? 'ของขาดสต็อก — คลังมีไม่พอตามยอดที่ต้องใช้'
					: recipe.recipe_id === RICE_RECIPE_ID
						? 'คำนวณเป็นกรัมตามสัดส่วน SOP — ตอนเบิกจะถูกแปลงเป็นกิโลกรัม (kg) ให้ตรงหน่วยคลัง'
						: undefined}
		>
			{#if unresolved || shortfall > 0}
				<TriangleAlert class="h-3 w-3 shrink-0 text-amber-600" />
			{/if}
			{meta.label}: {recipe.planned_qty.toLocaleString()}
			{meta.unit}
			{#if unresolved}
				<span class="text-amber-600">(ยังไม่เชื่อมกับสต็อกจริง — ชื่อไม่ตรงกับคลัง)</span>
			{:else if shortfall > 0}
				<span class="text-amber-600">(ขาดอีก {shortfall.toLocaleString()} {meta.unit})</span>
			{/if}
		</p>
	{/each}
	{#each gasShortfalls(plan) as g (g.name)}
		<p
			class="mt-0.5 flex items-center gap-1 text-xs text-amber-600"
			title="ถังแก๊สเหลือไม่พอตามที่แผนนี้คำนวณไว้ — เติมแก๊สหรือแก้แผนก่อนเบิก"
		>
			<TriangleAlert class="h-3 w-3 shrink-0" />
			แก๊ส {g.name}: เหลือ {g.remaining} kg (ต้องใช้ {g.consumption_kg} kg)
		</p>
	{/each}
	{#if plan.override_reason}
		<p class="mt-0.5 text-xs text-amber-700" title={plan.override_reason}>
			⚑ แก้ยอด: {plan.override_reason}
		</p>
	{/if}
{/snippet}

{#snippet planActions(plan: MealPlan, stage: PlanStage, stacked = false)}
	{#if stage === 'draft'}
		{@const blocked = isBomSourced(plan) || gasShortfalls(plan).length > 0}
		<div
			class={stacked ? 'flex w-full flex-col gap-2' : 'flex items-center justify-center gap-1.5'}
		>
			<Button
				size="sm"
				variant="outline"
				class={stacked ? 'min-h-11 w-full' : ''}
				onclick={() => handleConfirm(plan)}
				disabled={confirm.isPending || blocked}
				title={blocked
					? 'มีคำเตือนในแผนนี้ (วัตถุดิบยังไม่เชื่อมสต็อก หรือแก๊สไม่พอ) — แก้ก่อนยืนยัน'
					: undefined}
			>
				ยืนยันแผน
			</Button>
			<div class={stacked ? 'flex w-full gap-2' : 'contents'}>
				<Button
					size="sm"
					variant="outline"
					class={stacked ? 'min-h-11 min-w-11 flex-1' : ''}
					title="แก้ไขแผน (draft)"
					onclick={() => openEdit(plan)}
				>
					<Pencil class="h-3.5 w-3.5" />
					{#if stacked}<span class="sr-only">แก้ไข</span>{/if}
				</Button>
				<Button
					size="sm"
					variant="outline"
					title="ลบแผน (draft)"
					class="text-destructive hover:text-destructive {stacked
						? 'min-h-11 min-w-11 flex-1'
						: ''}"
					onclick={() => openDeleteConfirm(plan)}
					disabled={deletePlan.isPending}
				>
					<Trash2 class="h-3.5 w-3.5" />
					{#if stacked}<span class="sr-only">ลบ</span>{/if}
				</Button>
			</div>
		</div>
	{:else if stage === 'awaiting_requisition'}
		<div class={stacked ? 'flex w-full flex-col gap-1' : 'flex flex-col items-center gap-1'}>
			<Button
				size="sm"
				variant="outline"
				class={stacked ? 'min-h-11 w-full' : ''}
				onclick={() => openRequisition(plan)}
				disabled={isBomSourced(plan)}
				title={isBomSourced(plan)
					? 'แผนนี้มีวัตถุดิบจากสูตร BOM ที่ยังไม่เชื่อมกับสต็อกจริง (ชื่อในสูตรกับชื่อในคลังไม่ตรงกัน) เบิกไม่ได้จนกว่าจะแก้ชื่อให้ตรงกัน'
					: undefined}
			>
				<PackageCheck class="mr-1 h-3.5 w-3.5" />
				เบิกวัตถุดิบ
			</Button>
			{#if isBomSourced(plan)}
				<p class="max-w-[220px] text-center text-2xs text-amber-600">
					มีวัตถุดิบยังไม่เชื่อมกับสต็อกจริง (ชื่อไม่ตรงกับคลัง)
				</p>
			{/if}
		</div>
	{:else if stage === 'awaiting_service'}
		<Button
			size="sm"
			variant="outline"
			class={stacked ? 'min-h-11 w-full' : ''}
			onclick={() => openService(plan)}
		>
			<ClipboardCheck class="mr-1 h-3.5 w-3.5" />
			บันทึกบริการ
		</Button>
	{/if}
{/snippet}

<div class="flex flex-col gap-4 p-4 sm:p-6">
	<!-- SOP setup notice — master profiles are seeded by system_admin, not from here (CR-006) -->
	{#if !sopProfile.isPending && !sopProfile.data}
		<Card.Root class="border border-amber-200 bg-amber-50 shadow-2xs">
			<Card.Content class="pt-4">
				<p class="font-semibold text-amber-800">ยังไม่มีค่ามาตรฐาน SOP ในระบบ</p>
				<p class="mt-0.5 text-xs text-amber-700">
					ค่ามาตรฐาน SOP (สัดส่วนวัตถุดิบต่อคน) เป็นข้อมูลส่วนกลาง — ตั้งค่าโดยผู้ดูแลระบบเท่านั้น
					กรุณาติดต่อผู้ดูแลระบบเพื่อสร้าง master SOP profile ก่อนวางแผนอาหาร
				</p>
			</Card.Content>
		</Card.Root>
	{/if}

	<!-- Table / card list -->
	<Card.Root class="border border-slate-200/80 shadow-2xs">
		<Card.Header class="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
			<div class="flex items-start gap-3">
				<div class="rounded-lg border border-sky-200 bg-sky-50 p-2">
					<ClipboardList class="h-4 w-4 text-sky-600" />
				</div>
				<div>
					<Card.Title class="text-sm font-bold">
						ตารางแผนอาหาร ({(plans.data ?? []).length} รายการ)
					</Card.Title>
					<Card.Description class="text-xs">
						แผนทั้งหมด — วันนี้ {todayPlans.length} แผน
					</Card.Description>
				</div>
			</div>
			<div class="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
				<Button
					onclick={() => openCreate('recipe')}
					class="min-h-11 w-full rounded-lg px-5 sm:w-auto"
				>
					<Play class="mr-1.5 h-3.5 w-3.5" />
					เพิ่มสูตรมาตรฐาน (BOM)
				</Button>
				<Button
					variant="outline"
					onclick={() => openCreate('custom')}
					class="min-h-11 w-full rounded-lg px-4 sm:w-auto"
				>
					<FileText class="mr-1.5 h-3.5 w-3.5" />
					กำหนดสูตรเอง (Custom)
				</Button>
			</div>
		</Card.Header>

		<Card.Content class="p-0">
			{#if plans.isPending}
				<p class="p-6 text-center text-sm text-muted-foreground">กำลังโหลด...</p>
			{:else if !plans.data?.length}
				<p class="p-6 text-center text-sm text-muted-foreground">ยังไม่มีแผนอาหาร</p>
			{:else}
				<!-- Mobile cards (< md) -->
				<div class="divide-y divide-border/60 md:hidden">
					{#each paginatedPlans as plan (plan._id)}
						{@const stage = planStage(plan)}
						<article class="flex flex-col gap-3 p-4">
							<div class="flex items-start justify-between gap-3">
								<div class="min-w-0">
									<p class="font-mono text-xs font-semibold text-foreground">{planRef(plan)}</p>
									<p class="text-xs text-muted-foreground">
										{new Date(plan.created_at).toLocaleDateString('th-TH', {
											day: '2-digit',
											month: '2-digit',
											year: 'numeric'
										})}
										· {formatTime(plan.created_at)} น.
									</p>
								</div>
								{@render stageBadge(stage)}
							</div>
							<div>
								{@render planRecipes(plan)}
							</div>
							<div class="flex items-baseline justify-between gap-2 border-t border-border/40 pt-2">
								<span class="text-xs text-muted-foreground">ยอดจัดสรร</span>
								<span class="text-sm font-semibold tabular-nums"
									>{plan.headcount.total.toLocaleString()} คน</span
								>
							</div>
							{@render planActions(plan, stage, true)}
						</article>
					{/each}
				</div>

				<!-- Desktop table (md+) -->
				<div class="hidden overflow-x-auto md:block">
					<Table.Root>
						<Table.Header>
							<Table.Row class="text-xs">
								<Table.Head class="min-w-[140px] px-6">แผน (วัน:มื้อ) / เวลาบันทึก</Table.Head>
								<Table.Head class="min-w-[240px] px-6">ตำรับเสบียงอาหาร (เมนู)</Table.Head>
								<Table.Head class="min-w-[120px] px-6 text-right">ยอดจัดสรรผลิต</Table.Head>
								<Table.Head class="min-w-[140px] px-6 text-center">สถานะ</Table.Head>
								<Table.Head class="min-w-[140px] px-6 text-center">จัดการข้อมูล</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each paginatedPlans as plan (plan._id)}
								{@const stage = planStage(plan)}
								<Table.Row>
									<Table.Cell class="px-6 font-mono text-xs">
										<p class="font-semibold text-foreground">{planRef(plan)}</p>
										<p class="text-muted-foreground">
											{new Date(plan.created_at).toLocaleDateString('th-TH', {
												day: '2-digit',
												month: '2-digit',
												year: 'numeric'
											})}
											· {formatTime(plan.created_at)} น.
										</p>
									</Table.Cell>
									<Table.Cell class="max-w-xs px-6">
										{@render planRecipes(plan)}
									</Table.Cell>
									<Table.Cell class="px-6 text-right">
										<p class="font-semibold tabular-nums">
											{plan.headcount.total.toLocaleString()}
										</p>
										<p class="text-xs text-muted-foreground">คน</p>
									</Table.Cell>
									<Table.Cell class="px-6 text-center">
										{@render stageBadge(stage)}
									</Table.Cell>
									<Table.Cell class="px-6 text-center">
										{@render planActions(plan, stage)}
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</div>
				{#if (plans.data?.length ?? 0) > PAGE_SIZE}
					<div class="flex justify-center p-4 sm:justify-end">
						<Pagination.Root
							bind:page={currentPage}
							count={plans.data?.length ?? 0}
							perPage={PAGE_SIZE}
						>
							{#snippet children({ pages })}
								<Pagination.Content>
									<Pagination.Previous />
									{#each pages as p, i (p.type === 'page' ? `page-${p.value}` : `ellipsis-${i}`)}
										<Pagination.Item>
											{#if p.type === 'page'}
												<Pagination.Link page={p} isActive={p.value === currentPage} />
											{:else}
												<Pagination.Ellipsis />
											{/if}
										</Pagination.Item>
									{/each}
									<Pagination.Next />
								</Pagination.Content>
							{/snippet}
						</Pagination.Root>
					</div>
				{/if}
			{/if}
		</Card.Content>
	</Card.Root>
</div>

<MealPlanForm bind:open={createOpen} defaultMode={createDefaultMode} />
<MealPlanForm bind:open={editOpen} plan={editPlan} />
<RequisitionDialog bind:open={reqOpen} plan={reqPlan} />
<MealServiceForm bind:open={serviceOpen} plan={servicePlan} />

<AlertDialog.Root bind:open={deleteConfirmOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>ลบแผนอาหารนี้?</AlertDialog.Title>
			<AlertDialog.Description>
				{#if pendingDeletePlan}
					ลบแผน {MEAL_PERIOD_LABELS[pendingDeletePlan.meal]} วันที่ {pendingDeletePlan.date}
					(draft) — ยังไม่เบิกวัตถุดิบหรือบันทึกบริการ ลบได้โดยไม่กระทบสต็อก แต่กู้คืนไม่ได้
				{/if}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel onclick={() => (pendingDeletePlan = null)}>ยกเลิก</AlertDialog.Cancel>
			<AlertDialog.Action
				class="bg-destructive text-white hover:bg-destructive/90"
				onclick={confirmDelete}
			>
				ลบแผน
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
