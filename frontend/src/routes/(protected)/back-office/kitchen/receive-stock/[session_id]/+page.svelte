<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import * as Card from '$lib/components/ui/card';
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
		useConfirmMealServiceReceipt,
		useRejectMealServiceReceipt,
		mealServiceReceiptOutcome,
		MEAL_PERIOD_LABELS
	} from '$lib/features/kitchen';
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

	const confirmReceiptMutation = useConfirmMealServiceReceipt();
	const rejectReceiptMutation = useRejectMealServiceReceipt();

	let showRejectForm = $state(false);
	let rejectReason = $state('');

	function ctx() {
		return { shelterCode: getShelterCode(), createdBy: authStore.user?.name ?? 'warehouse_staff' };
	}

	async function handleConfirmServiceReceipt() {
		if (!activeService) return;
		try {
			await confirmReceiptMutation.mutateAsync({ mealServiceId: activeService._id, ctx: ctx() });
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
						<div>
							<p class="text-muted-foreground">แก๊สหุงต้มที่ใช้จริง</p>
							<p class="mt-0.5 font-semibold text-foreground tabular-nums">
								{activeService.actual_gas_used_kg ?? '—'} kg
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
							<h4 class="font-bold">ตรวจรับเข้าคลังเรียบร้อยแล้ว — ส่งมอบเสร็จสิ้น</h4>
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
						<Button
							class="w-full gap-2 bg-emerald-600 font-semibold text-white hover:bg-emerald-700"
							disabled={confirmReceiptMutation.isPending}
							onclick={handleConfirmServiceReceipt}
						>
							<PackageCheck class="h-4 w-4" />
							{confirmReceiptMutation.isPending
								? 'กำลังยืนยัน...'
								: `ยืนยันตรวจรับเข้าสต็อก (${activeService.actual_yield ?? 0} กล่อง)`}
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
