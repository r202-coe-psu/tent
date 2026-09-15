<script lang="ts">
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import {
		Dialog,
		DialogContent,
		DialogHeader,
		DialogTitle,
		DialogDescription,
		DialogFooter
	} from '$lib/components/ui/dialog';
	import type { DistributionRequest, DistributionRequestStatus } from '../domain/distribution';
	import {
		approvalCoverageLabels,
		distributionRequestStatusLabels,
		getRequestItemPresentationKey
	} from './request-ui';
	import { useDistributionBatch, useDistributionRequest } from '../application/queries';
	import { useItemMasters, type ItemMaster } from '$lib/features/catalog';
	import { getShelterCode } from '$lib/db/shelter';
	import ActiveBatchSummary from './active-batch-summary.svelte';
	import { deriveApprovalCoverage } from './approval-coverage';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import Ban from '@lucide/svelte/icons/ban';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import Package from '@lucide/svelte/icons/package';
	import Users from '@lucide/svelte/icons/users';
	import XCircle from '@lucide/svelte/icons/x-circle';
	import { SvelteMap } from 'svelte/reactivity';

	interface Props {
		open: boolean;
		request: DistributionRequest | null;
		canApprove?: boolean;
		canReject?: boolean;
		canCancel?: boolean;
		isCancelling?: boolean;
		onApprove?: (request: DistributionRequest) => void;
		onReject?: (request: DistributionRequest) => void;
		onCancel?: (request: DistributionRequest) => void;
		onClose?: () => void;
	}

	let {
		open = $bindable(false),
		request,
		canApprove = false,
		canReject = false,
		canCancel = false,
		isCancelling = false,
		onApprove,
		onReject,
		onCancel,
		onClose
	}: Props = $props();

	const selectedRequestId = $derived(open && request?._id ? request._id : undefined);

	// Direct lazy query when the dialog is open. The selected row only supplies an
	// ID (and a non-authoritative header hint while the query is unresolved).
	const requestQuery = useDistributionRequest(
		() => selectedRequestId,
		() => getShelterCode()
	);
	const authoritativeRequest = $derived(
		requestQuery.data?._id === selectedRequestId ? requestQuery.data : null
	);
	const isAwaitingAuthoritativeRequest = $derived(
		!!selectedRequestId &&
			!requestQuery.isError &&
			(!requestQuery.isSuccess || requestQuery.data?._id !== selectedRequestId)
	);

	const batchQuery = useDistributionBatch(
		() => (authoritativeRequest?.status === 'approved' ? authoritativeRequest.batch_id : undefined),
		() => getShelterCode()
	);
	const coverage = $derived(deriveApprovalCoverage(authoritativeRequest, batchQuery.data));

	const itemMastersQuery = useItemMasters(() => getShelterCode());
	const itemMastersMap = $derived.by(() => {
		const map = new SvelteMap<string, ItemMaster>();
		for (const item of itemMastersQuery.data ?? []) {
			map.set(item._id, item);
		}
		return map;
	});

	const badgeClasses: Record<DistributionRequestStatus, string> = {
		pending:
			'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200',
		approving:
			'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200',
		approved:
			'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200',
		rejected:
			'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200',
		cancelled:
			'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
	};

	function formatDate(value?: string): string {
		if (!value) return '-';
		try {
			return new Intl.DateTimeFormat('th-TH', {
				dateStyle: 'medium',
				timeStyle: 'short'
			}).format(new Date(value));
		} catch {
			return value;
		}
	}

	function handleOpenChange(isOpen: boolean) {
		open = isOpen;
		if (!isOpen) {
			onClose?.();
		}
	}

	function retryRequestRead() {
		void requestQuery.refetch();
	}
</script>

<Dialog {open} onOpenChange={handleOpenChange}>
	<DialogContent class="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
		<DialogHeader>
			<div class="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
				<div class="flex flex-wrap items-center gap-2">
					<DialogTitle class="text-lg font-bold text-foreground"
						>รายละเอียดคำร้องเบิกจ่าย</DialogTitle
					>
					{#if authoritativeRequest}
						<Badge variant="outline" class={badgeClasses[authoritativeRequest.status]}>
							{distributionRequestStatusLabels[authoritativeRequest.status]}
						</Badge>
						{#if authoritativeRequest.status === 'approved'}
							{#if coverage.kind === 'full'}
								<Badge
									variant="outline"
									class="border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
								>
									{approvalCoverageLabels.full}
								</Badge>
							{:else if coverage.kind === 'partial'}
								<Badge
									variant="outline"
									class="border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
								>
									{approvalCoverageLabels.partial}
								</Badge>
							{:else}
								<Badge variant="outline" class="text-muted-foreground">ไม่ทราบผลการจัดสรร</Badge>
							{/if}
						{/if}
					{/if}
				</div>
				<DialogDescription class="font-mono text-xs break-all text-muted-foreground">
					{selectedRequestId ?? '-'}
				</DialogDescription>
			</div>
		</DialogHeader>

		{#if !selectedRequestId}
			<div class="flex min-h-40 items-center justify-center text-xs text-muted-foreground">
				ไม่พบคำร้องที่เลือก
			</div>
		{:else if isAwaitingAuthoritativeRequest}
			<div
				class="flex min-h-40 flex-col items-center justify-center gap-2 text-xs text-muted-foreground"
			>
				<Loader2 class="size-5 animate-spin text-primary" />
				<span>กำลังโหลดรายละเอียดคำร้อง...</span>
			</div>
		{:else if requestQuery.isError}
			<div class="flex min-h-40 flex-col items-center justify-center gap-3 text-center text-xs">
				<AlertCircle class="size-5 text-destructive" />
				<p class="text-destructive">ไม่สามารถโหลดรายละเอียดคำร้องได้</p>
				<Button variant="outline" size="sm" onclick={retryRequestRead}>ลองใหม่</Button>
			</div>
		{:else if !authoritativeRequest}
			<div
				class="flex min-h-40 flex-col items-center justify-center gap-2 text-center text-xs text-muted-foreground"
			>
				<AlertCircle class="size-5" />
				<p>ไม่พบคำร้องนี้ หรือคำร้องอาจไม่พร้อมใช้งานแล้ว</p>
			</div>
		{:else}
			<div class="space-y-5 py-2 text-xs">
				<!-- Purpose and Note -->
				<Card.Root class="border-border/80 bg-muted/20 shadow-none">
					<Card.Content class="space-y-2 p-3.5">
						<div>
							<div class="text-[11px] font-semibold text-muted-foreground">
								วัตถุประสงค์การเบิกจ่าย
							</div>
							<p class="mt-0.5 text-sm font-medium text-foreground">
								{authoritativeRequest.purpose}
							</p>
						</div>
						{#if authoritativeRequest.note}
							<div class="border-t border-border/60 pt-2">
								<div class="text-[11px] font-semibold text-muted-foreground">หมายเหตุเพิ่มเติม</div>
								<p class="mt-0.5 text-foreground">{authoritativeRequest.note}</p>
							</div>
						{/if}
					</Card.Content>
				</Card.Root>

				<!-- Metadata Grid -->
				<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
					<div class="rounded-lg border border-border/80 bg-card p-2.5">
						<div class="text-[11px] text-muted-foreground">ผู้ยื่นคำร้อง</div>
						<div class="mt-1 truncate font-semibold text-foreground">
							{authoritativeRequest.requested_by}
						</div>
					</div>
					<div class="rounded-lg border border-border/80 bg-card p-2.5">
						<div class="text-[11px] text-muted-foreground">วันที่ยื่นคำร้อง</div>
						<div class="mt-1 font-semibold text-foreground">
							{formatDate(authoritativeRequest.requested_at)}
						</div>
					</div>
					<div class="rounded-lg border border-border/80 bg-card p-2.5">
						<div class="flex items-center gap-1 text-[11px] text-muted-foreground">
							<Users class="size-3" />
							<span>ยอดผู้พักพิง (Snapshot)</span>
						</div>
						<div class="mt-1 font-semibold text-foreground">
							{authoritativeRequest.active_headcount_snapshot} คน
						</div>
					</div>
					<div class="rounded-lg border border-border/80 bg-card p-2.5">
						<div class="text-[11px] text-muted-foreground">อัตราสำรอง (Buffer)</div>
						<div class="mt-1 font-semibold text-foreground">
							+{authoritativeRequest.buffer_percent}%
						</div>
					</div>
				</div>

				<!-- Items Table (Authoritative from Request Snapshot) -->
				<div class="space-y-2">
					<div class="flex items-center justify-between">
						<h3 class="font-bold text-foreground">รายการสิ่งของที่ร้องขอ</h3>
						<span class="text-[11px] text-muted-foreground"
							>{authoritativeRequest.items.length} รายการ</span
						>
					</div>

					<div class="overflow-hidden rounded-lg border border-border/80 bg-card">
						<Table.Root>
							<Table.Header>
								<Table.Row class="bg-muted/40 text-[11px]">
									<Table.Head>รายการสิ่งของ</Table.Head>
									<Table.Head>ประเภทการแจกจ่าย</Table.Head>
									<Table.Head class="text-right">เป้าหมาย (NFI Target)</Table.Head>
									<Table.Head class="text-right">จำนวนที่ขอ</Table.Head>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{#each authoritativeRequest.items as item, index (getRequestItemPresentationKey(item, index))}
									{@const itemMaster = itemMastersMap.get(item.item_id)}
									<Table.Row>
										<Table.Cell>
											<div class="flex items-center gap-1.5 font-medium text-foreground">
												<Package class="size-3.5 text-muted-foreground" />
												<span>{itemMaster?.name ?? item.item_id}</span>
											</div>
											{#if itemMaster?.name}
												<div class="font-mono text-[10px] text-muted-foreground">
													{item.item_id}
												</div>
											{/if}
										</Table.Cell>
										<Table.Cell class="text-muted-foreground">
											{#if item.distribution_type_snapshot === 'one_time'}
												แจกครั้งเดียว (One-Time)
											{:else}
												สิ้นเปลือง (Consumable)
											{/if}
										</Table.Cell>
										<Table.Cell class="text-right text-muted-foreground tabular-nums">
											{item.target_qty_snapshot}
											{item.unit}
										</Table.Cell>
										<Table.Cell class="text-right font-bold text-foreground tabular-nums">
											{item.requested_qty}
											{item.unit}
										</Table.Cell>
									</Table.Row>
								{/each}
							</Table.Body>
						</Table.Root>
					</div>
				</div>

				<!-- Lifecycle-Specific Presentation -->
				{#if authoritativeRequest.status === 'approving'}
					<div
						class="flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 p-3.5 text-blue-900 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-200"
					>
						<Loader2 class="size-5 shrink-0 animate-spin text-blue-600" />
						<div>
							<div class="font-bold">อยู่ระหว่างการยืนยันการจัดสรร (Approving)</div>
							<p class="mt-0.5 text-[11px] text-blue-700 dark:text-blue-300">
								ระบบกำลังยืนยัน Physical Lot และบันทึกการจัดสรรสต็อก กรุณารอสักครู่
								ไม่จำเป็นต้องกดอนุมัติซ้ำ
							</p>
							<p class="mt-0.5 text-[10px] text-blue-600/80 dark:text-blue-300/80">
								สถานะจะอัปเดตเป็นผลการอนุมัติเมื่อการบันทึกเสร็จสมบูรณ์
							</p>
						</div>
					</div>
				{:else if authoritativeRequest.status === 'approved'}
					<!-- Approval Metadata & Active Batch -->
					<div class="space-y-3">
						<div
							class="grid grid-cols-1 gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 text-emerald-900 sm:grid-cols-2 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-200"
						>
							<div>
								<span class="text-[11px] text-emerald-700 dark:text-emerald-300">ผู้อนุมัติ:</span>
								<strong class="ml-1">{authoritativeRequest.approved_by ?? '-'}</strong>
							</div>
							<div>
								<span class="text-[11px] text-emerald-700 dark:text-emerald-300">อนุมัติเมื่อ:</span
								>
								<strong class="ml-1">{formatDate(authoritativeRequest.approved_at)}</strong>
							</div>
						</div>

						<ActiveBatchSummary
							batchId={authoritativeRequest.batch_id}
							requestId={authoritativeRequest._id}
							request={authoritativeRequest}
						/>
					</div>
				{:else if authoritativeRequest.status === 'rejected'}
					<!-- Rejection Card -->
					<Card.Root class="border-destructive/40 bg-destructive/5">
						<Card.Header class="p-3.5 pb-2">
							<div class="flex items-center gap-2 text-destructive">
								<XCircle class="size-4" />
								<Card.Title class="text-xs font-bold">ข้อมูลการปฏิเสธคำร้อง</Card.Title>
							</div>
						</Card.Header>
						<Card.Content class="space-y-2 p-3.5 pt-0 text-xs">
							<div class="grid grid-cols-1 gap-2 text-muted-foreground sm:grid-cols-2">
								<div>
									<span>ผู้ปฏิเสธ:</span>
									<strong class="ml-1 text-foreground"
										>{authoritativeRequest.rejected_by ?? '-'}</strong
									>
								</div>
								<div>
									<span>ปฏิเสธเมื่อ:</span>
									<strong class="ml-1 text-foreground"
										>{formatDate(authoritativeRequest.rejected_at)}</strong
									>
								</div>
							</div>
							<div class="rounded-md border border-destructive/20 bg-background p-2.5">
								<div class="text-[11px] font-semibold text-muted-foreground">เหตุผลการปฏิเสธ:</div>
								<p class="mt-0.5 font-medium text-destructive">
									{authoritativeRequest.rejection_reason ?? 'ไม่ได้ระบุเหตุผล'}
								</p>
							</div>
						</Card.Content>
					</Card.Root>
				{:else if authoritativeRequest.status === 'cancelled'}
					<!-- Cancellation Card -->
					<div
						class="flex items-center gap-2.5 rounded-lg border border-border/80 bg-muted/40 p-3.5 text-xs text-muted-foreground"
					>
						<Ban class="size-4 shrink-0" />
						<span>คำร้องนี้ถูกยกเลิกแล้ว (ไม่สามารถดำเนินการต่อได้)</span>
					</div>
				{/if}
			</div>
		{/if}

		<DialogFooter class="flex flex-wrap items-center justify-between gap-2 pt-2 sm:justify-between">
			<div class="flex gap-2">
				{#if authoritativeRequest?.status === 'pending'}
					{#if canCancel && onCancel}
						<Button
							variant="outline"
							size="sm"
							disabled={isCancelling}
							class="text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
							onclick={() => onCancel(authoritativeRequest)}
						>
							<Ban class="mr-1 size-3.5" />
							{isCancelling ? 'กำลังยกเลิก...' : 'ยกเลิกคำร้อง'}
						</Button>
					{/if}
				{/if}
			</div>

			<div class="flex items-center gap-2">
				{#if authoritativeRequest?.status === 'pending'}
					{#if canReject && onReject}
						<Button
							variant="outline"
							size="sm"
							class="border-destructive/30 text-xs text-destructive hover:bg-destructive/10"
							onclick={() => onReject(authoritativeRequest)}
						>
							<XCircle class="mr-1 size-3.5" />
							ปฏิเสธคำร้อง
						</Button>
					{/if}

					{#if canApprove && onApprove}
						<Button
							size="sm"
							class="gap-1.5 text-xs font-bold"
							onclick={() => onApprove(authoritativeRequest)}
						>
							<CheckCircle2 class="size-3.5" />
							อนุมัติเบิกจ่าย
						</Button>
					{/if}
				{/if}

				<Button
					variant="secondary"
					size="sm"
					class="text-xs"
					onclick={() => handleOpenChange(false)}
				>
					ปิด
				</Button>
			</div>
		</DialogFooter>
	</DialogContent>
</Dialog>
