<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import Ban from '@lucide/svelte/icons/ban';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import XCircle from '@lucide/svelte/icons/x-circle';
	import Archive from '@lucide/svelte/icons/archive';
	import Send from '@lucide/svelte/icons/send';
	import Clock from '@lucide/svelte/icons/clock';
	import User from '@lucide/svelte/icons/user';
	import { useQueryClient } from '@tanstack/svelte-query';
	import { toast } from 'svelte-sonner';
	import { useEvacuees, zoneLabel } from '$lib/features/people';
	import { getShelterCode } from '$lib/db/shelter';
	import type { Referral, ReferralStatus } from '../domain/referral.schema';
	import type { ReferralBatchFailure } from '../data/referral.repository';
	import { canTransition } from '../domain/referral.transitions';
	import {
		canActorRespond,
		isIncomingCapacityReferral,
		isOutgoingCapacityReferral
	} from '../domain/referral.authorization';
	import { useTransitionReferral } from '../application/queries';
	import {
		formatReferralDate,
		getKindLabel,
		getStatusBadgeVariant,
		getStatusLabel,
		getUrgencyLabel,
		getUrgencyStyle
	} from './referral.ui-helpers';

	let {
		referrals,
		failed = [],
		onBack,
		mode = 'created',
		onSelectReferral,
		selectedId = null
	}: {
		referrals: Referral[];
		failed?: ReferralBatchFailure[];
		onBack?: () => void;
		/** `created` = post-create result; `view` = open batch from list */
		mode?: 'created' | 'view';
		onSelectReferral?: (id: string) => void;
		selectedId?: string | null;
	} = $props();

	const queryClient = useQueryClient();
	const transitionMutation = useTransitionReferral(queryClient);
	const evacueesQuery = useEvacuees();
	const actorShelter = $derived(getShelterCode());

	/** Local status overrides after transitions (avoids $effect ↔ $state write). */
	let overrides = $state<Record<string, Referral>>({});
	let responseReasonInput = $state('');
	let pendingAction = $state<{ to: 'accepted' | 'rejected'; ids: string[] } | null>(null);

	const items = $derived(referrals.map((r) => overrides[r._id] ?? r));

	const sample = $derived(items[0] ?? null);

	const sharedStatus = $derived.by(() => {
		if (items.length === 0) return null;
		const first = items[0]!.status;
		return items.every((r) => r.status === first) ? first : null;
	});

	const destinationLabel = $derived.by(() => {
		if (!sample) return '—';
		if (sample.referral_type === 'capacity') {
			return sample.to_shelter_code ?? '—';
		}
		return sample.to_org?.name ?? '—';
	});

	const incomingSent = $derived(
		items.filter((r) => isIncomingCapacityReferral(r, actorShelter) && r.status === 'sent')
	);
	const awaitingDest = $derived(
		items.some((r) => isOutgoingCapacityReferral(r, actorShelter) && r.status === 'sent')
	);

	function canCancelDraft(referral: Referral): boolean {
		if (!canTransition(referral.status, 'closed') || referral.status !== 'draft') {
			return false;
		}
		if (referral.referral_type === 'capacity') {
			return isOutgoingCapacityReferral(referral, actorShelter);
		}
		return true;
	}

	function canSend(referral: Referral): boolean {
		return (
			canTransition(referral.status, 'sent') &&
			(referral.referral_type !== 'capacity' || isOutgoingCapacityReferral(referral, actorShelter))
		);
	}

	function canAccept(referral: Referral): boolean {
		return canActorRespond(referral, actorShelter) && canTransition(referral.status, 'accepted');
	}

	function canReject(referral: Referral): boolean {
		return canActorRespond(referral, actorShelter) && canTransition(referral.status, 'rejected');
	}

	function canCloseNonDraft(referral: Referral): boolean {
		return (
			canTransition(referral.status, 'closed') &&
			referral.status !== 'draft' &&
			(referral.referral_type !== 'capacity' || isOutgoingCapacityReferral(referral, actorShelter))
		);
	}

	function hasRowActions(referral: Referral): boolean {
		return (
			canCancelDraft(referral) || canSend(referral) || canAccept(referral) || canReject(referral)
		);
	}

	const sendable = $derived(items.filter(canSend));
	const acceptable = $derived(items.filter(canAccept));
	const rejectable = $derived(items.filter(canReject));
	const cancelableDrafts = $derived(items.filter(canCancelDraft));
	const closeable = $derived(items.filter(canCloseNonDraft));

	const showBatchActions = $derived(
		sendable.length > 0 ||
			acceptable.length > 0 ||
			rejectable.length > 0 ||
			cancelableDrafts.length > 0 ||
			closeable.length > 0
	);

	function evacueeName(evacueeId: string): string {
		const found = evacueesQuery.data?.find((e) => e._id === evacueeId);
		if (!found) return evacueeId;
		return `${found.first_name} ${found.last_name}`;
	}

	function evacueeZone(evacueeId: string): string {
		const found = evacueesQuery.data?.find((e) => e._id === evacueeId);
		return zoneLabel(found?.current_stay?.zone);
	}

	async function runBatchTransition(
		ids: string[],
		to: ReferralStatus,
		label: string,
		reason?: string
	) {
		await toast.promise(
			(async () => {
				let succeeded = 0;
				let failedCount = 0;
				for (const id of ids) {
					try {
						const updated = await transitionMutation.mutateAsync({ id, to, reason });
						overrides = { ...overrides, [updated._id]: updated };
						succeeded++;
					} catch {
						failedCount++;
					}
				}
				return { succeeded, failedCount, total: ids.length };
			})(),
			{
				loading: `กำลัง${label} ${ids.length} รายการ...`,
				success: (r) =>
					r.failedCount === 0
						? `${label}สำเร็จ ${r.succeeded} รายการ`
						: `${label}สำเร็จ ${r.succeeded} / ล้มเหลว ${r.failedCount} จาก ${r.total}`,
				error: (err) => (err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการเปลี่ยนสถานะ')
			}
		);
	}

	function triggerActionWithReason(to: 'accepted' | 'rejected', ids: string[]) {
		pendingAction = { to, ids };
		responseReasonInput = '';
	}

	async function submitWithReason() {
		if (!pendingAction) return;
		const { to, ids } = pendingAction;
		const label = to === 'accepted' ? 'ตอบรับ' : 'ปฏิเสธ';
		await runBatchTransition(ids, to, label, responseReasonInput.trim());
		pendingAction = null;
		responseReasonInput = '';
	}

	async function cancelDraft(referral: Referral) {
		await runBatchTransition([referral._id], 'closed', 'ยกเลิกร่าง');
	}
</script>

<div class="flex h-full min-h-0 flex-col">
	<div
		class="min-h-0 flex-1 space-y-6 overflow-y-auto {showBatchActions || pendingAction
			? 'pb-28'
			: 'pb-4'}"
	>
		{#if mode === 'created'}
			<div class="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
				<div class="space-y-1">
					<h2 class="text-xl font-bold tracking-tight">ผลการสร้างรายการส่งต่อ</h2>
					<p class="text-sm text-muted-foreground">
						สำเร็จ {items.length} รายการ
						{#if failed.length > 0}
							· ล้มเหลว {failed.length} รายการ
						{/if}
					</p>
				</div>
				{#if onBack}
					<Button variant="outline" onclick={onBack} class="gap-2">
						<ArrowLeft class="h-4 w-4" />
						กลับไปหน้ารายการ
					</Button>
				{/if}
			</div>
		{:else}
			<div class="space-y-1">
				<h2 class="text-xl font-bold tracking-tight">รายละเอียดชุดส่งต่อ</h2>
				<p class="text-sm text-muted-foreground">
					{items.length} คนในชุดนี้{#if onSelectReferral}
						— กดแถวเพื่อเปิดรายละเอียดรายบุคคล
					{/if}
				</p>
			</div>
		{/if}

		{#if incomingSent.length > 0 && sample}
			<div
				class="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100"
				role="status"
			>
				คำขอย้ายเข้าจากศูนย์ <span class="font-mono font-semibold">{sample.shelter_code}</span>
				({incomingSent.length} คน) — ตอบรับแล้วระบบจะย้ายผู้ประสบภัยเข้าศูนย์นี้ (occupancy สองฝั่งจะอัปเดตหลังตอบรับเท่านั้น)
			</div>
		{/if}

		{#if awaitingDest && sample}
			<div
				class="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
				role="status"
			>
				รอศูนย์ปลายทาง
				<span class="font-mono font-semibold">{sample.to_shelter_code}</span>
				ตอบรับหรือปฏิเสธ — การย้ายศูนย์จะเกิดขึ้นเมื่อปลายทางกดตอบรับเท่านั้น
			</div>
		{/if}

		{#if sample}
			<Card.Root class="border border-border/80 shadow-sm">
				<Card.Header class="border-b border-border/60 bg-muted/30 pb-4">
					<Card.Title class="text-lg font-bold">ข้อมูลร่วมของชุดนี้</Card.Title>
					<Card.Description>ค่าที่แชร์ระหว่างทุกใบในชุด (ไม่ซ้ำต่อคน)</Card.Description>
				</Card.Header>
				<Card.Content class="grid gap-4 p-6 sm:grid-cols-2">
					<div class="space-y-1">
						<p class="text-xs font-medium text-muted-foreground">ประเภทส่งต่อ</p>
						<p class="text-sm font-semibold">{getKindLabel(sample.referral_type)}</p>
					</div>
					<div class="space-y-1">
						<p class="text-xs font-medium text-muted-foreground">ปลายทาง</p>
						<p class="font-mono text-sm font-semibold">{destinationLabel}</p>
					</div>
					<div class="space-y-1">
						<p class="text-xs font-medium text-muted-foreground">ความเร่งด่วน</p>
						<Badge class={getUrgencyStyle(sample.urgency)}>{getUrgencyLabel(sample.urgency)}</Badge>
					</div>
					<div class="space-y-1">
						<p class="text-xs font-medium text-muted-foreground">สถานะรวม</p>
						{#if sharedStatus}
							<span
								class="inline-flex rounded-md px-2 py-0.5 text-xs font-semibold {getStatusBadgeVariant(
									sharedStatus
								)}"
							>
								{getStatusLabel(sharedStatus)}
							</span>
						{:else}
							<p class="text-sm font-medium">
								{#if mode === 'created' && failed.length > 0}
									สำเร็จ {items.length} / ล้มเหลว {failed.length}
								{:else}
									หลายสถานะในชุด
								{/if}
							</p>
						{/if}
					</div>
					<div class="space-y-1 sm:col-span-2">
						<p class="text-xs font-medium text-muted-foreground">เหตุผล</p>
						<p class="text-sm whitespace-pre-wrap">{sample.reason}</p>
					</div>
					{#if sample.notes}
						<div class="space-y-1 sm:col-span-2">
							<p class="text-xs font-medium text-muted-foreground">หมายเหตุ</p>
							<p class="text-sm whitespace-pre-wrap text-muted-foreground">{sample.notes}</p>
						</div>
					{/if}
				</Card.Content>
			</Card.Root>

			{#if sample.response_reason}
				<div class="space-y-3">
					<h3
						class="text-sm font-semibold tracking-wider text-emerald-700 uppercase dark:text-emerald-400"
					>
						เหตุผลการตอบรับ/ปฏิเสธจากปลายทาง (Response Reason)
					</h3>
					<p
						class="rounded-md border border-emerald-200 bg-emerald-50/50 p-3 text-sm font-medium whitespace-pre-wrap text-emerald-900 dark:border-emerald-900/30 dark:bg-emerald-950/30 dark:text-emerald-200"
					>
						{sample.response_reason}
					</p>
				</div>
			{/if}

			<div class="space-y-4 rounded-lg border border-border/80 p-6">
				<div class="space-y-1">
					<h3
						class="flex items-center gap-1.5 text-sm font-semibold tracking-wider text-foreground uppercase"
					>
						<Clock class="h-4 w-4 text-muted-foreground" />
						บันทึกประวัติการส่งตัว (Timeline Audit Trail)
					</h3>
					{#if sharedStatus === null}
						<p class="text-xs text-muted-foreground">
							แสดงจากใบตัวอย่างในชุด — สถานะรายคนดูในตาราง
						</p>
					{/if}
				</div>

				<div class="relative ml-3 space-y-4 border-l border-border pl-6">
					<div class="relative">
						<div
							class="absolute top-1.5 -left-[30px] flex h-4 w-4 items-center justify-center rounded-full border-2 border-primary bg-background p-1"
						></div>
						<div class="text-xs">
							<span class="font-semibold">ลงบันทึกใบร่างครั้งแรก:</span>
							<span class="text-muted-foreground">{formatReferralDate(sample.created_at)}</span>
							<span
								class="ml-1.5 flex inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
							>
								<User class="h-3 w-3" /> By: {sample.created_by}
							</span>
						</div>
					</div>

					{#if sample.timeline?.sent}
						<div class="relative">
							<div
								class="absolute top-1.5 -left-[30px] flex h-4 w-4 items-center justify-center rounded-full border-2 border-blue-500 bg-background p-1"
							></div>
							<div class="text-xs">
								<span class="font-semibold text-blue-600">ส่งข้อมูลออก (Sent):</span>
								<span class="text-muted-foreground"
									>{formatReferralDate(sample.timeline.sent.at)}</span
								>
								<span
									class="ml-1.5 flex inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
								>
									<User class="h-3 w-3" /> By: {sample.timeline.sent.by}
								</span>
							</div>
						</div>
					{/if}

					{#if sample.timeline?.responded}
						<div class="relative">
							<div
								class="absolute top-1.5 -left-[30px] flex h-4 w-4 items-center justify-center rounded-full border-2 border-emerald-500 bg-background p-1"
							></div>
							<div class="text-xs">
								<span class="font-semibold text-emerald-600"
									>หน่วยงานปลายทางตอบสนอง (Responded):</span
								>
								<span class="text-muted-foreground"
									>{formatReferralDate(sample.timeline.responded.at)}</span
								>
								<span
									class="ml-1.5 flex inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
								>
									<User class="h-3 w-3" /> By: {sample.timeline.responded.by}
								</span>
							</div>
						</div>
					{/if}

					{#if sample.timeline?.closed}
						<div class="relative">
							<div
								class="absolute top-1.5 -left-[30px] flex h-4 w-4 items-center justify-center rounded-full border-2 border-slate-500 bg-background p-1"
							></div>
							<div class="text-xs">
								<span class="font-semibold text-slate-600">ปิดรายการ (Closed):</span>
								<span class="text-muted-foreground"
									>{formatReferralDate(sample.timeline.closed.at)}</span
								>
								<span
									class="ml-1.5 flex inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
								>
									<User class="h-3 w-3" /> By: {sample.timeline.closed.by}
								</span>
							</div>
						</div>
					{/if}
				</div>
			</div>
		{/if}

		{#if failed.length > 0}
			<div
				class="rounded-lg border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-100"
				role="status"
			>
				<div class="mb-2 flex items-center gap-2 font-semibold">
					<AlertTriangle class="h-4 w-4" />
					สร้างไม่สำเร็จ {failed.length} คน
				</div>
				<ul class="list-inside list-disc space-y-1 text-xs">
					{#each failed as item (item.evacuee_id)}
						<li>
							<span class="font-medium">{evacueeName(item.evacuee_id)}</span>
							— {item.error}
						</li>
					{/each}
				</ul>
			</div>
		{/if}

		{#if items.length > 0}
			<div class="overflow-hidden rounded-lg border border-border/80">
				<Table.Root>
					<Table.Header>
						<Table.Row class="bg-muted/40 hover:bg-muted/40">
							<Table.Head class="font-semibold text-foreground">ชื่อผู้ประสบภัย</Table.Head>
							<Table.Head class="font-semibold text-foreground">โซน</Table.Head>
							<Table.Head class="font-semibold text-foreground">สถานะ</Table.Head>
							<Table.Head class="font-semibold text-foreground">สร้างเมื่อ</Table.Head>
							<Table.Head class="font-semibold text-foreground">ID</Table.Head>
							<Table.Head class="text-center font-semibold text-foreground">จัดการ</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each items as referral (referral._id)}
							<Table.Row
								class="transition-colors hover:bg-muted/20
							{onSelectReferral ? 'cursor-pointer' : ''}
							{selectedId === referral._id ? 'bg-primary/5 ring-1 ring-primary/20 ring-inset' : ''}"
								onclick={() => onSelectReferral?.(referral._id)}
							>
								<Table.Cell class="font-semibold text-foreground">
									{evacueeName(referral.evacuee_id)}
								</Table.Cell>
								<Table.Cell class="text-muted-foreground">
									{evacueeZone(referral.evacuee_id)}
								</Table.Cell>
								<Table.Cell>
									<span
										class="inline-flex rounded-md px-2 py-0.5 text-xs font-semibold {getStatusBadgeVariant(
											referral.status
										)}"
									>
										{getStatusLabel(referral.status)}
									</span>
								</Table.Cell>
								<Table.Cell class="text-muted-foreground">
									{formatReferralDate(referral.created_at)}
								</Table.Cell>
								<Table.Cell
									class="max-w-[10rem] truncate font-mono text-xs text-muted-foreground"
									title={referral._id}
								>
									{referral._id}
								</Table.Cell>
								<Table.Cell class="text-center">
									{#if hasRowActions(referral)}
										<div class="flex flex-wrap items-center justify-center gap-1.5">
											{#if canSend(referral)}
												<Button
													size="sm"
													variant="default"
													class="gap-1"
													disabled={transitionMutation.isPending}
													onclick={(e) => {
														e.stopPropagation();
														runBatchTransition([referral._id], 'sent', 'ส่งตัว');
													}}
												>
													<Send class="h-3.5 w-3.5" />
													ส่ง
												</Button>
											{/if}
											{#if canAccept(referral)}
												<Button
													size="sm"
													class="gap-1 bg-emerald-600 text-white hover:bg-emerald-700"
													disabled={transitionMutation.isPending}
													onclick={(e) => {
														e.stopPropagation();
														triggerActionWithReason('accepted', [referral._id]);
													}}
												>
													<CheckCircle2 class="h-3.5 w-3.5" />
													ตอบรับ
												</Button>
											{/if}
											{#if canReject(referral)}
												<Button
													size="sm"
													variant="outline"
													class="gap-1 border-rose-300 text-rose-600 hover:bg-rose-50"
													disabled={transitionMutation.isPending}
													onclick={(e) => {
														e.stopPropagation();
														triggerActionWithReason('rejected', [referral._id]);
													}}
												>
													<XCircle class="h-3.5 w-3.5" />
													ปฏิเสธ
												</Button>
											{/if}
											{#if canCancelDraft(referral)}
												<Button
													size="sm"
													variant="outline"
													class="gap-1.5 border-rose-300 text-rose-700 hover:bg-rose-50"
													disabled={transitionMutation.isPending}
													onclick={(e) => {
														e.stopPropagation();
														cancelDraft(referral);
													}}
												>
													<Ban class="h-3.5 w-3.5" />
													ยกเลิกร่าง
												</Button>
											{/if}
										</div>
									{:else}
										<span class="text-xs text-muted-foreground">—</span>
									{/if}
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</div>
		{:else if failed.length > 0}
			<p class="text-center text-sm text-muted-foreground">ไม่มีรายการที่สร้างสำเร็จในชุดนี้</p>
		{/if}
	</div>

	{#if showBatchActions || pendingAction}
		<div
			class="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
		>
			<div
				class="pointer-events-auto w-full max-w-3xl space-y-3 rounded-xl border border-border/80 bg-background/95 p-3 shadow-[0_-4px_24px_rgba(0,0,0,0.12)] backdrop-blur-md supports-[backdrop-filter]:bg-background/90"
			>
				{#if pendingAction}
					<div class="space-y-3 rounded-lg border border-primary/40 bg-primary/5 p-3">
						<h4 class="text-sm font-semibold text-foreground">
							ระบุเหตุผลการ{pendingAction.to === 'accepted' ? 'ตอบรับ' : 'ปฏิเสธ'} (Response Reason)
							{#if pendingAction.ids.length > 1}
								<span class="font-normal text-muted-foreground">
									— {pendingAction.ids.length} รายการ
								</span>
							{/if}
						</h4>
						<Input
							type="text"
							placeholder="ระบุเหตุผลหรือคำอธิบายประกอบการพิจารณา..."
							bind:value={responseReasonInput}
						/>
						<div class="flex justify-end gap-2">
							<Button
								variant="ghost"
								size="sm"
								disabled={transitionMutation.isPending}
								onclick={() => (pendingAction = null)}
							>
								ยกเลิก
							</Button>
							<Button
								size="sm"
								variant={pendingAction.to === 'accepted' ? 'default' : 'destructive'}
								disabled={transitionMutation.isPending}
								onclick={submitWithReason}
							>
								ยืนยันการ{pendingAction.to === 'accepted' ? 'ตอบรับ' : 'ปฏิเสธ'}
							</Button>
						</div>
					</div>
				{/if}

				{#if showBatchActions}
					<div class="flex flex-wrap items-center justify-end gap-2.5">
						{#if sendable.length > 0}
							<Button
								size="sm"
								variant="default"
								class="gap-1.5"
								disabled={transitionMutation.isPending}
								onclick={() =>
									runBatchTransition(
										sendable.map((r) => r._id),
										'sent',
										'ส่งตัว'
									)}
							>
								<Send class="h-4 w-4" />
								ส่งทั้งหมด ({sendable.length})
							</Button>
						{/if}

						{#if acceptable.length > 0}
							<Button
								size="sm"
								class="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
								disabled={transitionMutation.isPending}
								onclick={() =>
									triggerActionWithReason(
										'accepted',
										acceptable.map((r) => r._id)
									)}
							>
								<CheckCircle2 class="h-4 w-4" />
								ตอบรับทั้งหมด ({acceptable.length})
							</Button>
						{/if}

						{#if rejectable.length > 0}
							<Button
								size="sm"
								variant="outline"
								class="gap-1.5 border-rose-300 text-rose-600 hover:bg-rose-50"
								disabled={transitionMutation.isPending}
								onclick={() =>
									triggerActionWithReason(
										'rejected',
										rejectable.map((r) => r._id)
									)}
							>
								<XCircle class="h-4 w-4" />
								ปฏิเสธทั้งหมด ({rejectable.length})
							</Button>
						{/if}

						{#if cancelableDrafts.length > 0}
							<Button
								size="sm"
								variant="outline"
								class="gap-1.5 border-rose-300 text-rose-700 hover:bg-rose-50"
								disabled={transitionMutation.isPending}
								onclick={() =>
									runBatchTransition(
										cancelableDrafts.map((r) => r._id),
										'closed',
										'ยกเลิกร่าง'
									)}
							>
								<Ban class="h-4 w-4" />
								ยกเลิกร่างทั้งหมด ({cancelableDrafts.length})
							</Button>
						{/if}

						{#if closeable.length > 0}
							<Button
								size="sm"
								variant="outline"
								class="gap-1.5 border-slate-300 text-slate-700 hover:bg-slate-50"
								disabled={transitionMutation.isPending}
								onclick={() =>
									runBatchTransition(
										closeable.map((r) => r._id),
										'closed',
										'ปิดรายการ'
									)}
							>
								<Archive class="h-4 w-4" />
								ปิดทั้งหมด ({closeable.length})
							</Button>
						{/if}
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>
