<script lang="ts">
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button';
	import * as Table from '$lib/components/ui/table/index.js';
	import type { DistributionRequest, DistributionRequestStatus } from '../domain/distribution';
	import { approvalCoverageLabels, distributionRequestStatusLabels } from './request-ui';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import Eye from '@lucide/svelte/icons/eye';
	import XCircle from '@lucide/svelte/icons/x-circle';

	import type { CoverageKind } from './approval-coverage';

	interface Props {
		requests: DistributionRequest[];
		coverageMap?: ReadonlyMap<string, CoverageKind | 'unknown'>;
		canApprove?: boolean;
		canReject?: boolean;
		onView?: (request: DistributionRequest) => void;
		onApprove?: (request: DistributionRequest) => void;
		onReject?: (request: DistributionRequest) => void;
	}

	let {
		requests,
		coverageMap,
		canApprove = false,
		canReject = false,
		onView,
		onApprove,
		onReject
	}: Props = $props();

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

	function shortRequestId(id: string): string {
		return id.replace('distribution_request:', '').slice(0, 10);
	}

	function formatRequestedAt(value: string): string {
		return new Intl.DateTimeFormat('th-TH', {
			dateStyle: 'medium',
			timeStyle: 'short'
		}).format(new Date(value));
	}
</script>

<Table.Root>
	<Table.Header>
		<Table.Row>
			<Table.Head>คำร้อง</Table.Head>
			<Table.Head>วัตถุประสงค์</Table.Head>
			<Table.Head>ผู้ขอ</Table.Head>
			<Table.Head class="text-center">รายการ</Table.Head>
			<Table.Head>วันที่ขอ</Table.Head>
			<Table.Head>สถานะ</Table.Head>
			<Table.Head class="text-right">การดำเนินการ</Table.Head>
		</Table.Row>
	</Table.Header>
	<Table.Body>
		{#each requests as request (request._id)}
			<Table.Row class="hover:bg-muted/40">
				<Table.Cell class="font-mono text-xs font-semibold text-primary">
					{shortRequestId(request._id)}
				</Table.Cell>
				<Table.Cell class="max-w-64">
					<p class="truncate font-medium" title={request.purpose}>{request.purpose}</p>
				</Table.Cell>
				<Table.Cell>{request.requested_by}</Table.Cell>
				<Table.Cell class="text-center tabular-nums">{request.items.length}</Table.Cell>
				<Table.Cell class="whitespace-nowrap text-muted-foreground">
					{formatRequestedAt(request.requested_at)}
				</Table.Cell>
				<Table.Cell>
					<div class="flex flex-wrap items-center gap-1.5">
						<Badge variant="outline" class={badgeClasses[request.status]}>
							{distributionRequestStatusLabels[request.status]}
						</Badge>
						{#if request.status === 'approved'}
							{@const cov = coverageMap?.get(request._id)}
							{#if cov === 'partial'}
								<Badge
									variant="outline"
									class="border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
								>
									{approvalCoverageLabels.partial}
								</Badge>
							{:else if cov === 'full'}
								<span class="text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
									{approvalCoverageLabels.full}
								</span>
							{:else}
								<span class="text-[11px] text-muted-foreground">ไม่ทราบผลการจัดสรร</span>
							{/if}
						{/if}
					</div>
				</Table.Cell>
				<Table.Cell class="text-right">
					<div class="flex items-center justify-end gap-1.5">
						{#if onView}
							<Button
								variant="ghost"
								size="sm"
								class="h-8 gap-1.5 px-2.5 text-xs text-muted-foreground hover:text-foreground"
								onclick={() => onView(request)}
								title="ดูรายละเอียด"
							>
								<Eye class="size-3.5" />
								<span class="hidden sm:inline">รายละเอียด</span>
							</Button>
						{/if}

						{#if request.status === 'pending'}
							{#if canReject && onReject}
								<Button
									variant="outline"
									size="sm"
									class="h-8 gap-1.5 border-destructive/30 px-2.5 text-xs text-destructive hover:bg-destructive/10"
									onclick={() => onReject(request)}
									title="ปฏิเสธคำร้อง"
								>
									<XCircle class="size-3.5" />
									<span class="hidden md:inline">ปฏิเสธ</span>
								</Button>
							{/if}

							{#if canApprove && onApprove}
								<Button
									size="sm"
									class="h-8 gap-1.5 px-3 text-xs font-bold"
									onclick={() => onApprove(request)}
									title="อนุมัติเบิกจ่าย"
								>
									<CheckCircle2 class="size-3.5" />
									อนุมัติ
								</Button>
							{/if}
						{:else if request.status === 'approving'}
							<span class="text-[11px] font-medium text-blue-700">กำลังดำเนินการ</span>
						{/if}
					</div>
				</Table.Cell>
			</Table.Row>
		{/each}
	</Table.Body>
</Table.Root>
