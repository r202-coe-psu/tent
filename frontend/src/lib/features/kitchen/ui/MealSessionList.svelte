<script lang="ts">
	import {
		useMealSessions,
		useMealPlans,
		useMealServices,
		useKitchenRequisitions,
		useActiveEvacueeDietCounts,
		useCreateMealSession,
		useUpdateMealSession,
		useDeleteMealSession,
		computeSessionGroupProgress,
		computeMealVariance,
		MEAL_VARIANCE_STATUS_LABELS,
		TARGET_GROUP_LABELS,
		type MealSession,
		type MealPeriod,
		type TargetGroupTag,
		type MealVarianceStatus
	} from '$lib/features/kitchen';
	import { authStore } from '$lib/stores/auth.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import { formatThaiDateTime } from '$lib/utils/date';
	import { resolve } from '$app/paths';
	import * as Card from '$lib/components/ui/card';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Table from '$lib/components/ui/table';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import { toast } from 'svelte-sonner';
	import Plus from '@lucide/svelte/icons/plus';
	import ChefHat from '@lucide/svelte/icons/chef-hat';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import Clock from '@lucide/svelte/icons/clock';
	import XCircle from '@lucide/svelte/icons/x-circle';
	import Calendar from '@lucide/svelte/icons/calendar';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Check from '@lucide/svelte/icons/check';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Utensils from '@lucide/svelte/icons/utensils';
	import ClipboardCheck from '@lucide/svelte/icons/clipboard-check';
	import { SvelteSet } from 'svelte/reactivity';

	const sessions = useMealSessions();
	const plans = useMealPlans();
	const services = useMealServices();
	const requisitions = useKitchenRequisitions();
	const dietCounts = useActiveEvacueeDietCounts();

	const createSessionMutation = useCreateMealSession();
	const updateSessionMutation = useUpdateMealSession();
	const deleteSessionMutation = useDeleteMealSession();

	let createDialogOpen = $state(false);

	// Create Form state
	let formName = $state('');
	let formDate = $state(new Date().toISOString().slice(0, 10));
	let formMeal = $state<MealPeriod>('lunch');
	let formNotes = $state('');

	let countHalal = $state(0);
	let countInfant = $state(0);
	let countSoftFood = $state(0);
	let countRegular = $state(0);
	let countVolunteer = $state(0);

	const formTotal = $derived(
		Number(countHalal || 0) +
			Number(countInfant || 0) +
			Number(countSoftFood || 0) +
			Number(countRegular || 0) +
			Number(countVolunteer || 0)
	);

	function openCreateDialog() {
		const counts = dietCounts.data;
		if (counts) {
			countHalal = counts.halal;
			countInfant = counts.infant;
			countSoftFood = counts.soft_food;
			countRegular = counts.regular;
			countVolunteer = counts.volunteer;
		}
		const mealThai =
			formMeal === 'breakfast'
				? 'มื้อเช้า'
				: formMeal === 'lunch'
					? 'มื้อกลางวัน'
					: formMeal === 'dinner'
						? 'มื้อเย็น'
						: 'ของว่าง';
		formName = `${mealThai} วันที่ ${formDate}`;
		formNotes = '';
		createDialogOpen = true;
	}

	function handleMealChange(e: Event) {
		const target = e.target as HTMLSelectElement;
		formMeal = target.value as MealPeriod;
		const mealThai =
			formMeal === 'breakfast'
				? 'มื้อเช้า'
				: formMeal === 'lunch'
					? 'มื้อกลางวัน'
					: formMeal === 'dinner'
						? 'มื้อเย็น'
						: 'ของว่าง';
		formName = `${mealThai} วันที่ ${formDate}`;
	}

	async function handleCreateSession() {
		if (!formName.trim()) {
			toast.error('กรุณาระบุชื่อรอบมื้ออาหาร');
			return;
		}
		if (formTotal <= 0) {
			toast.error('กรุณาระบุจำนวนเป้าหมายอย่างน้อย 1 คน');
			return;
		}

		try {
			await createSessionMutation.mutateAsync({
				input: {
					name: formName.trim(),
					date: formDate,
					meal: formMeal,
					target_headcount: {
						halal: Number(countHalal || 0),
						infant: Number(countInfant || 0),
						soft_food: Number(countSoftFood || 0),
						regular: Number(countRegular || 0),
						volunteer: Number(countVolunteer || 0),
						total: formTotal
					},
					notes: formNotes.trim() || undefined
				},
				ctx: {
					shelterCode: getShelterCode(),
					createdBy: authStore.user?.name ?? 'staff'
				}
			});
			toast.success('สร้างรอบมื้ออาหารสำเร็จ');
			createDialogOpen = false;
		} catch (err) {
			const msg = err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการสร้างรอบมื้ออาหาร';
			toast.error(msg);
		}
	}

	async function handleCompleteSession(session: MealSession) {
		try {
			await updateSessionMutation.mutateAsync({
				session,
				patch: { status: 'completed' }
			});
			toast.success('บันทึกปิดรอบมื้ออาหารแล้ว');
		} catch (err) {
			const msg = err instanceof Error ? err.message : 'ไม่สามารถเปลี่ยนสถานะได้';
			toast.error(msg);
		}
	}

	async function handleDeleteSession(session: MealSession) {
		if (!confirm(`คุณต้องการลบรอบมื้ออาหาร "${session.name}" หรือไม่?`)) return;
		try {
			await deleteSessionMutation.mutateAsync(session);
			toast.success('ลบรอบมื้ออาหารแล้ว');
		} catch (err) {
			const msg = err instanceof Error ? err.message : 'ไม่สามารถลบได้';
			toast.error(msg);
		}
	}

	const sortedSessions = $derived.by(() => {
		const list = [...(sessions.data ?? [])];
		return list.sort(
			(a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at)
		);
	});

	const groupKeys: TargetGroupTag[] = ['halal', 'infant', 'soft_food', 'regular', 'volunteer'];

	const expandedSessionIds = new SvelteSet<string>();
	let initializedSessions = $state(false);

	$effect(() => {
		if (!initializedSessions && sortedSessions.length > 0) {
			for (const s of sortedSessions) {
				expandedSessionIds.add(s._id);
			}
			initializedSessions = true;
		}
	});

	function toggleSession(sessionId: string) {
		if (expandedSessionIds.has(sessionId)) {
			expandedSessionIds.delete(sessionId);
		} else {
			expandedSessionIds.add(sessionId);
		}
	}

	function expandAll() {
		for (const s of sortedSessions) {
			expandedSessionIds.add(s._id);
		}
	}

	function collapseAll() {
		expandedSessionIds.clear();
	}

	let activeTabPerSession = $state<Record<string, 'plans' | 'services'>>({});

	function getActiveTab(sessionId: string): 'plans' | 'services' {
		return activeTabPerSession[sessionId] ?? 'plans';
	}

	function setActiveTab(sessionId: string, tab: 'plans' | 'services') {
		activeTabPerSession[sessionId] = tab;
	}

	const STATUS_CLASS: Record<MealVarianceStatus, string> = {
		on_target: 'border-emerald-200 bg-emerald-50 text-emerald-700',
		over: 'border-orange-200 bg-orange-50 text-orange-700',
		under: 'border-amber-200 bg-amber-50 text-amber-700',
		no_plan: 'border-border bg-muted text-muted-foreground'
	};
</script>

<div class="space-y-4 p-4">
	<!-- Top Bar -->
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div>
			<h3 class="text-lg font-bold text-foreground">รอบมื้ออาหาร (Meal Production Sessions)</h3>
			<p class="text-xs text-muted-foreground">
				บริหารการผลิตอาหารแยกกลุ่มความต้องการพิเศษ 5 กลุ่ม และออกใบเบิกวัตถุดิบสู่คลัง
			</p>
		</div>
		<div class="flex flex-wrap items-center gap-2">
			{#if sortedSessions.length > 0}
				<div class="flex items-center gap-1.5 sm:gap-2">
					<Button
						variant="outline"
						size="sm"
						onclick={expandAll}
						class="rounded-xl border-border/60 text-xs font-medium"
					>
						ขยายทั้งหมด
					</Button>
					<Button
						variant="outline"
						size="sm"
						onclick={collapseAll}
						class="rounded-xl border-border/60 text-xs font-medium"
					>
						ยุบทั้งหมด
					</Button>
				</div>
			{/if}
			<Button onclick={openCreateDialog} class="gap-1.5 shadow-sm">
				<Plus class="h-4 w-4" />
				สร้างรอบมื้ออาหารใหม่
			</Button>
		</div>
	</div>

	<!-- Sessions List -->
	{#if sessions.isLoading}
		<div class="flex items-center justify-center p-12 text-muted-foreground">
			<Clock class="mr-2 h-5 w-5 animate-spin" /> กำลังโหลดรอบมื้ออาหาร...
		</div>
	{:else if sortedSessions.length === 0}
		<Card.Root class="border-dashed py-12 text-center">
			<Card.Content class="flex flex-col items-center justify-center">
				<ChefHat class="h-12 w-12 text-muted-foreground/50" />
				<h4 class="mt-4 text-base font-semibold">ยังไม่มีรอบมื้ออาหาร</h4>
				<p class="mt-1 max-w-sm text-xs text-muted-foreground">
					เริ่มต้นวางแผนอาหารและคำนวณสูตรโดยการสร้างรอบมื้ออาหารใหม่
				</p>
				<Button onclick={openCreateDialog} variant="outline" class="mt-4 gap-1.5">
					<Plus class="h-4 w-4" /> สร้างรอบมื้อแรก
				</Button>
			</Card.Content>
		</Card.Root>
	{:else}
		<div class="space-y-4">
			{#each sortedSessions as session (session._id)}
				{@const sessionPlans = (plans.data ?? []).filter((p) => p.meal_session_id === session._id)}
				{@const sessionServices = (services.data ?? []).filter(
					(s) => s.meal_session_id === session._id
				)}
				{@const progress = computeSessionGroupProgress(session, sessionPlans, sessionServices)}
				{@const isExpanded = expandedSessionIds.has(session._id)}

				<div
					class="overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm transition-all duration-200 hover:border-primary/40"
				>
					<!-- Card Header (Accordion Button) -->
					<button
						type="button"
						onclick={() => toggleSession(session._id)}
						aria-expanded={isExpanded}
						class="flex w-full flex-wrap items-center justify-between gap-2.5 bg-muted/30 px-3.5 py-2.5 text-left transition-colors hover:bg-muted/60 sm:px-5 sm:py-3 {isExpanded
							? 'border-b'
							: ''}"
					>
						<div class="flex min-w-0 flex-wrap items-center gap-2.5 sm:gap-3">
							<div
								class="shrink-0 rounded-lg border border-border/60 bg-background/80 p-1 text-muted-foreground shadow-sm"
							>
								{#if isExpanded}
									<ChevronDown class="h-4 w-4 text-primary" />
								{:else}
									<ChevronRight class="h-4 w-4" />
								{/if}
							</div>

							<div class="flex flex-wrap items-center gap-2">
								<span
									class="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold {session.meal ===
									'breakfast'
										? 'bg-amber-100 text-amber-800'
										: session.meal === 'lunch'
											? 'bg-orange-100 text-orange-800'
											: session.meal === 'dinner'
												? 'bg-indigo-100 text-indigo-800'
												: 'bg-emerald-100 text-emerald-800'}"
								>
									{session.meal === 'breakfast'
										? 'มื้อเช้า'
										: session.meal === 'lunch'
											? 'มื้อกลางวัน'
											: session.meal === 'dinner'
												? 'มื้อเย็น'
												: 'ของว่าง'}
								</span>
								<h4 class="text-base font-bold text-foreground">{session.name}</h4>
								<span class="inline-flex items-center gap-1 text-xs text-muted-foreground">
									<Calendar class="h-3.5 w-3.5" />
									{session.date}
								</span>
							</div>
						</div>

						<div class="flex flex-wrap items-center gap-2 sm:gap-3">
							<!-- 5-Group Completion Badge -->
							<span
								class="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold {progress.isAllCompleted
									? 'border border-green-200 bg-green-100 text-green-800'
									: 'border border-amber-200 bg-amber-100 text-amber-800'}"
							>
								{#if progress.isAllCompleted}
									<CheckCircle2 class="h-3.5 w-3.5 text-green-600" />
								{:else}
									<Clock class="h-3.5 w-3.5 text-amber-600" />
								{/if}
								{progress.summaryText}
							</span>

							<!-- Status Badge -->
							{#if session.status === 'completed'}
								<span
									class="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700"
								>
									เสร็จสิ้นแล้ว
								</span>
							{:else if session.status === 'cancelled'}
								<span
									class="rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-medium text-rose-700"
								>
									ยกเลิก
								</span>
							{:else}
								<span
									class="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800"
								>
									กำลังดำเนินการ
								</span>
							{/if}

							<div class="hidden shrink-0 text-xs font-semibold text-muted-foreground sm:block">
								{isExpanded ? 'คลิกเพื่อยุบ' : 'คลิกเพื่อเปิดดู'}
							</div>
						</div>
					</button>

					{#if isExpanded}
						{@const currentTab = getActiveTab(session._id)}
						<div class="space-y-4 p-4 sm:p-5">
							<!-- 5-Group Target vs Actual Cards -->
							<div>
								<div class="mb-2 flex items-center justify-between">
									<span class="text-xs font-semibold text-muted-foreground">
										เป้าหมาย 5 กลุ่มความต้องการ (รวม {session.target_headcount.total} จาน)
									</span>
								</div>

								<div class="grid grid-cols-2 gap-2 sm:grid-cols-5">
									{#each groupKeys as groupKey (groupKey)}
										{@const item = progress.groups[groupKey]}
										<div
											class="flex flex-col justify-between rounded-lg border p-2.5 transition-colors {item.isCompleted
												? 'border-green-300 bg-green-50/50'
												: 'border-muted bg-background'}"
										>
											<div class="flex items-center justify-between text-xs">
												<span class="font-medium text-muted-foreground">
													{TARGET_GROUP_LABELS[groupKey]}
												</span>
												{#if item.isCompleted}
													<CheckCircle2 class="h-3.5 w-3.5 text-green-600" />
												{:else}
													<span class="h-1.5 w-1.5 rounded-full bg-amber-400"></span>
												{/if}
											</div>
											<div class="mt-2 flex items-baseline justify-between">
												<span
													class="text-lg font-bold {item.isCompleted
														? 'text-green-700'
														: 'text-foreground'}"
												>
													{item.actualYield}
												</span>
												<span class="text-xs text-muted-foreground">
													/ {item.target} จาน
												</span>
											</div>
										</div>
									{/each}
								</div>
							</div>

							<!-- Session Tabs: Plans & Batches vs Service Summary -->
							<div class="rounded-lg border bg-muted/10">
								<!-- Tab Header Pill Switches -->
								<div
									class="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/30 px-3 py-2"
								>
									<div class="flex items-center gap-1.5">
										<button
											type="button"
											class="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors {currentTab ===
											'plans'
												? 'bg-background text-foreground shadow-sm'
												: 'text-muted-foreground hover:bg-muted/60'}"
											onclick={() => setActiveTab(session._id, 'plans')}
										>
											<Utensils class="h-3.5 w-3.5" />
											ชุดการผลิต & แผนอาหาร ({sessionPlans.length})
										</button>
										<button
											type="button"
											class="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors {currentTab ===
											'services'
												? 'bg-background text-foreground shadow-sm'
												: 'text-muted-foreground hover:bg-muted/60'}"
											onclick={() => setActiveTab(session._id, 'services')}
										>
											<ClipboardCheck class="h-3.5 w-3.5" />
											สรุปบริการของมื้อนี้ ({sessionServices.length})
										</button>
									</div>

									{#if currentTab === 'plans'}
										<a
											href={resolve(`/back-office/kitchen/production-board/${session._id}`)}
											class="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
										>
											<Plus class="h-3.5 w-3.5" /> เพิ่มเมนูผลิต (Stage A/B/C)
										</a>
									{/if}
								</div>

								{#if currentTab === 'plans'}
									<!-- TAB 1: Batches / Plans List -->
									<div class="p-3">
										{#if sessionPlans.length === 0}
											<p class="py-4 text-center text-xs text-muted-foreground">
												ยังไม่มีเมนูผลิตในมื้อนี้ กด "+ เพิ่มเมนูผลิต" เพื่อตั้งค่า BOM
												และขอเบิกวัตถุดิบ
											</p>
										{:else}
											<div class="divide-y divide-border">
												{#each sessionPlans as plan (plan._id)}
													{@const planReq = (requisitions.data ?? []).find(
														(r) => r.meal_plan_id === plan._id
													)}
													{@const planSvc = sessionServices.find(
														(s) => s.meal_plan_id === plan._id
													)}

													<div
														class="flex flex-wrap items-center justify-between gap-3 py-2.5 text-xs"
													>
														<div class="flex flex-wrap items-center gap-2">
															<span class="font-bold text-foreground">
																{plan.label ?? 'เมนูมาตรฐาน'}
															</span>

															<!-- Target group chips -->
															{#if plan.target_tags && plan.target_tags.length > 0}
																<div class="flex flex-wrap gap-1">
																	{#each plan.target_tags as tag (tag)}
																		<span
																			class="rounded bg-secondary px-1.5 py-0.5 text-2xs font-medium text-secondary-foreground"
																		>
																			{TARGET_GROUP_LABELS[tag as TargetGroupTag] ?? tag}
																		</span>
																	{/each}
																</div>
															{/if}

															<span class="text-muted-foreground">
																(เป้า {plan.allocated_target ?? plan.headcount.total} จาน)
															</span>
														</div>

														<!-- Requisition Ticket, Service Badges & Actions -->
														<div class="flex flex-wrap items-center gap-2">
															{#if planReq}
																<span
																	class="inline-flex items-center gap-1 rounded px-2 py-0.5 font-mono text-2xs font-bold {planReq.status ===
																	'approved'
																		? 'bg-green-100 text-green-800'
																		: planReq.status === 'rejected'
																			? 'bg-rose-100 text-rose-800'
																			: 'bg-amber-100 text-amber-800'}"
																	title="ตั๋วเบิกวัตถุดิบ"
																>
																	{#if planReq.status === 'approved'}
																		<Check class="h-3 w-3" />
																	{:else if planReq.status === 'rejected'}
																		<XCircle class="h-3 w-3" />
																	{:else}
																		<Clock class="h-3 w-3" />
																	{/if}
																	{planReq.ticket_no}
																</span>
															{/if}

															{#if planSvc}
																<span
																	class="rounded bg-emerald-50 px-2 py-0.5 text-2xs font-bold text-emerald-700"
																>
																	✓ ปรุงจริง {planSvc.actual_yield ?? 0} จาน (แจก {planSvc.served})
																</span>
															{:else}
																<span
																	class="rounded bg-slate-100 px-2 py-0.5 text-2xs text-slate-600"
																>
																	ยังไม่บันทึกผลผลิต
																</span>
															{/if}

															<!-- Action Buttons -->
															{#if !planSvc && planReq?.status === 'approved'}
																<a
																	href={resolve(
																		`/back-office/kitchen/production-board/${session._id}?plan_id=${plan._id}&stage=C`
																	)}
																	class="inline-flex items-center gap-1 rounded bg-green-600 px-2.5 py-1 text-2xs font-semibold text-white shadow-sm transition-colors hover:bg-green-700"
																	title="บันทึกผลผลิตใน Stage 3"
																>
																	<CheckCircle2 class="h-3 w-3" />
																	บันทึกผลผลิต (Stage 3)
																</a>
															{/if}

															<a
																href={resolve(
																	`/back-office/kitchen/production-board/${session._id}?plan_id=${plan._id}`
																)}
																class="inline-flex items-center gap-1 rounded border bg-background px-2 py-1 text-2xs font-medium text-foreground transition-colors hover:bg-muted"
																title="แก้ไขชุดการผลิตนี้"
															>
																<Pencil class="h-3 w-3" />
																แก้ไข
															</a>

															<a
																href={resolve(
																	`/back-office/kitchen/production-board/${session._id}?plan_id=${plan._id}`
																)}
																class="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
																title="เปิดกระดานการผลิตของชุดนี้"
															>
																<ChevronRight class="h-4 w-4" />
															</a>
														</div>
													</div>
												{/each}
											</div>
										{/if}
									</div>
								{:else}
									<!-- TAB 2: Service Summary of this session -->
									<div class="p-3">
										{#if sessionServices.length === 0}
											<div class="py-6 text-center text-xs text-muted-foreground">
												<ClipboardCheck class="mx-auto mb-2 h-7 w-7 text-muted-foreground/40" />
												<p class="font-medium text-foreground">
													ยังไม่มีการบันทึกผลบริการในมื้อนี้
												</p>
												<p class="mt-1 text-2xs">
													เมื่อคลังอนุมัติวัตถุดิบและปรุงอาหารเสร็จสิ้น สามารถกดปุ่ม "บันทึกผลผลิต
													(Stage 3)" เพื่อบันทึกยอดแจกจ่ายจริงได้
												</p>
											</div>
										{:else}
											<div class="overflow-x-auto rounded-md border bg-background">
												<Table.Root>
													<Table.Header>
														<Table.Row class="bg-muted/30 text-2xs">
															<Table.Head class="px-4 py-2 font-semibold">แผนต้นทาง</Table.Head>
															<Table.Head class="px-3 py-2 text-right font-semibold"
																>วางแผน</Table.Head
															>
															<Table.Head class="px-3 py-2 text-right font-semibold"
																>ทำได้จริง</Table.Head
															>
															<Table.Head class="px-3 py-2 text-right font-semibold"
																>เสิร์ฟในศูนย์</Table.Head
															>
															<Table.Head class="px-3 py-2 text-right font-semibold"
																>เสิร์ฟภายนอก</Table.Head
															>
															<Table.Head class="px-3 py-2 text-right font-semibold"
																>เหลือทิ้ง</Table.Head
															>
															<Table.Head class="px-3 py-2 font-semibold">สถานะ</Table.Head>
															<Table.Head class="px-4 py-2 font-semibold"
																>ผู้บันทึก / เวลา</Table.Head
															>
														</Table.Row>
													</Table.Header>
													<Table.Body class="text-xs">
														{#each sessionServices as svc (svc._id)}
															{@const plan =
																sessionPlans.find((p) => p._id === svc.meal_plan_id) ?? null}
															{@const v = computeMealVariance(svc, plan)}
															<Table.Row>
																<Table.Cell class="px-4 py-2 font-medium">
																	{plan?.label ?? 'เมนูอาหาร'}
																</Table.Cell>
																<Table.Cell class="px-3 py-2 text-right font-mono">
																	{v.planned !== null ? `${v.planned} จาน` : '—'}
																</Table.Cell>
																<Table.Cell
																	class="px-3 py-2 text-right font-mono font-bold text-foreground"
																>
																	{v.actual_yield} จาน
																</Table.Cell>
																<Table.Cell class="px-3 py-2 text-right font-mono text-emerald-700">
																	{v.served}
																</Table.Cell>
																<Table.Cell
																	class="px-3 py-2 text-right font-mono text-muted-foreground"
																>
																	{v.external}
																</Table.Cell>
																<Table.Cell class="px-3 py-2 text-right font-mono text-amber-700">
																	{v.waste}
																</Table.Cell>
																<Table.Cell class="px-3 py-2">
																	<span
																		class="inline-flex rounded-full border px-2 py-0.5 text-2xs font-semibold {STATUS_CLASS[
																			v.status
																		]}"
																	>
																		{MEAL_VARIANCE_STATUS_LABELS[v.status]}
																	</span>
																</Table.Cell>
																<Table.Cell class="px-4 py-2 text-2xs text-muted-foreground">
																	<div>{svc.created_by}</div>
																	<div>{formatThaiDateTime(svc.created_at)}</div>
																</Table.Cell>
															</Table.Row>
														{/each}
													</Table.Body>
												</Table.Root>
											</div>
										{/if}
									</div>
								{/if}
							</div>

							<!-- Card Footer Actions -->
							<div class="flex flex-wrap items-center justify-between gap-2 pt-1">
								<div class="flex items-center gap-2">
									{#if session.status === 'active'}
										<Button
											variant="outline"
											size="sm"
											class="h-8 gap-1 text-xs text-green-700 hover:bg-green-50"
											onclick={() => handleCompleteSession(session)}
										>
											<Check class="h-3.5 w-3.5" />
											บันทึกปิดรอบมื้อ
										</Button>
									{/if}
									<Button
										variant="ghost"
										size="sm"
										class="h-8 gap-1 text-xs text-destructive hover:bg-destructive/10"
										onclick={() => handleDeleteSession(session)}
									>
										<Trash2 class="h-3.5 w-3.5" />
										ลบ
									</Button>
								</div>

								<a
									href={resolve(`/back-office/kitchen/production-board/${session._id}`)}
									class="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
								>
									<ChefHat class="h-3.5 w-3.5" />
									เข้าสู่บอร์ดการผลิต (Production Board)
								</a>
							</div>
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>

<!-- Create Meal Session Modal -->
<Dialog.Root bind:open={createDialogOpen}>
	<Dialog.Content class="sm:max-w-xl">
		<Dialog.Header>
			<Dialog.Title class="text-base font-bold text-foreground sm:text-lg"
				>สร้างรอบมื้ออาหารใหม่ (New Meal Session)</Dialog.Title
			>
			<Dialog.Description class="text-xs text-muted-foreground sm:text-sm">
				ระบุช่วงเวลาและเป้าหมายจำนวนจานสำหรับกลุ่มความต้องการพิเศษ 5 กลุ่ม
			</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-4 py-2">
			<div>
				<Label for="session-name" class="text-xs font-medium">ชื่อรอบมื้ออาหาร</Label>
				<Input id="session-name" bind:value={formName} class="mt-1.5 h-9 text-sm" />
			</div>

			<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
				<div>
					<Label for="session-date" class="text-xs font-medium">วันที่</Label>
					<Input id="session-date" type="date" bind:value={formDate} class="mt-1.5 h-9 text-sm" />
				</div>
				<div>
					<Label for="session-meal" class="text-xs font-medium">ช่วงมื้อ</Label>
					<select
						id="session-meal"
						value={formMeal}
						onchange={handleMealChange}
						class="mt-1.5 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
					>
						<option value="breakfast">มื้อเช้า (Breakfast)</option>
						<option value="lunch">มื้อกลางวัน (Lunch)</option>
						<option value="dinner">มื้อเย็น (Dinner)</option>
						<option value="snack">ของว่าง (Snack)</option>
					</select>
				</div>
			</div>

			<!-- 5-Group Target Headcount Inputs -->
			<div class="rounded-xl border bg-muted/20 p-3.5 sm:p-4">
				<div class="mb-3 flex items-center justify-between">
					<div>
						<span class="text-xs font-semibold text-foreground"
							>เป้าหมายจำนวนจานแยกกลุ่ม (5 กลุ่ม)</span
						>
						<p class="text-2xs text-muted-foreground">จัดสรรตามกลุ่มผู้อพยพและกำลังพลปฏิบัติงาน</p>
					</div>
					<span class="rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
						รวม {formTotal} จาน
					</span>
				</div>

				<div class="space-y-2.5">
					<!-- Standard & Staff Groups -->
					<div class="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
						<div class="rounded-lg border bg-background p-2.5 shadow-2xs">
							<Label class="text-xs font-medium text-foreground">อาหารทั่วไป (Regular)</Label>
							<Input type="number" min="0" bind:value={countRegular} class="mt-1.5 h-8 text-sm" />
						</div>
						<div class="rounded-lg border bg-background p-2.5 shadow-2xs">
							<Label class="text-xs font-medium text-foreground">เจ้าหน้าที่/อาสา (Volunteer)</Label
							>
							<Input type="number" min="0" bind:value={countVolunteer} class="mt-1.5 h-8 text-sm" />
						</div>
					</div>

					<!-- Dietary / Vulnerable Groups -->
					<div class="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
						<div class="rounded-lg border bg-background p-2.5 shadow-2xs">
							<Label class="text-xs font-medium text-foreground">อาหารฮาลาล (Halal)</Label>
							<Input type="number" min="0" bind:value={countHalal} class="mt-1.5 h-8 text-sm" />
						</div>
						<div class="rounded-lg border bg-background p-2.5 shadow-2xs">
							<Label class="text-xs font-medium text-foreground">อาหารอ่อน/ผู้สูงอายุ (Soft)</Label>
							<Input type="number" min="0" bind:value={countSoftFood} class="mt-1.5 h-8 text-sm" />
						</div>
						<div class="rounded-lg border bg-background p-2.5 shadow-2xs">
							<Label class="text-xs font-medium text-foreground">ทารก/เด็กอ่อน (Infant)</Label>
							<Input type="number" min="0" bind:value={countInfant} class="mt-1.5 h-8 text-sm" />
						</div>
					</div>
				</div>
			</div>

			<div>
				<Label for="session-notes" class="text-xs font-medium">หมายเหตุเพิ่มเติม</Label>
				<Textarea
					id="session-notes"
					bind:value={formNotes}
					placeholder="เช่น วัตถุดิบบริจาคพิเศษ, มื้อพิเศษ..."
					rows={2}
					class="mt-1.5 text-xs sm:text-sm"
				/>
			</div>
		</div>

		<Dialog.Footer class="mt-2 gap-2 sm:gap-2">
			<Button variant="outline" onclick={() => (createDialogOpen = false)}>ยกเลิก</Button>
			<Button onclick={handleCreateSession} disabled={createSessionMutation.isPending}>
				{createSessionMutation.isPending ? 'กำลังสร้าง...' : 'สร้างรอบมื้ออาหาร'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
