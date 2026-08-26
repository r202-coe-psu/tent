<script lang="ts">
	import ClipboardCheck from '@lucide/svelte/icons/clipboard-check';
	import Search from '@lucide/svelte/icons/search';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import type { PendingDonationRow } from '$lib/features/donations';

	let {
		requests = [],
		loading = false,
		onViewDetails
	}: {
		requests: PendingDonationRow[];
		loading?: boolean;
		onViewDetails: (request: PendingDonationRow) => void;
	} = $props();

	function itemsSummary(req: PendingDonationRow): string {
		if (req.items.length === 0) return '—';
		return req.items
			.map((it) => `${it.free_text ?? it.item_id ?? 'ไม่ระบุ'} ${it.qty} ${it.unit}`)
			.join(', ');
	}
</script>

<div class="overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
	<!-- Section Header -->
	<div
		class="flex flex-col justify-between gap-4 border-b border-border/60 bg-muted/5 p-6 md:flex-row md:items-center"
	>
		<div>
			<h2 class="flex items-center gap-2 text-base font-bold text-foreground">
				<ClipboardCheck class="h-5 w-5 text-primary" />
				รายการรอการประเมิน (Pending Review Board)
			</h2>
			<p class="mt-1 text-[11px] text-muted-foreground">
				รายการบริจาคที่ยังไม่ผ่านการอนุมัติเข้าสู่การตรวจรับ —
				พิจารณาแล้วอนุมัติหรือปฏิเสธได้จากหน้านี้
			</p>
		</div>
	</div>
	<!-- Requests Table -->
	<div class="overflow-x-auto">
		<Table.Root class="w-full border-collapse text-left">
			<Table.Header>
				<Table.Row
					class="border-b border-border bg-muted/20 text-[11px] font-bold text-muted-foreground uppercase"
				>
					<Table.Head class="px-6 py-4">ผู้บริจาคและรหัสการจอง</Table.Head>
					<Table.Head class="px-6 py-4">รายการที่แจ้ง</Table.Head>
					<Table.Head class="px-6 py-4 text-center">การจัดการ</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body class="divide-y divide-border/60 text-xs">
				{#if loading}
					<Table.Row>
						<Table.Cell colspan={3} class="px-6 py-12 text-center text-muted-foreground">
							กำลังโหลดข้อมูล...
						</Table.Cell>
					</Table.Row>
				{:else}
					{#each requests as req (req.booking_ref)}
						<Table.Row class="transition-colors hover:bg-muted/5">
							<Table.Cell class="min-w-[220px] px-6 py-4">
								<div class="text-sm font-bold text-foreground">
									{req.donor_name || 'ไม่ระบุชื่อ'}
								</div>
								<div class="mt-2 flex flex-wrap items-center gap-2">
									<span
										class="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-extrabold text-amber-600 dark:bg-amber-950/40 dark:text-amber-400"
									>
										รอการประเมิน
									</span>
									<span
										class="rounded border border-border bg-muted/50 px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
									>
										{req.booking_ref}
									</span>
								</div>
							</Table.Cell>
							<Table.Cell class="min-w-[320px] px-6 py-4 text-muted-foreground">
								{itemsSummary(req)}
							</Table.Cell>
							<Table.Cell class="px-6 py-4 text-center">
								<Button
									onclick={() => onViewDetails(req)}
									class="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-xs font-bold text-primary-foreground shadow-xs transition-colors hover:bg-primary/90"
								>
									<Search class="h-3.5 w-3.5" />
									ดูรายละเอียด
								</Button>
							</Table.Cell>
						</Table.Row>
					{:else}
						<Table.Row>
							<Table.Cell colspan={3} class="px-6 py-12 text-center text-muted-foreground">
								ไม่มีรายการที่อยู่ระหว่างการรอการประเมิน
							</Table.Cell>
						</Table.Row>
					{/each}
				{/if}
			</Table.Body>
		</Table.Root>
	</div>
</div>
