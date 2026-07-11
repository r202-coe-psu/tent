<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import * as Table from '$lib/components/ui/table';
	import PackageCheck from '@lucide/svelte/icons/package-check';
	import { useRequisitions, type KitchenRequisition } from '$lib/features/kitchen';

	const requisitions = useRequisitions();

	// Newest first — issued_at is the audit timestamp of the withdrawal.
	const rows = $derived(
		[...(requisitions.data ?? [])].sort((a, b) => b.issued_at.localeCompare(a.issued_at))
	);

	// A requisition is complete when every line issued the full requested qty;
	// otherwise stock was short and it was a partial withdrawal (schema.md §2.6).
	function isComplete(req: KitchenRequisition): boolean {
		return req.items.every((i) => i.qty_issued >= i.qty_requested);
	}

	function planLabel(id: string | null): string {
		if (!id) return 'เบิกนอกแผน';
		return id.split(':').slice(1).join(':') || id;
	}

	function formatTime(iso: string): string {
		return new Date(iso).toLocaleString('th-TH', {
			day: '2-digit',
			month: '2-digit',
			hour: '2-digit',
			minute: '2-digit'
		});
	}
</script>

<Card.Root class="border-0 shadow-sm">
	<Card.Header class="flex flex-row items-start gap-3 py-4">
		<div class="rounded-lg bg-emerald-50 p-2">
			<PackageCheck class="h-4 w-4 text-emerald-600" />
		</div>
		<div>
			<Card.Title class="text-sm font-bold">
				ประวัติการเบิกวัตถุดิบ ({rows.length} ใบ)
			</Card.Title>
			<Card.Description class="text-xs">
				บันทึกผู้เบิก เวลา รายการ และแผนต้นทาง (audit trail) — ตัดสต็อกผ่าน stock ledger
			</Card.Description>
		</div>
	</Card.Header>

	<Card.Content class="p-0">
		{#if requisitions.isPending}
			<p class="p-6 text-center text-sm text-muted-foreground">กำลังโหลด...</p>
		{:else if !rows.length}
			<p class="p-6 text-center text-sm text-muted-foreground">ยังไม่มีการเบิกวัตถุดิบ</p>
		{:else}
			<div class="overflow-x-auto">
				<Table.Root>
					<Table.Header>
						<Table.Row class="text-xs">
							<Table.Head class="min-w-[130px] px-6">เวลาเบิก</Table.Head>
							<Table.Head class="min-w-[120px] px-6">ผู้เบิก</Table.Head>
							<Table.Head class="min-w-[130px] px-6">แผนต้นทาง</Table.Head>
							<Table.Head class="min-w-[220px] px-6">รายการที่เบิก (จ่ายจริง / ขอเบิก)</Table.Head>
							<Table.Head class="min-w-[110px] px-6 text-center">สถานะ</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each rows as req (req._id)}
							<Table.Row>
								<Table.Cell class="px-6 text-xs text-muted-foreground">
									{formatTime(req.issued_at)}
								</Table.Cell>
								<Table.Cell class="px-6 text-sm">{req.created_by}</Table.Cell>
								<Table.Cell class="px-6 font-mono text-xs">{planLabel(req.meal_plan_id)}</Table.Cell
								>
								<Table.Cell class="px-6">
									<ul class="space-y-0.5 text-xs">
										{#each req.items as item (item.item_id)}
											<li>
												<span class="font-mono">{item.item_id}</span>:
												<span
													class="font-semibold {item.qty_issued < item.qty_requested
														? 'text-amber-700'
														: ''}"
												>
													{item.qty_issued.toLocaleString()}
												</span>
												/ {item.qty_requested.toLocaleString()}
												{item.unit}
											</li>
										{/each}
									</ul>
								</Table.Cell>
								<Table.Cell class="px-6 text-center">
									{#if isComplete(req)}
										<span
											class="inline-flex rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-800"
										>
											เบิกครบ
										</span>
									{:else}
										<span
											class="inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800"
										>
											เบิกบางส่วน
										</span>
									{/if}
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</div>
		{/if}
	</Card.Content>
</Card.Root>
