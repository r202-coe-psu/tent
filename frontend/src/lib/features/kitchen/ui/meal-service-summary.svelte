<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import * as Table from '$lib/components/ui/table';
	import * as Pagination from '$lib/components/ui/pagination';
	import ClipboardCheck from '@lucide/svelte/icons/clipboard-check';
	import {
		useMealServices,
		useMealPlans,
		computeMealVariance,
		MEAL_PERIOD_LABELS,
		type MealPlan
	} from '$lib/features/kitchen';

	const services = useMealServices();
	const plans = useMealPlans();

	// Index plans by _id so each service finds its exact source plan —
	// meal_service.meal_plan_id links a record to the specific plan it reports
	// on, so this resolves correctly even when multiple plans share a date+meal
	// (extra batches).
	const planById = $derived.by(() => {
		const m: Record<string, MealPlan> = {};
		for (const p of plans.data ?? []) m[p._id] = p;
		return m;
	});

	// Newest first — created_at is the audit timestamp of the record.
	const rows = $derived.by(() =>
		[...(services.data ?? [])]
			.sort((a, b) => b.created_at.localeCompare(a.created_at))
			.map((svc) => {
				const plan = svc.meal_plan_id ? (planById[svc.meal_plan_id] ?? null) : null;
				return { svc, plan, v: computeMealVariance(svc, plan) };
			})
	);

	function formatTime(iso: string): string {
		return new Date(iso).toLocaleString('th-TH', {
			day: '2-digit',
			month: '2-digit',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	const PAGE_SIZE = 10;
	let currentPage = $state(1);
	const paginatedRows = $derived.by(() => {
		const start = (currentPage - 1) * PAGE_SIZE;
		return rows.slice(start, start + PAGE_SIZE);
	});
</script>

<Card.Root class="border-0 shadow-sm">
	<Card.Header class="flex flex-row items-start gap-3 py-4">
		<div class="rounded-lg bg-indigo-50 p-2">
			<ClipboardCheck class="h-4 w-4 text-indigo-600" />
		</div>
		<div>
			<Card.Title class="text-sm font-bold">
				สรุปผลบริการ vs แผน ({rows.length} มื้อ)
			</Card.Title>
			<Card.Description class="text-xs">
				เทียบยอดที่วางแผนกับที่เสิร์ฟจริง เหลือทิ้ง และแจกนอกศูนย์ — ใช้ทบทวนและปรับแผนรอบถัดไป
			</Card.Description>
		</div>
	</Card.Header>

	<Card.Content class="p-0">
		{#if services.isPending}
			<p class="p-6 text-center text-sm text-muted-foreground">กำลังโหลด...</p>
		{:else if !rows.length}
			<p class="p-6 text-center text-sm text-muted-foreground">ยังไม่มีการบันทึกผลบริการ</p>
		{:else}
			<div class="overflow-x-auto">
				<Table.Root>
					<Table.Header>
						<Table.Row class="text-xs">
							<Table.Head class="min-w-[160px] px-6">แผนต้นทาง</Table.Head>
							<Table.Head class="min-w-[80px] px-6 text-right">วางแผน</Table.Head>
							<Table.Head class="min-w-[100px] px-6 text-right">เสิร์ฟในศูนย์</Table.Head>
							<Table.Head class="min-w-[100px] px-6 text-right">เสิร์ฟนอกศูนย์</Table.Head>
							<Table.Head class="min-w-[80px] px-6 text-right">เหลือทิ้ง</Table.Head>
							<Table.Head class="min-w-[130px] px-6">ผู้บันทึก / เวลา</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each paginatedRows as { svc, plan, v } (svc._id)}
							<Table.Row>
								<Table.Cell class="px-6">
									<p class="text-sm font-medium">
										{plan?.label ?? MEAL_PERIOD_LABELS[svc.meal]}
									</p>
									<p class="text-xs text-muted-foreground">
										{#if plan?.label}{MEAL_PERIOD_LABELS[svc.meal]} ·
										{/if}<span class="font-mono">{svc.date}</span>
									</p>
									{#if !plan}
										<p class="text-xs text-gray-500">ไม่มีแผนอ้างอิง</p>
									{/if}
								</Table.Cell>
								<Table.Cell class="px-6 text-right text-sm">
									{v.planned === null ? '—' : v.planned.toLocaleString()}
								</Table.Cell>
								<Table.Cell class="px-6 text-right text-sm font-semibold">
									{v.served.toLocaleString()}
								</Table.Cell>
								<Table.Cell class="px-6 text-right text-sm">
									{v.external.toLocaleString()}
								</Table.Cell>
								<Table.Cell class="px-6 text-right text-sm {v.waste > 0 ? 'text-amber-700' : ''}">
									{v.waste.toLocaleString()}
								</Table.Cell>
								<Table.Cell class="px-6">
									<p class="text-sm">{svc.created_by}</p>
									<p class="text-xs text-muted-foreground">{formatTime(svc.created_at)}</p>
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</div>
			{#if rows.length > PAGE_SIZE}
				<div class="flex justify-end p-4">
					<Pagination.Root bind:page={currentPage} count={rows.length} perPage={PAGE_SIZE}>
						{#snippet children({ pages })}
							<Pagination.Content>
								<Pagination.Previous />
								{#each pages as p, i (p.type === 'page' ? `page-${p.value}` : `ellipsis-${i}`)}
									<Pagination.Item>
										{#if p.type === 'page'}
											<Pagination.Link page={p} isActive={p.value === currentPage} />
										{:else}
											<Pagination.Ellipsis />
										{/if}
									</Pagination.Item>
								{/each}
								<Pagination.Next />
							</Pagination.Content>
						{/snippet}
					</Pagination.Root>
				</div>
			{/if}
		{/if}
	</Card.Content>
</Card.Root>
