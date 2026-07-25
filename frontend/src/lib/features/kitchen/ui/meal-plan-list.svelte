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
		type MealPlan,
		type MealPlanRecipe
	} from '$lib/features/kitchen';
	import { useActiveSopProfile } from '$lib/features/sop-ratios';
	import { useSupplyItems } from '$lib/features/supply';
	import { useItemMasters } from '$lib/features/catalog';
	import { useStockBalance } from '$lib/features/operations';

	const plans = useMealPlans();
	const supplyItems = useSupplyItems();
	const itemMasters = useItemMasters();
	const stockBalance = useStockBalance();
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
		if (RECIPE_LABELS[recipeId]) return RECIPE_LABELS[recipeId];
		const supplyItem = supplyItems.data?.find((i) => i._id === recipeId);
		if (supplyItem) return { label: supplyItem.name, unit: supplyItem.unit };
		const itemMaster = itemMasters.data?.find((im) => im._id === recipeId);
		if (itemMaster) return { label: itemMaster.name, unit: itemMaster.base_unit };
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
</script>

<div class="flex flex-col gap-4 p-4">
	<!-- SOP setup notice — master profiles are seeded by system_admin, not from here (CR-006) -->
	{#if !sopProfile.isPending && !sopProfile.data}
		<Card.Root class="border-amber-300 bg-amber-50">
			<Card.Content class="pt-4">
				<p class="font-semibold text-amber-800">ยังไม่มีค่ามาตรฐาน SOP ในระบบ</p>
				<p class="mt-0.5 text-xs text-amber-700">
					ค่ามาตรฐาน SOP (สัดส่วนวัตถุดิบต่อคน) เป็นข้อมูลส่วนกลาง — ตั้งค่าโดยผู้ดูแลระบบเท่านั้น
					กรุณาติดต่อผู้ดูแลระบบเพื่อสร้าง master SOP profile ก่อนวางแผนอาหาร
				</p>
			</Card.Content>
		</Card.Root>
	{/if}

	<!-- Table section -->
	<Card.Root class="border-0 shadow-sm">
		<Card.Header class="flex flex-row items-center justify-between py-4">
			<div class="flex items-start gap-3">
				<div class="rounded-lg bg-blue-50 p-2">
					<ClipboardList class="h-4 w-4 text-blue-500" />
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
			<div class="flex items-center gap-2">
				<Button onclick={() => openCreate('recipe')} class="rounded-full px-5">
					<Play class="mr-1.5 h-3.5 w-3.5" />
					เพิ่มสูตรมาตรฐาน (BOM)
				</Button>
				<Button variant="outline" onclick={() => openCreate('custom')} class="rounded-full px-4">
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
				<div class="overflow-x-auto">
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
													<span class="text-amber-600"
														>(ยังไม่เชื่อมกับสต็อกจริง — ชื่อไม่ตรงกับคลัง)</span
													>
												{:else if shortfall > 0}
													<span class="text-amber-600"
														>(ขาดอีก {shortfall.toLocaleString()} {meta.unit})</span
													>
												{/if}
											</p>
										{/each}
										{#if plan.override_reason}
											<p class="mt-0.5 text-xs text-amber-700" title={plan.override_reason}>
												⚑ แก้ยอด: {plan.override_reason}
											</p>
										{/if}
									</Table.Cell>
									<Table.Cell class="px-6 text-right">
										<p class="font-semibold">{plan.headcount.total.toLocaleString()}</p>
										<p class="text-xs text-muted-foreground">คน</p>
									</Table.Cell>
									{@const stage = planStage(plan)}
									<Table.Cell class="px-6 text-center">
										{#if stage === 'draft'}
											<span
												class="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2.5 py-1 text-xs font-medium text-yellow-800"
											>
												<Clock class="h-3 w-3" />
												รอยืนยัน
											</span>
										{:else if stage === 'awaiting_requisition'}
											<span
												class="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-1 text-xs font-medium text-blue-800"
											>
												<Clock class="h-3 w-3" />
												รอเบิก
											</span>
										{:else if stage === 'awaiting_service'}
											<span
												class="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2.5 py-1 text-xs font-medium text-purple-800"
											>
												<Clock class="h-3 w-3" />
												รอบันทึก
											</span>
										{:else}
											<span
												class="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-800"
											>
												<CheckCircle class="h-3 w-3" />
												สำเร็จ
											</span>
										{/if}
									</Table.Cell>
									<Table.Cell class="px-6 text-center">
										{#if stage === 'draft'}
											<div class="flex items-center justify-center gap-1.5">
												<Button
													size="sm"
													variant="outline"
													onclick={() => handleConfirm(plan)}
													disabled={confirm.isPending}
												>
													ยืนยันแผน
												</Button>
												<Button
													size="sm"
													variant="outline"
													title="แก้ไขแผน (draft)"
													onclick={() => openEdit(plan)}
												>
													<Pencil class="h-3.5 w-3.5" />
												</Button>
												<Button
													size="sm"
													variant="outline"
													title="ลบแผน (draft)"
													class="text-destructive hover:text-destructive"
													onclick={() => openDeleteConfirm(plan)}
													disabled={deletePlan.isPending}
												>
													<Trash2 class="h-3.5 w-3.5" />
												</Button>
											</div>
										{:else if stage === 'awaiting_requisition'}
											<div class="flex flex-col items-center gap-1">
												<Button
													size="sm"
													variant="outline"
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
													<p class="max-w-[220px] text-center text-[11px] text-amber-600">
														มีวัตถุดิบยังไม่เชื่อมกับสต็อกจริง (ชื่อไม่ตรงกับคลัง)
													</p>
												{/if}
											</div>
										{:else if stage === 'awaiting_service'}
											<Button size="sm" variant="outline" onclick={() => openService(plan)}>
												<ClipboardCheck class="mr-1 h-3.5 w-3.5" />
												บันทึกบริการ
											</Button>
										{/if}
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</div>
				{#if (plans.data?.length ?? 0) > PAGE_SIZE}
					<div class="flex justify-end p-4">
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
