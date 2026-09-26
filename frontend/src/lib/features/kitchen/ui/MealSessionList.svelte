<script lang="ts">
	import {
		useMealSessions,
		useMealPlans,
		useMealServices,
		useMealServiceReceipts,
		useKitchenRequisitions,
		useActiveEvacueeDietCounts,
		useCreateMealSession,
		useDeleteMealSession,
		computeSessionGroupProgress,
		computeMealVariance,
		mealServiceReceiptOutcome,
		MEAL_VARIANCE_STATUS_LABELS,
		TARGET_GROUP_LABELS,
		type MealSession,
		type MealPlan,
		type MealPeriod,
		type MealSessionStatus,
		type TargetGroupTag,
		type MealVarianceStatus
	} from '$lib/features/kitchen';
	import {
		useTickets,
		TICKET_STATUS_LABELS,
		type TicketStatus,
		type RequisitionTicket
	} from '$lib/features/tickets';
	import { authStore } from '$lib/stores/auth.svelte';
	import { formatThaiShortDate } from '$lib/utils/date';
	import { getShelterCode } from '$lib/db/shelter';
	import { formatThaiDateTime } from '$lib/utils/date';
	import { resolve } from '$app/paths';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import * as Accordion from '$lib/components/ui/accordion';
	import * as Card from '$lib/components/ui/card';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Table from '$lib/components/ui/table';
	import * as Select from '$lib/components/ui/select';
	import * as Tabs from '$lib/components/ui/tabs';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import { toast } from 'svelte-sonner';
	import Plus from '@lucide/svelte/icons/plus';
	import Search from '@lucide/svelte/icons/search';
	import ChefHat from '@lucide/svelte/icons/chef-hat';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import Clock from '@lucide/svelte/icons/clock';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import XCircle from '@lucide/svelte/icons/x-circle';
	import Calendar from '@lucide/svelte/icons/calendar';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Check from '@lucide/svelte/icons/check';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Utensils from '@lucide/svelte/icons/utensils';
	import ClipboardCheck from '@lucide/svelte/icons/clipboard-check';

	const sessions = useMealSessions();
	const plans = useMealPlans();
	const services = useMealServices();
	const serviceReceipts = useMealServiceReceipts();
	const requisitions = useKitchenRequisitions();
	const dietCounts = useActiveEvacueeDietCounts();
	const tickets = useTickets();

	// Per meal_plan_id: the most relevant requisition_ticket (CR-139 write path — the legacy
	// kitchen_requisition above is frozen/read-only, so plans created after cutover only ever
	// get a ticket, never a new kitchen_requisition row).
	const ticketByPlanId = $derived.by(() => {
		const sorted = [...(tickets.data ?? [])].sort((a, b) =>
			b.created_at.localeCompare(a.created_at)
		);
		const map: Record<string, (typeof sorted)[number]> = {};
		for (const t of sorted) {
			const existing = map[t.meal_plan_id];
			if (!existing || existing.status === 'CANCELLED') {
				map[t.meal_plan_id] = t;
			}
		}
		return map;
	});

	// A session is effectively complete once every one of its plans has a
	// completed ticket AND a warehouse-confirmed delivery receipt — the same
	// check the per-plan badge uses. Drives both the status badge and the
	// status filter so the two never disagree (a session shown under
	// "เสร็จสิ้นแล้ว" must also be filterable by it, and vice versa).
	function isSessionEffectivelyComplete(session: MealSession): boolean {
		const sessionPlans = (plans.data ?? []).filter((p) => p.meal_session_id === session._id);
		if (sessionPlans.length === 0) return false;
		return sessionPlans.every((p) => {
			const ticket = ticketByPlanId[p._id];
			if (!ticket || ticket.status !== 'COMPLETED') return false;
			const svc = (services.data ?? []).find((s) => s.meal_plan_id === p._id);
			if (!svc) return false;
			const receipt = (serviceReceipts.data ?? []).find((r) => r.meal_service_id === svc._id);
			return receipt ? mealServiceReceiptOutcome(receipt) === 'confirmed' : false;
		});
	}

	function effectiveSessionStatus(session: MealSession): MealSessionStatus {
		if (session.status === 'completed' || session.status === 'cancelled') return session.status;
		return isSessionEffectivelyComplete(session) ? 'completed' : session.status;
	}

	const TICKET_STATUS_CLASS: Record<TicketStatus, string> = {
		PENDING_PICK: 'bg-amber-100 text-amber-800',
		READY_FOR_DISPATCH: 'bg-blue-100 text-blue-800',
		IN_TRANSIT: 'bg-indigo-100 text-indigo-800',
		COMPLETED: 'bg-green-100 text-green-800',
		CANCELLED: 'bg-muted text-muted-foreground'
	};

	// This card's own wording for the ticket badge — kept local, not a rename of
	// the shared TICKET_STATUS_LABELS constant used elsewhere (tickets feature).
	const PRODUCTION_CARD_TICKET_LABEL: Partial<Record<TicketStatus, string>> = {
		PENDING_PICK: 'รอคลังอนุมัติ'
	};

	// Once the ticket is COMPLETED (materials received), split the single
	// "เสร็จสิ้น" badge into the 3 cooking sub-phases Stage C actually tracks —
	// each with its own color, same palette as the Stage C header badge.
	function productionCardStatus(
		ticket: RequisitionTicket,
		plan: MealPlan,
		hasService: boolean,
		receiptConfirmed: boolean
	): { label: string; className: string } {
		if (ticket.status !== 'COMPLETED') {
			return {
				label: PRODUCTION_CARD_TICKET_LABEL[ticket.status] ?? TICKET_STATUS_LABELS[ticket.status],
				className: TICKET_STATUS_CLASS[ticket.status]
			};
		}
		if (hasService) {
			if (receiptConfirmed) {
				return { label: 'ส่งมอบเสร็จสิ้น', className: 'bg-emerald-100 text-emerald-800' };
			}
			return { label: 'รอคลังตรวจรับเข้าสต็อก', className: 'bg-amber-100 text-amber-800' };
		}
		if (plan.cooking_started_at) {
			return { label: 'กำลังปรุงอาหาร', className: 'bg-orange-100 text-orange-800' };
		}
		return { label: 'วัตถุดิบพร้อมปรุง', className: 'bg-sky-100 text-sky-800' };
	}

	// "จัดการ / สูตร" jumps to whichever wizard stage this batch last reached.
	function latestStageFor(
		ticket: RequisitionTicket | undefined,
		hasService: boolean
	): 'A' | 'B' | 'C' {
		if (hasService) return 'C';
		if (!ticket) return 'A';
		if (ticket.status === 'IN_TRANSIT' || ticket.status === 'COMPLETED') return 'C';
		return 'B';
	}

	const createSessionMutation = useCreateMealSession();
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

	function handleMealChange(value: string) {
		formMeal = value as MealPeriod;
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

	let pendingDeleteSession = $state<MealSession | null>(null);

	function askDeleteSession(session: MealSession) {
		pendingDeleteSession = session;
	}

	async function confirmDeleteSession() {
		if (!pendingDeleteSession) return;
		const session = pendingDeleteSession;
		try {
			await deleteSessionMutation.mutateAsync(session);
			toast.success('ลบรอบมื้ออาหารแล้ว');
		} catch (err) {
			const msg = err instanceof Error ? err.message : 'ไม่สามารถลบได้';
			toast.error(msg);
		}
		pendingDeleteSession = null;
	}

	const sortedSessions = $derived.by(() => {
		const list = [...(sessions.data ?? [])];
		return list.sort(
			(a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at)
		);
	});

	// Client-side search/status/date-range filter row (matches the AI Studio prototype's
	// Meal Sessions filter bar) — no new field/query needed.
	let search = $state('');
	let statusFilter = $state<'ALL' | MealSessionStatus>('ALL');
	type DateRangePreset = 'ALL' | 'today' | 'last7' | 'last30';
	let dateRange = $state<DateRangePreset>('ALL');

	const STATUS_FILTER_LABELS: Record<'ALL' | MealSessionStatus, string> = {
		ALL: 'สถานะ: ทั้งหมด',
		active: 'กำลังดำเนินการ',
		completed: 'เสร็จสิ้นแล้ว',
		cancelled: 'ยกเลิก'
	};
	const DATE_RANGE_LABELS: Record<DateRangePreset, string> = {
		ALL: 'ช่วงวันที่: ทั้งหมด',
		today: 'วันนี้',
		last7: '7 วันล่าสุด',
		last30: '30 วันล่าสุด'
	};

	function isWithinDateRange(date: string, preset: DateRangePreset): boolean {
		if (preset === 'ALL') return true;
		const todayMs = Date.now();
		const today = new Date(todayMs).toISOString().slice(0, 10);
		if (preset === 'today') return date === today;
		const days = preset === 'last7' ? 7 : 30;
		const from = new Date(todayMs - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
		return date >= from && date <= today;
	}

	const filteredSessions = $derived.by(() => {
		const q = search.trim().toLowerCase();
		return sortedSessions.filter((s) => {
			if (statusFilter !== 'ALL' && effectiveSessionStatus(s) !== statusFilter) return false;
			if (!isWithinDateRange(s.date, dateRange)) return false;
			if (!q) return true;
			return s.name.toLowerCase().includes(q) || s.date.includes(q);
		});
	});

	const groupKeys: TargetGroupTag[] = ['halal', 'infant', 'soft_food', 'regular', 'volunteer'];

	let expandedSessionIds = $state<string[]>([]);
	let initializedSessions = $state(false);

	$effect(() => {
		if (!initializedSessions && sortedSessions.length > 0) {
			expandedSessionIds = sortedSessions.map((s) => s._id);
			initializedSessions = true;
		}
	});

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

<div class="min-h-full bg-[#F8FAFC]">
	<div class="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
		<!-- Top Bar -->
		<div class="border-b border-slate-200/80 pb-6">
			<div class="flex flex-wrap items-start justify-between gap-3">
				<div>
					<h1 class="text-3xl font-extrabold tracking-tight text-[#0A2647] sm:text-4xl">
						หน้าสรุปมื้อ
					</h1>
					<p class="mt-2 text-base leading-relaxed text-slate-600">
						บริหารจัดการเป้าหมายและสั่งผลิตเมนูแต่ละมื้อ (เชื่อมต่อทะเบียนผู้พักพิง)
					</p>
				</div>
				<div class="flex flex-wrap items-center gap-2 pt-1">
					<Button
						variant="outline"
						href={resolve('/back-office/catalog') + '?tab=recipe'}
						class="min-h-11 gap-1.5"
					>
						<Calendar class="h-3.5 w-3.5" />
						ฐานสูตร BOM
					</Button>
					<Button onclick={openCreateDialog} class="min-h-11 gap-1.5">
						<Plus class="h-4 w-4" />
						สร้างมื้อใหม่
					</Button>
				</div>
			</div>
		</div>

		<!-- Filter row (search + status + date range) — matches the AI Studio prototype's
	     Meal Sessions filter bar; client-side only, no new field/query. -->
		<div
			class="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200/80 bg-white p-3 shadow-2xs"
		>
			<div class="relative min-w-0 flex-1">
				<Search
					class="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400"
				/>
				<Input
					bind:value={search}
					placeholder="ค้นหาชื่อมื้อ หรือวันที่..."
					class="min-h-11 pl-9"
				/>
			</div>
			<Select.Root type="single" bind:value={statusFilter}>
				<Select.Trigger class="min-h-11 w-full sm:w-52"
					><Select.Value placeholder="สถานะ: ทั้งหมด"
						>{STATUS_FILTER_LABELS[statusFilter]}</Select.Value
					></Select.Trigger
				>
				<Select.Content>
					<Select.Item value="ALL" label="สถานะ: ทั้งหมด">สถานะ: ทั้งหมด</Select.Item>
					<Select.Item value="active" label="กำลังดำเนินการ">กำลังดำเนินการ</Select.Item>
					<Select.Item value="completed" label="เสร็จสิ้นแล้ว">เสร็จสิ้นแล้ว</Select.Item>
					<Select.Item value="cancelled" label="ยกเลิก">ยกเลิก</Select.Item>
				</Select.Content>
			</Select.Root>
			<Select.Root type="single" bind:value={dateRange}>
				<Select.Trigger class="min-h-11 w-full sm:w-52"
					><Select.Value placeholder="ช่วงวันที่: ทั้งหมด"
						>{DATE_RANGE_LABELS[dateRange]}</Select.Value
					></Select.Trigger
				>
				<Select.Content>
					<Select.Item value="ALL" label="ช่วงวันที่: ทั้งหมด">ช่วงวันที่: ทั้งหมด</Select.Item>
					<Select.Item value="today" label="วันนี้">วันนี้</Select.Item>
					<Select.Item value="last7" label="7 วันล่าสุด">7 วันล่าสุด</Select.Item>
					<Select.Item value="last30" label="30 วันล่าสุด">30 วันล่าสุด</Select.Item>
				</Select.Content>
			</Select.Root>
			{#if search || statusFilter !== 'ALL' || dateRange !== 'ALL'}
				<Button
					variant="ghost"
					size="sm"
					onclick={() => {
						search = '';
						statusFilter = 'ALL';
						dateRange = 'ALL';
					}}
				>
					ล้างตัวกรอง
				</Button>
			{/if}
		</div>

		<!-- Sessions List -->
		{#if sessions.isLoading}
			<div class="flex items-center justify-center p-12 text-muted-foreground">
				<Clock class="mr-2 h-5 w-5 animate-spin" /> กำลังโหลดรอบมื้ออาหาร...
			</div>
		{:else if filteredSessions.length === 0}
			<Card.Root class="border-dashed py-12 text-center">
				<Card.Content class="flex flex-col items-center justify-center">
					<ChefHat class="h-12 w-12 text-muted-foreground/50" />
					<h4 class="mt-4 text-base font-semibold">
						{sortedSessions.length === 0 ? 'ยังไม่มีรอบมื้ออาหาร' : 'ไม่พบรอบมื้อที่ตรงกับเงื่อนไข'}
					</h4>
					{#if sortedSessions.length === 0}
						<p class="mt-1 max-w-sm text-xs text-muted-foreground">
							เริ่มต้นวางแผนอาหารและคำนวณสูตรโดยการสร้างรอบมื้ออาหารใหม่
						</p>
						<Button onclick={openCreateDialog} variant="outline" class="mt-4 gap-1.5">
							<Plus class="h-4 w-4" /> สร้างรอบมื้อแรก
						</Button>
					{/if}
				</Card.Content>
			</Card.Root>
		{:else}
			<Accordion.Root type="multiple" bind:value={expandedSessionIds} class="space-y-4">
				{#each filteredSessions as session (session._id)}
					{@const sessionPlans = (plans.data ?? []).filter(
						(p) => p.meal_session_id === session._id
					)}
					{@const sessionServices = (services.data ?? []).filter(
						(s) => s.meal_session_id === session._id
					)}
					{@const effStatus = effectiveSessionStatus(session)}
					{@const progress = computeSessionGroupProgress(session, sessionPlans, sessionServices)}
					{@const isExpanded = expandedSessionIds.includes(session._id)}

					<Accordion.Item
						value={session._id}
						class="overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm transition-all duration-200 hover:border-primary/40"
					>
						<!-- Card Header (Accordion Trigger) -->
						<div class="flex items-stretch">
							<Accordion.Trigger
								class="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-2.5 rounded-none bg-muted/30 px-3.5 py-2.5 text-left hover:bg-muted/60 hover:no-underline **:data-[slot=accordion-trigger-icon]:hidden sm:px-5 sm:py-3 {isExpanded
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
											{formatThaiShortDate(session.date)}
										</span>
									</div>
								</div>

								<div class="flex flex-wrap items-center gap-2 sm:gap-3">
									<span class="text-xs font-semibold text-muted-foreground">
										เป้าหมายรวม: {session.target_headcount.total} คน
									</span>

									<!-- Group Completion Badge -->
									<span
										class="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold {progress.isAllCompleted
											? 'bg-green-100 text-green-800'
											: 'bg-amber-100 text-amber-800'}"
									>
										{#if !progress.isAllCompleted}
											<AlertTriangle class="h-3.5 w-3.5" />
										{/if}
										{progress.summaryText}ครบ
									</span>

									<!-- Status Badge -->
									{#if effStatus === 'completed'}
										<span
											class="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700"
										>
											เสร็จสิ้นแล้ว
										</span>
									{:else if effStatus === 'cancelled'}
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
								</div>
							</Accordion.Trigger>
							<Button
								variant="ghost"
								size="icon"
								class="m-1 h-9 w-9 shrink-0 self-center text-muted-foreground hover:bg-rose-50 hover:text-rose-700"
								onclick={(event) => {
									event.stopPropagation();
									askDeleteSession(session);
								}}
								aria-label={`ลบ${session.name}`}
								title="ลบรอบมื้ออาหาร"
							>
								<Trash2 class="h-4 w-4" />
							</Button>
						</div>

						<Accordion.Content>
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

										<div class="overflow-hidden rounded-lg border">
											<Table.Root>
												<Table.Header>
													<Table.Row class="bg-muted/30 text-2xs">
														<Table.Head class="px-4 py-2 font-semibold">กลุ่มเป้าหมาย</Table.Head>
														<Table.Head class="px-3 py-2 text-right font-semibold">
															จำนวนเป้าหมาย (คน)
														</Table.Head>
														<Table.Head class="px-3 py-2 text-right font-semibold">
															ทำแล้ว (จาน)
														</Table.Head>
														<Table.Head class="px-3 py-2 text-center font-semibold"
															>สถานะ</Table.Head
														>
													</Table.Row>
												</Table.Header>
												<Table.Body>
													{#each groupKeys as groupKey (groupKey)}
														{@const item = progress.groups[groupKey]}
														<Table.Row class="text-xs">
															<Table.Cell class="px-4 py-2 font-semibold">
																{TARGET_GROUP_LABELS[groupKey]}
															</Table.Cell>
															<Table.Cell class="px-3 py-2 text-right">{item.target}</Table.Cell>
															<Table.Cell class="px-3 py-2 text-right font-semibold">
																{item.actualYield}
															</Table.Cell>
															<Table.Cell class="px-3 py-2 text-center">
																<span
																	class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-bold {item.isCompleted
																		? 'bg-green-100 text-green-800'
																		: 'bg-amber-100 text-amber-800'}"
																>
																	{#if item.isCompleted}
																		<CheckCircle2 class="h-3 w-3" />
																		ครบแล้ว
																	{:else}
																		<Clock class="h-3 w-3" />
																		ยังไม่ครบ
																	{/if}
																</span>
															</Table.Cell>
														</Table.Row>
													{/each}
												</Table.Body>
											</Table.Root>
										</div>
									</div>

									<!-- Session Tabs: Plans & Batches vs Service Summary -->
									<div class="rounded-lg border bg-muted/10">
										<!-- Tab Header Pill Switches -->
										<Tabs.Root
											value={currentTab}
											onValueChange={(v) => setActiveTab(session._id, v as 'plans' | 'services')}
											class="gap-0 border-b bg-muted/30"
										>
											<div class="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
												<Tabs.List class="h-auto gap-1.5 bg-transparent p-0">
													<Tabs.Trigger
														value="plans"
														class="gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold text-muted-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"
													>
														<Utensils class="h-3.5 w-3.5" />
														ชุดการผลิต & แผนอาหาร ({sessionPlans.length})
													</Tabs.Trigger>
													<Tabs.Trigger
														value="services"
														class="gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold text-muted-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"
													>
														<ClipboardCheck class="h-3.5 w-3.5" />
														สรุปบริการของมื้อนี้ ({sessionServices.length})
													</Tabs.Trigger>
												</Tabs.List>

												{#if currentTab === 'plans'}
													<a
														href={resolve(`/back-office/kitchen/production-board/${session._id}`)}
														class="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
													>
														<Plus class="h-3.5 w-3.5" /> เพิ่มเมนูผลิต
													</a>
												{/if}
											</div>
										</Tabs.Root>

										{#if currentTab === 'plans'}
											<!-- TAB 1: Batches / Plans List -->
											<div class="p-3">
												{#if sessionPlans.length === 0}
													<p class="py-4 text-center text-xs text-muted-foreground">
														ยังไม่มีเมนูผลิตในมื้อนี้ กด "+ เพิ่มเมนูผลิต" เพื่อตั้งค่า BOM
														และขอเบิกวัตถุดิบ
													</p>
												{:else}
													<div class="space-y-2">
														{#each sessionPlans as plan (plan._id)}
															{@const ticket = ticketByPlanId[plan._id]}
															{@const planReq = (requisitions.data ?? []).find(
																(r) => r.meal_plan_id === plan._id
															)}
															{@const planSvc = sessionServices.find(
																(s) => s.meal_plan_id === plan._id
															)}
															{@const planReceipt = planSvc
																? (serviceReceipts.data ?? []).find(
																		(r) => r.meal_service_id === planSvc._id
																	)
																: undefined}
															{@const planReceiptConfirmed = planReceipt
																? mealServiceReceiptOutcome(planReceipt) === 'confirmed'
																: false}

															<div
																class="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2.5 text-xs"
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

																	{#if ticket}
																		<a
																			href={resolve(
																				`/back-office/tickets/${encodeURIComponent(ticket._id)}`
																			)}
																			class="font-mono text-2xs font-semibold text-primary hover:underline"
																			title="เปิดตั๋วเบิกวัตถุดิบ"
																		>
																			{ticket.ticket_no}
																		</a>
																	{/if}
																</div>

																<!-- Requisition/Ticket, Service Badges & Actions -->
																<div class="flex flex-wrap items-center gap-2">
																	{#if ticket}
																		{@const status = productionCardStatus(
																			ticket,
																			plan,
																			!!planSvc,
																			planReceiptConfirmed
																		)}
																		<span
																			class="inline-flex items-center gap-1 rounded px-2 py-0.5 font-mono text-2xs font-bold {status.className}"
																			title="ตั๋วเบิกวัตถุดิบ"
																		>
																			{status.label}
																		</span>
																	{:else if planReq}
																		<span
																			class="inline-flex items-center gap-1 rounded px-2 py-0.5 font-mono text-2xs font-bold {planReq.status ===
																			'approved'
																				? 'bg-green-100 text-green-800'
																				: planReq.status === 'rejected'
																					? 'bg-rose-100 text-rose-800'
																					: 'bg-amber-100 text-amber-800'}"
																			title="ใบเบิกวัตถุดิบ (ใบเบิกเดิม)"
																		>
																			{#if planReq.status === 'approved'}
																				<Check class="h-3 w-3" />
																				เบิกวัตถุดิบแล้ว
																			{:else if planReq.status === 'rejected'}
																				<XCircle class="h-3 w-3" />
																				ปฏิเสธคำขอ
																			{:else}
																				<Clock class="h-3 w-3" />
																				รออนุมัติวัตถุดิบ
																			{/if}
																		</span>
																	{/if}

																	<!-- Action Buttons -->
																	<Button
																		variant="outline"
																		size="sm"
																		href={resolve(
																			`/back-office/kitchen/production-board/${session._id}?plan_id=${plan._id}&stage=${latestStageFor(ticket, !!planSvc)}`
																		)}
																		title="แก้ไขชุดการผลิตนี้"
																	>
																		<Pencil class="h-3 w-3" />
																		จัดการ / สูตร
																	</Button>

																	<Button
																		variant="ghost"
																		size="icon-xs"
																		href={resolve(
																			`/back-office/kitchen/production-board/${session._id}?plan_id=${plan._id}`
																		)}
																		title="เปิดกระดานการผลิตของชุดนี้"
																	>
																		<ChevronRight class="h-4 w-4" />
																	</Button>
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
															เมื่อคลังอนุมัติวัตถุดิบและปรุงอาหารเสร็จสิ้น สามารถกดปุ่ม
															"บันทึกผลผลิต (Stage 3)" เพื่อบันทึกยอดแจกจ่ายจริงได้
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
																		<Table.Cell
																			class="px-3 py-2 text-right font-mono text-emerald-700"
																		>
																			{v.served}
																		</Table.Cell>
																		<Table.Cell
																			class="px-3 py-2 text-right font-mono text-muted-foreground"
																		>
																			{v.external}
																		</Table.Cell>
																		<Table.Cell
																			class="px-3 py-2 text-right font-mono text-amber-700"
																		>
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
								</div>
							{/if}
						</Accordion.Content>
					</Accordion.Item>
				{/each}
			</Accordion.Root>
		{/if}
	</div>
</div>

<!-- Create Meal Session Modal -->
<Dialog.Root bind:open={createDialogOpen}>
	<Dialog.Content class="sm:max-w-xl">
		<Dialog.Header>
			<Dialog.Title class="text-base font-bold text-foreground sm:text-lg"
				>สร้างรอบมื้ออาหารใหม่</Dialog.Title
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
					<Select.Root type="single" value={formMeal} onValueChange={handleMealChange}>
						<Select.Trigger id="session-meal" class="mt-1.5 min-h-11 w-full text-sm">
							<Select.Value />
						</Select.Trigger>
						<Select.Content>
							<Select.Item value="breakfast" label="มื้อเช้า">มื้อเช้า</Select.Item>
							<Select.Item value="lunch" label="มื้อกลางวัน">มื้อกลางวัน</Select.Item>
							<Select.Item value="dinner" label="มื้อเย็น">มื้อเย็น</Select.Item>
							<Select.Item value="snack" label="ของว่าง">ของว่าง</Select.Item>
						</Select.Content>
					</Select.Root>
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
							<Label class="text-xs font-medium text-foreground">อาหารทั่วไป</Label>
							<Input type="number" min="0" bind:value={countRegular} class="mt-1.5 h-8 text-sm" />
						</div>
						<div class="rounded-lg border bg-background p-2.5 shadow-2xs">
							<Label class="text-xs font-medium text-foreground">เจ้าหน้าที่/อาสา</Label>
							<Input type="number" min="0" bind:value={countVolunteer} class="mt-1.5 h-8 text-sm" />
						</div>
					</div>

					<!-- Dietary / Vulnerable Groups -->
					<div class="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
						<div class="rounded-lg border bg-background p-2.5 shadow-2xs">
							<Label class="text-xs font-medium text-foreground">อาหารฮาลาล</Label>
							<Input type="number" min="0" bind:value={countHalal} class="mt-1.5 h-8 text-sm" />
						</div>
						<div class="rounded-lg border bg-background p-2.5 shadow-2xs">
							<Label class="text-xs font-medium text-foreground">อาหารอ่อน/ผู้สูงอายุ</Label>
							<Input type="number" min="0" bind:value={countSoftFood} class="mt-1.5 h-8 text-sm" />
						</div>
						<div class="rounded-lg border bg-background p-2.5 shadow-2xs">
							<Label class="text-xs font-medium text-foreground">ทารก/เด็กอ่อน</Label>
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

<AlertDialog.Root
	open={pendingDeleteSession !== null}
	onOpenChange={(open) => !open && (pendingDeleteSession = null)}
>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>ลบรอบมื้ออาหารนี้?</AlertDialog.Title>
			<AlertDialog.Description>
				{#if pendingDeleteSession}
					คุณต้องการลบรอบมื้ออาหาร "{pendingDeleteSession.name}" หรือไม่? กู้คืนไม่ได้
				{/if}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel onclick={() => (pendingDeleteSession = null)}>ยกเลิก</AlertDialog.Cancel>
			<AlertDialog.Action
				class="bg-destructive text-white hover:bg-destructive/90"
				onclick={confirmDeleteSession}
			>
				ลบรอบมื้ออาหาร
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
