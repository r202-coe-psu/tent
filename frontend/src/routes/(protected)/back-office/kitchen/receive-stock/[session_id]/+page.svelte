<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import * as Card from '$lib/components/ui/card';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import { authStore } from '$lib/stores/auth.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import {
		useMealSession,
		useMealPlans,
		useMealServices,
		useMealServiceReceipts,
		useConfirmMealServiceYield,
		useRejectMealServiceReceipt,
		mealServiceReceiptOutcome,
		toYieldReceiptInput,
		yieldReceiptInputSchema,
		yieldTotal,
		loadYieldDraft,
		clearYieldDraft,
		YieldReceiptLines,
		MEAL_PERIOD_LABELS,
		type YieldDraftLine
	} from '$lib/features/kitchen';
	import { useStoragePoints } from '$lib/features/operations';
	import { ItemMasterForm, systemCategoryId, type ItemMaster } from '$lib/features/catalog';
	import { isShelterManager, isSystemAdmin, isWarehouseStaff } from '$lib/auth/roles';
	import { ulid } from '$lib/db/ulid';
	import { useTickets } from '$lib/features/tickets';
	import { formatThaiDate, formatThaiDateTime } from '$lib/utils/date';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import PackageCheck from '@lucide/svelte/icons/package-check';
	import XCircle from '@lucide/svelte/icons/x-circle';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import ClipboardList from '@lucide/svelte/icons/clipboard-list';

	const sessionId = $derived(page.params.session_id);
	const planId = $derived(page.url.searchParams.get('plan_id'));

	const sessionQuery = useMealSession(() => sessionId);
	const plans = useMealPlans();
	const services = useMealServices();
	const serviceReceipts = useMealServiceReceipts();
	const tickets = useTickets();

	const activePlan = $derived.by(() => {
		if (!planId) return null;
		return (plans.data ?? []).find((p) => p._id === planId) ?? null;
	});

	// Latest service for the plan (ulid order) — a plan may have more than one
	// after a reject-and-redo cycle (CR-143).
	const activeService = $derived.by(() => {
		if (!planId) return null;
		const matches = (services.data ?? []).filter((s) => s.meal_plan_id === planId);
		return matches.length > 0 ? matches[matches.length - 1] : null;
	});

	const activeServiceReceipt = $derived.by(() => {
		if (!activeService) return null;
		return (
			(serviceReceipts.data ?? []).find((r) => r.meal_service_id === activeService._id) ?? null
		);
	});
	const activeServiceOutcome = $derived(
		activeServiceReceipt ? mealServiceReceiptOutcome(activeServiceReceipt) : undefined
	);
	const serviceReceiptConfirmed = $derived(activeServiceOutcome === 'confirmed');
	const serviceRejected = $derived(activeServiceOutcome === 'rejected');

	const activeTicket = $derived.by(() => {
		if (!planId) return null;
		return (
			(tickets.data ?? []).find((t) => t.meal_plan_id === planId && t.status !== 'CANCELLED') ??
			null
		);
	});

	const isLoading = $derived(
		sessionQuery.isPending || plans.isPending || services.isPending || serviceReceipts.isPending
	);

	const confirmYieldMutation = useConfirmMealServiceYield();
	const rejectReceiptMutation = useRejectMealServiceReceipt();
	const storagePoints = useStoragePoints(() => getShelterCode());

	// Same roles the database lets write stock_ledger (kitchen_staff may look, not receive).
	const canReceiveStock = $derived.by(() => {
		const roles = authStore.user?.roles ?? [];
		const shelter = getShelterCode();
		return (
			isSystemAdmin(roles) || isShelterManager(roles, shelter) || isWarehouseStaff(roles, shelter)
		);
	});

	// Receive lines. Seeded once per meal_service: from the draft kept across the
	// "create new item" detour, else one line carrying the kitchen's whole yield.
	let lines = $state<YieldDraftLine[]>([]);
	let seededFor: string | null = null;

	function blankLine(qty = ''): YieldDraftLine {
		return { key: ulid(), item_id: '', qty, storage_point_id: '' };
	}

	$effect(() => {
		const service = activeService;
		if (!service || seededFor === service._id) return;
		seededFor = service._id;
		const draft = loadYieldDraft(service._id);
		const restored = draft ?? [blankLine(String(service.actual_yield ?? ''))];

		lines = restored;
	});

	const receivedTotal = $derived(
		yieldTotal(lines.map((l) => ({ qty: Number.isFinite(Number(l.qty)) ? l.qty || '0' : '0' })))
	);

	// "Create a new item" modal — the saved item is selected on the row that asked for it.
	let createItemOpen = $state(false);
	let createItemLineKey = $state<string | null>(null);

	function handleCreateNewItem(lineKey: string) {
		createItemLineKey = lineKey;
		createItemOpen = true;
	}

	function handleItemCreated(saved?: ItemMaster) {
		if (saved) {
			const row = lines.find((l) => l.key === createItemLineKey);
			if (row) row.item_id = saved._id;
		}
		createItemOpen = false;
		createItemLineKey = null;
	}

	let showRejectForm = $state(false);
	let rejectReason = $state('');

	function ctx() {
		return { shelterCode: getShelterCode(), createdBy: authStore.user?.name ?? 'warehouse_staff' };
	}

	async function handleConfirmServiceReceipt() {
		if (!activeService) return;
		const input = toYieldReceiptInput(lines, storagePoints.points);
		const parsed = yieldReceiptInputSchema.safeParse(input);
		if (!parsed.success) {
			toast.error(parsed.error.issues[0]?.message ?? 'กรอกรายการรับเข้าไม่ครบ');
			return;
		}
		try {
			await confirmYieldMutation.mutateAsync({ service: activeService, input, ctx: ctx() });
			clearYieldDraft(activeService._id);
			toast.success('ยืนยันตรวจรับเข้าสต็อกแล้ว');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'ยืนยันตรวจรับไม่สำเร็จ');
		}
	}

	async function handleRejectServiceReceipt() {
		if (!activeService) return;
		if (!rejectReason.trim()) {
			toast.error('กรุณาระบุเหตุผลที่ปฏิเสธการรับมอบ');
			return;
		}
		try {
			await rejectReceiptMutation.mutateAsync({
				mealServiceId: activeService._id,
				reason: rejectReason.trim(),
				ctx: ctx()
			});
			toast.success('ตีกลับโรงครัวแล้ว');
			showRejectForm = false;
			rejectReason = '';
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'ปฏิเสธการรับมอบไม่สำเร็จ');
		}
	}
</script>

<svelte:head>
	<title>รับของเข้าคลัง · SmartShelter</title>
</svelte:head>

<div class="space-y-5 bg-slate-50/60 p-4 sm:p-6">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<Button variant="outline" href={resolve('/back-office/tickets/kitchen')} class="gap-1.5">
			<ArrowLeft class="h-4 w-4" />
			กลับหน้ารายการ
		</Button>
	</div>

	{#if isLoading}
		<p class="py-12 text-center text-sm text-muted-foreground">กำลังโหลด...</p>
	{:else if !activePlan || !activeService}
		<p class="py-12 text-center text-sm text-muted-foreground">
			ยังไม่มีผลผลิตที่บันทึกจากโรงครัวให้ตรวจรับ
		</p>
	{:else}
		<Card.Root class="border shadow-sm">
			<Card.Header class="border-b bg-muted/20">
				<Card.Title class="flex items-center gap-2 text-base font-bold">
					<ClipboardList class="h-4 w-4 text-sky-600" />
					รับของเข้าคลัง: {activePlan.label}
				</Card.Title>
				<Card.Description class="text-xs">
					เป้าหมาย {activePlan.allocated_target ?? activeService.actual_yield ?? 0} จาน
					{#if activeTicket}
						· ตั๋ว {activeTicket.ticket_no}: รับวัตถุดิบแล้ว
					{/if}
				</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-4 p-5 text-xs">
				<div class="rounded-lg border bg-muted/20 p-4">
					<h4 class="mb-3 text-sm font-bold text-foreground">รายละเอียดผลผลิตจากครัว</h4>
					<div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
						<div>
							<p class="text-muted-foreground">เมนู</p>
							<p class="mt-0.5 font-semibold text-foreground">{activePlan.label}</p>
						</div>
						<div>
							<p class="text-muted-foreground">มื้อ</p>
							<p class="mt-0.5 font-semibold text-foreground">
								{MEAL_PERIOD_LABELS[activeService.meal]}
							</p>
						</div>
						<div>
							<p class="text-muted-foreground">วันที่</p>
							<p class="mt-0.5 font-semibold text-foreground">
								{formatThaiDate(activeService.date)}
							</p>
						</div>
						<div>
							<p class="text-muted-foreground">จำนวนจานปรุงได้จริง</p>
							<p class="mt-0.5 font-bold text-foreground tabular-nums">
								{activeService.actual_yield ?? '—'} จาน
							</p>
						</div>
						<div>
							<p class="text-muted-foreground">แจกจ่ายในศูนย์</p>
							<p class="mt-0.5 font-semibold text-foreground tabular-nums">
								{activeService.served} จาน
							</p>
						</div>
						<div>
							<p class="text-muted-foreground">อาหารเหลือทิ้ง</p>
							<p class="mt-0.5 font-semibold text-foreground tabular-nums">
								{activeService.waste} จาน
							</p>
						</div>
						<div>
							<p class="text-muted-foreground">แจกอาสาสมัคร/เจ้าหน้าที่</p>
							<p class="mt-0.5 font-semibold text-foreground tabular-nums">
								{activeService.external.volunteers} จาน
							</p>
						</div>
						<div>
							<p class="text-muted-foreground">แจกผู้พักพิงภายนอก</p>
							<p class="mt-0.5 font-semibold text-foreground tabular-nums">
								{activeService.external.outside_evacuees} จาน
							</p>
						</div>
					</div>
					{#if activeService.notes}
						<div class="mt-3 border-t pt-3">
							<p class="text-muted-foreground">บันทึกเพิ่มเติมจากครัว</p>
							<p class="mt-0.5 text-foreground">{activeService.notes}</p>
						</div>
					{/if}
					<p class="mt-3 border-t pt-3 text-2xs text-muted-foreground">
						บันทึกเมื่อ {formatThaiDateTime(activeService.created_at)} โดย {activeService.created_by}
					</p>
				</div>

				{#if serviceRejected}
					<div
						class="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-red-900"
					>
						<XCircle class="h-5 w-5 shrink-0 text-red-600" />
						<div>
							<h4 class="font-bold">คลังปฏิเสธการรับมอบไปแล้ว — รอครัวบันทึกผลผลิตใหม่</h4>
							<p class="mt-1 text-xs text-red-800">เหตุผล: {activeServiceReceipt?.reason}</p>
						</div>
					</div>
				{:else if serviceReceiptConfirmed}
					<div
						class="flex items-start gap-3 rounded-lg border border-green-200 bg-green-50 p-4 text-green-800"
					>
						<CheckCircle2 class="h-5 w-5 shrink-0 text-green-600" />
						<div>
							<h4 class="font-bold">ตรวจรับเข้าคลังเรียบร้อยแล้ว</h4>
							{#if activeServiceReceipt}
								<p class="mt-1 text-xs text-green-700">
									ยืนยันเมื่อ {formatThaiDateTime(activeServiceReceipt.created_at)} โดย
									{activeServiceReceipt.received_by}
								</p>
							{/if}
						</div>
					</div>
				{:else}
					<div class="space-y-3 rounded-xl border border-sky-200 bg-sky-50 p-4">
						<h4 class="text-sm font-bold text-sky-950">ดำเนินการตรวจรับมอบเสบียง</h4>
						<YieldReceiptLines
							bind:lines
							points={storagePoints.points}
							expectedTotal={activeService.actual_yield}
							disabled={!canReceiveStock || confirmYieldMutation.isPending}
							oncreatenew={handleCreateNewItem}
						/>
						{#if !canReceiveStock}
							<p class="text-xs font-semibold text-amber-800">
								เฉพาะเจ้าหน้าที่คลังหรือผู้จัดการศูนย์เท่านั้นที่ตรวจรับเข้าสต็อกได้
							</p>
						{/if}
						<Button
							class="w-full gap-2 bg-emerald-600 font-semibold text-white hover:bg-emerald-700"
							disabled={!canReceiveStock || confirmYieldMutation.isPending}
							onclick={handleConfirmServiceReceipt}
						>
							<PackageCheck class="h-4 w-4" />
							{confirmYieldMutation.isPending
								? 'กำลังยืนยัน...'
								: `ยืนยันตรวจรับเข้าสต็อก (รวม ${receivedTotal})`}
						</Button>
						{#if !showRejectForm}
							<Button
								class="w-full gap-2 border border-red-200 bg-red-50 font-semibold text-red-700 hover:bg-red-100"
								onclick={() => (showRejectForm = true)}
							>
								<XCircle class="h-4 w-4" />
								ปฏิเสธการรับมอบ / ตีกลับโรงครัว
							</Button>
						{:else}
							<div class="space-y-2 rounded-lg border border-red-200 bg-white p-3">
								<Label class="text-xs">เหตุผลที่ปฏิเสธ</Label>
								<Textarea
									bind:value={rejectReason}
									rows={2}
									class="text-xs"
									placeholder="เช่น จำนวนไม่ตรง คุณภาพไม่ผ่าน..."
								/>
								<div class="flex justify-end gap-2">
									<Button
										variant="outline"
										size="sm"
										onclick={() => {
											showRejectForm = false;
											rejectReason = '';
										}}
									>
										ยกเลิก
									</Button>
									<Button
										variant="destructive"
										size="sm"
										disabled={rejectReceiptMutation.isPending}
										onclick={handleRejectServiceReceipt}
									>
										{rejectReceiptMutation.isPending ? 'กำลังปฏิเสธ...' : 'ยืนยันปฏิเสธ / ตีกลับ'}
									</Button>
								</div>
							</div>
						{/if}
					</div>
				{/if}

				<div class="flex items-center justify-between pt-2">
					<Button variant="outline" onclick={() => goto(resolve('/back-office/tickets/kitchen'))}>
						<ArrowLeft class="mr-1 h-3.5 w-3.5" />
						กลับไปคิวตั๋ว
					</Button>
				</div>
			</Card.Content>
		</Card.Root>
	{/if}
</div>

<Dialog.Root bind:open={createItemOpen}>
	<Dialog.Content class="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
		<Dialog.Header>
			<Dialog.Title>สร้างชนิดอาหารปรุงสำเร็จ</Dialog.Title>
			<Dialog.Description>
				บันทึกแล้วระบบจะเลือกรายการนี้ให้ในแถวที่กำลังกรอกโดยอัตโนมัติ
			</Dialog.Description>
		</Dialog.Header>
		{#if canReceiveStock}
			<ItemMasterForm
				defaultCategoryId={systemCategoryId('READY_MEAL')}
				lockCategory
				compact
				onsuccess={handleItemCreated}
			/>
		{:else}
			<p
				class="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900"
			>
				เฉพาะเจ้าหน้าที่คลังหรือผู้จัดการศูนย์เท่านั้นที่สร้างชนิดของใหม่ได้
			</p>
		{/if}
	</Dialog.Content>
</Dialog.Root>
