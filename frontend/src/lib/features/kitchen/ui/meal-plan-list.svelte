<script lang="ts">
	import UtensilsCrossed from '@lucide/svelte/icons/utensils-crossed';
	import CheckCircle from '@lucide/svelte/icons/check-circle';
	import Clock from '@lucide/svelte/icons/clock';
	import Flame from '@lucide/svelte/icons/flame';
	import ClipboardList from '@lucide/svelte/icons/clipboard-list';
	import Plus from '@lucide/svelte/icons/plus';
	import FileText from '@lucide/svelte/icons/file-text';
	import PackageCheck from '@lucide/svelte/icons/package-check';
	import ClipboardCheck from '@lucide/svelte/icons/clipboard-check';
	import { resolve } from '$app/paths';
	import * as Card from '$lib/components/ui/card';
	import * as Table from '$lib/components/ui/table';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import * as Pagination from '$lib/components/ui/pagination';
	import { Button } from '$lib/components/ui/button';
	import { toast } from 'svelte-sonner';
	import { authStore } from '$lib/stores/auth.svelte';
	import {
		useMealPlans,
		useOccupancyHeadcount,
		useConfirmMealPlan,
		useGasCylinderTypes,
		useRequisitions,
		useMealServices,
		MEAL_PERIOD_LABELS,
		RICE_RECIPE_ID,
		MealPlanForm,
		RequisitionDialog,
		MealServiceForm,
		type MealPlan
	} from '$lib/features/kitchen';
	import { useActiveSopProfile } from '$lib/features/sop-ratios';

	const plans = useMealPlans();
	let createOpen = $state(false);
	const confirm = useConfirmMealPlan();
	const sopProfile = useActiveSopProfile();
	const gasTypes = useGasCylinderTypes();
	const occupancy = useOccupancyHeadcount();
	const requisitions = useRequisitions();
	const mealServices = useMealServices();

	// Plans that already have a recorded service — drives the "✓ บันทึกแล้ว" hint.
	// meal_service _id shares the plan's deterministic date:meal key (append-only,
	// one record per meal), so a matching date+meal means service is logged.
	const servicedPlanKeys = $derived(
		new Set((mealServices.data ?? []).map((s) => `${s.date}:${s.meal}`))
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

	// Re-issuing an already-requisitioned plan is a valid case (e.g. topping up
	// a prior partial issue once stock arrives) — so the button stays enabled,
	// but a double-click / forgotten-already-issued mistake must not silently
	// deduct stock twice (append-only ledger has no uniqueness on meal_plan_id).
	// Confirmation runs through AlertDialog below, not window.confirm.
	let reissueConfirmOpen = $state(false);
	let pendingReissuePlan = $state<MealPlan | null>(null);

	function openRequisition(plan: MealPlan) {
		if (requisitionedPlanIds.has(plan._id)) {
			pendingReissuePlan = plan;
			reissueConfirmOpen = true;
			return;
		}
		reqPlan = plan;
		reqOpen = true;
	}

	function confirmReissue() {
		if (pendingReissuePlan) {
			reqPlan = pendingReissuePlan;
			reqOpen = true;
		}
		pendingReissuePlan = null;
		reissueConfirmOpen = false;
	}

	const today = new Date().toISOString().slice(0, 10);

	const todayPlans = $derived((plans.data ?? []).filter((p) => p.date === today));

	const PAGE_SIZE = 10;
	let currentPage = $state(1);
	const paginatedPlans = $derived.by(() => {
		const start = (currentPage - 1) * PAGE_SIZE;
		return (plans.data ?? []).slice(start, start + PAGE_SIZE);
	});

	const stats = $derived.by(() => {
		const all = plans.data ?? [];
		const totalBoxes = all.reduce((sum, p) => sum + p.headcount.total, 0);
		const confirmed = all.filter((p) => p.status === 'confirmed').length;
		return {
			totalBoxes,
			confirmed,
			total: all.length
		};
	});

	async function handleConfirm(plan: MealPlan) {
		try {
			await confirm.mutateAsync(plan);
			toast.success(`ยืนยันแผน ${MEAL_PERIOD_LABELS[plan.meal]} วันที่ ${plan.date} แล้ว`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
		}
	}

	// meal_plan:{date}:{meal} — the real deterministic reference, not a fabricated code.
	function formatId(id: string): string {
		const parts = id.split(':');
		return parts.slice(1).join(':') || id;
	}

	// Rice qty (grams) from the calculated recipes — the actual ingredient output.
	function riceGrams(plan: MealPlan): number | null {
		const rice = plan.recipes?.find((r) => r.recipe_id === RICE_RECIPE_ID);
		return rice ? rice.planned_qty : null;
	}

	function formatTime(iso: string): string {
		return new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
	}
</script>

<div class="flex flex-col gap-4 p-4">
	<!-- Header card -->
	<Card.Root class="border-0 shadow-sm">
		<Card.Content class="flex flex-wrap items-start justify-between gap-4 pt-4">
			<div class="flex items-start gap-3">
				<div class="rounded-lg bg-primary/10 p-2">
					<UtensilsCrossed class="h-5 w-5 text-primary" />
				</div>
				<div>
					<h2 class="text-base font-bold">ประวัติประกอบโรงครัว (Meal Production Logs)</h2>
					<p class="mt-0.5 text-xs text-muted-foreground">
						บันทึกการวางแผนอาหารและรายการวัตถุดิบที่ต้องเบิกต่อมื้อ
					</p>
				</div>
			</div>
			<div class="flex flex-wrap items-center gap-2">
				<span
					class="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-800"
				>
					<span class="h-1.5 w-1.5 rounded-full bg-green-500"></span>
					ผู้พักพิง (LIVE COUNT): {occupancy.data?.total ?? 0} คน
				</span>
				<a
					href={resolve('/back-office/kitchen/gas')}
					class="inline-flex items-center gap-1.5 rounded-full bg-orange-100 px-3 py-1 text-xs font-medium text-orange-800 transition-colors hover:bg-orange-200"
					title="จัดการทรัพยากรแก๊ส"
				>
					<Flame class="h-3.5 w-3.5" />
					ถังแก๊ส ({gasTypes.data?.length ?? 0})
				</a>
				<span
					class="inline-flex cursor-not-allowed items-center gap-1.5 rounded-full border border-dashed border-muted-foreground/40 px-3 py-1 text-xs font-medium text-muted-foreground/60"
					title="ยังไม่พร้อมใช้งาน"
				>
					ฐานสูตร BOM
				</span>
				<span
					class="inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium"
				>
					{authStore.user?.name ?? '—'}
				</span>
			</div>
		</Card.Content>
	</Card.Root>

	<!-- Stats — borderless cards, shadow only -->
	<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
		<div class="rounded-xl bg-white px-5 py-4 shadow-sm">
			<p class="text-xs text-muted-foreground">กล่องอาหารสำเร็จรวม</p>
			<p class="mt-1 text-2xl font-bold">{stats.totalBoxes.toLocaleString()}</p>
			<p class="text-xs text-muted-foreground">กล่อง</p>
		</div>
		<div class="rounded-xl bg-white px-5 py-4 shadow-sm">
			<p class="text-xs text-muted-foreground">แก๊สหุงต้มใช้ไปรวม</p>
			<p class="mt-1 text-2xl font-bold text-muted-foreground">—</p>
			<p class="text-xs text-muted-foreground">กก.</p>
		</div>
		<div class="rounded-xl bg-white px-5 py-4 shadow-sm">
			<p class="text-xs text-muted-foreground">เตาประกอบพร้อมลุย</p>
			<p class="mt-1 text-2xl font-bold">{stats.confirmed} / {stats.total}</p>
			<p class="text-xs text-muted-foreground">หัว</p>
		</div>
		<div class="rounded-xl bg-white px-5 py-4 shadow-sm">
			<p class="text-xs text-muted-foreground">เวลาเฉลี่ยประกอบเสบียง</p>
			<p class="mt-1 text-2xl font-bold text-muted-foreground">~ —</p>
			<p class="text-xs text-muted-foreground">นาที</p>
		</div>
	</div>

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
				<Button
					onclick={() => (createOpen = true)}
					class="rounded-full bg-green-600 px-5 text-white hover:bg-green-700"
				>
					<Plus class="mr-1.5 h-3.5 w-3.5" />
					สร้างแผนอาหารใหม่
				</Button>
				<!-- BOM / production-board ยังไม่พร้อม (coming soon) — ซ่อนปุ่มไว้ก่อนกันหลงทาง -->
				<span
					class="inline-flex cursor-not-allowed items-center gap-1.5 rounded-full border border-dashed border-muted-foreground/40 px-4 py-2 text-xs font-medium text-muted-foreground/60"
					title="ยังไม่พร้อมใช้งาน"
				>
					<FileText class="h-3.5 w-3.5" />
					ฐานสูตร BOM (เร็วๆ นี้)
				</span>
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
										<p class="font-semibold text-foreground">{formatId(plan._id)}</p>
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
										<p class="text-sm font-medium">{MEAL_PERIOD_LABELS[plan.meal]}</p>
										{#if riceGrams(plan) !== null}
											<p
												class="mt-0.5 text-xs text-muted-foreground"
												title="คำนวณเป็นกรัมตามสัดส่วน SOP — ตอนเบิกจะถูกแปลงเป็นกิโลกรัม (kg) ให้ตรงหน่วยคลัง"
											>
												ข้าวสาร: {riceGrams(plan)?.toLocaleString()} g
											</p>
										{/if}
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
									<Table.Cell class="px-6 text-center">
										{#if plan.status === 'confirmed'}
											<span
												class="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-800"
											>
												<CheckCircle class="h-3 w-3" />
												สำเร็จสมบูรณ์
											</span>
										{:else}
											<span
												class="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2.5 py-1 text-xs font-medium text-yellow-800"
											>
												<Clock class="h-3 w-3" />
												รอดำเนินการ
											</span>
										{/if}
									</Table.Cell>
									<Table.Cell class="px-6 text-center">
										{#if plan.status === 'draft'}
											<Button
												size="sm"
												variant="outline"
												onclick={() => handleConfirm(plan)}
												disabled={confirm.isPending}
											>
												ยืนยันแผน
											</Button>
										{:else}
											<div class="flex flex-col items-center gap-1">
												<div class="flex items-center gap-1.5">
													<Button size="sm" variant="outline" onclick={() => openRequisition(plan)}>
														<PackageCheck class="mr-1 h-3.5 w-3.5" />
														เบิกวัตถุดิบ
													</Button>
													<Button size="sm" variant="outline" onclick={() => openService(plan)}>
														<ClipboardCheck class="mr-1 h-3.5 w-3.5" />
														บันทึกบริการ
													</Button>
												</div>
												<div class="flex items-center gap-2">
													{#if requisitionedPlanIds.has(plan._id)}
														<span class="text-[11px] text-emerald-600">✓ เบิกแล้ว</span>
													{/if}
													{#if servicedPlanKeys.has(`${plan.date}:${plan.meal}`)}
														<span class="text-[11px] text-indigo-600">✓ บันทึกบริการแล้ว</span>
													{/if}
												</div>
											</div>
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
									{#each pages as p, i (i)}
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

<MealPlanForm bind:open={createOpen} />
<RequisitionDialog bind:open={reqOpen} plan={reqPlan} />
<MealServiceForm bind:open={serviceOpen} plan={servicePlan} />

<AlertDialog.Root bind:open={reissueConfirmOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>แผนนี้เบิกวัตถุดิบไปแล้ว</AlertDialog.Title>
			<AlertDialog.Description>
				ต้องการเบิกซ้ำ/เบิกเพิ่มหรือไม่? ยืนยันเฉพาะกรณีเบิกเพิ่มเติม (เช่น ของครั้งก่อนไม่พอ) —
				หากกดผิด การเบิกซ้ำจะตัดสต็อกซ้ำ
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel onclick={() => (pendingReissuePlan = null)}>ยกเลิก</AlertDialog.Cancel>
			<AlertDialog.Action onclick={confirmReissue}>ยืนยันเบิกเพิ่ม</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
