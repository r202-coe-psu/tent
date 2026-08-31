<script lang="ts">
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import type { DistributionRequest, DistributionRequestStatus } from '../domain/distribution';
	import { distributionRequestStatusLabels } from './request-ui';

	let { requests }: { requests: DistributionRequest[] } = $props();

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
		</Table.Row>
	</Table.Header>
	<Table.Body>
		{#each requests as request (request._id)}
			<Table.Row>
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
					<Badge variant="outline" class={badgeClasses[request.status]}>
						{distributionRequestStatusLabels[request.status]}
					</Badge>
				</Table.Cell>
			</Table.Row>
		{/each}
	</Table.Body>
</Table.Root>
