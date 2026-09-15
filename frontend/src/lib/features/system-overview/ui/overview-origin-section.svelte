<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import * as Table from '$lib/components/ui/table';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import type { OriginBucket } from '../domain/schemas';

	let {
		buckets,
		loading = false
	}: {
		buckets: OriginBucket[] | undefined;
		loading?: boolean;
	} = $props();
</script>

<Card.Root class="rounded-2xl border border-slate-200/80 bg-white shadow-2xs">
	<Card.Header>
		<Card.Title class="text-lg font-bold text-slate-900">ต้นทาง (ที่อยู่)</Card.Title>
		<Card.Description class="text-sm text-slate-500">
			จำนวนตามจังหวัด / อำเภอ / ตำบล
		</Card.Description>
	</Card.Header>
	<Card.Content>
		{#if loading && !buckets}
			<Skeleton class="h-40 w-full rounded-xl" />
		{:else if !buckets || buckets.length === 0}
			<p class="py-6 text-center text-sm text-slate-500">ไม่พบข้อมูลต้นทาง</p>
		{:else}
			<div class="overflow-x-auto rounded-xl border border-slate-200/80">
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>จังหวัด</Table.Head>
							<Table.Head>อำเภอ</Table.Head>
							<Table.Head>ตำบล</Table.Head>
							<Table.Head class="text-right">จำนวน</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each buckets as row, i (`${row.province}|${row.district}|${row.subdistrict}|${i}`)}
							<Table.Row>
								<Table.Cell class="font-medium text-slate-900">{row.province}</Table.Cell>
								<Table.Cell class="text-slate-700">{row.district ?? '—'}</Table.Cell>
								<Table.Cell class="text-slate-700">{row.subdistrict ?? '—'}</Table.Cell>
								<Table.Cell class="text-right font-semibold text-slate-900 tabular-nums">
									{row.count}
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</div>
		{/if}
	</Card.Content>
</Card.Root>
