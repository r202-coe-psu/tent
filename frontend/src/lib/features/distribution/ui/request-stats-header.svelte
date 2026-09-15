<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import type { DistributionRequest } from '../domain/distribution';
	import { summarizeDistributionRequests } from './request-ui';

	let { requests }: { requests: DistributionRequest[] } = $props();

	const summary = $derived(summarizeDistributionRequests(requests));
</script>

<section class="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="สรุปสถานะคำร้องเบิกจ่าย">
	<Card.Root class="border-border/80 shadow-xs">
		<Card.Content class="p-4">
			<p class="text-sm text-muted-foreground">รอดำเนินการ</p>
			<p class="mt-1 text-2xl font-bold tabular-nums">{summary.pending}</p>
		</Card.Content>
	</Card.Root>
	<Card.Root class="border-border/80 shadow-xs">
		<Card.Content class="p-4">
			<p class="text-sm text-muted-foreground">กำลังอนุมัติ</p>
			<p class="mt-1 text-2xl font-bold tabular-nums">{summary.approving}</p>
		</Card.Content>
	</Card.Root>
	<Card.Root class="border-border/80 shadow-xs">
		<Card.Content class="p-4">
			<p class="text-sm text-muted-foreground">อนุมัติแล้ว</p>
			<p class="mt-1 text-2xl font-bold tabular-nums">{summary.approved}</p>
		</Card.Content>
	</Card.Root>
	<Card.Root class="border-border/80 shadow-xs">
		<Card.Content class="p-4">
			<p class="text-sm text-muted-foreground">ปฏิเสธ / ยกเลิก</p>
			<p class="mt-1 text-2xl font-bold tabular-nums">{summary.closed}</p>
		</Card.Content>
	</Card.Root>
</section>
