<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import * as Table from '$lib/components/ui/table';
	import * as Pagination from '$lib/components/ui/pagination';
	import { Badge } from '$lib/components/ui/badge';
	import PackageCheck from '@lucide/svelte/icons/package-check';
	import {
		useRequisitions,
		useMealPlans,
		MEAL_PERIOD_LABELS,
		toMealPlanMap
	} from '$lib/features/kitchen';
	import { useTickets, TICKET_STATUS_LABELS } from '$lib/features/tickets';
	import { formatThaiDateTime } from '$lib/utils/date';
	import { qtyGte } from '$lib/utils/qty';
	import { formatUnit, useUnitsOfMeasure } from '$lib/features/catalog';
	import { langState } from '$lib/states/i18n.svelte';

	const requisitions = useRequisitions();
	const tickets = useTickets();
	const plans = useMealPlans();
	const planById = $derived(toMealPlanMap(plans.data));
	const unitsQuery = useUnitsOfMeasure();
	const units = $derived(unitsQuery.data ?? []);

	// Union row shape — CR-139 §2.3: legacy kitchen_requisition (deprecated,
	// read-only) and requisition_ticket (new) shown together, newest first, with
	// a "ประเภท" column so an auditor can tell which pipeline produced each row.
	interface HistoryRow {
		kind: 'legacy' | 'ticket';
		id: string;
		timestamp: string;
		createdBy: string;
		mealPlanId: string | null;
		items: { key: string; label: string; done: string; requested: string; unit: string }[];
		statusLabel: string;
		statusClass: string;
	}

	const COMPLETE_CLASS = 'bg-green-100 text-green-800';
	const PARTIAL_CLASS = 'bg-amber-100 text-amber-800';
	const TICKET_STATUS_CLASS: Record<string, string> = {
		PENDING_PICK: 'bg-amber-100 text-amber-800',
		READY_FOR_DISPATCH: 'bg-blue-100 text-blue-800',
		IN_TRANSIT: 'bg-indigo-100 text-indigo-800',
		COMPLETED: COMPLETE_CLASS,
		CANCELLED: 'bg-muted text-muted-foreground'
	};

	const rows = $derived.by((): HistoryRow[] => {
		const legacy: HistoryRow[] = (requisitions.data ?? []).map((req) => {
			const complete = req.items.every((i) => qtyGte(i.qty_issued, i.qty_requested));
			return {
				kind: 'legacy',
				id: req._id,
				timestamp: req.issued_at ?? req.created_at,
				createdBy: req.created_by,
				mealPlanId: req.meal_plan_id,
				items: req.items.map((i) => ({
					key: i.item_id,
					label: i.item_id,
					done: i.qty_issued,
					requested: i.qty_requested,
					unit: i.unit
				})),
				statusLabel: complete ? 'เบิกครบ' : 'เบิกบางส่วน',
				statusClass: complete ? COMPLETE_CLASS : PARTIAL_CLASS
			};
		});
		const ticketRows: HistoryRow[] = (tickets.data ?? []).map((t) => ({
			kind: 'ticket',
			id: t._id,
			timestamp: t.created_at,
			createdBy: t.requested_by,
			mealPlanId: t.meal_plan_id,
			items: t.items.map((i) => ({
				key: i.item_id,
				label: i.item_name,
				done: i.allocated_qty,
				requested: i.requested_qty,
				unit: i.unit
			})),
			statusLabel: `${t.ticket_no} · ${TICKET_STATUS_LABELS[t.status]}`,
			statusClass: TICKET_STATUS_CLASS[t.status] ?? PARTIAL_CLASS
		}));
		return [...legacy, ...ticketRows].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
	});

	const PAGE_SIZE = 10;
	let currentPage = $state(1);
	const paginatedRows = $derived.by(() => {
		const start = (currentPage - 1) * PAGE_SIZE;
		return rows.slice(start, start + PAGE_SIZE);
	});
</script>

<Card.Root class="border-0 shadow-sm">
	<Card.Header class="flex flex-row items-start gap-3 py-4">
		<div class="rounded-lg bg-emerald-50 p-2">
			<PackageCheck class="h-4 w-4 text-emerald-600" />
		</div>
		<div>
			<Card.Title class="text-sm font-bold">
				ประวัติการเบิกวัตถุดิบ ({rows.length} รายการ)
			</Card.Title>
			<Card.Description class="text-xs">
				รวมตั๋วเบิกใหม่ (requisition_ticket) และใบเบิกเดิม (kitchen_requisition — เลิกใช้แล้ว,
				อ่านได้อย่างเดียว)
			</Card.Description>
		</div>
	</Card.Header>

	<Card.Content class="p-0">
		{#if requisitions.isPending || tickets.isPending}
			<p class="p-6 text-center text-sm text-muted-foreground">กำลังโหลด...</p>
		{:else if !rows.length}
			<p class="p-6 text-center text-sm text-muted-foreground">ยังไม่มีการเบิกวัตถุดิบ</p>
		{:else}
			<div class="overflow-x-auto">
				<Table.Root>
					<Table.Header>
						<Table.Row class="text-xs">
							<Table.Head class="min-w-[80px] px-6">ประเภท</Table.Head>
							<Table.Head class="min-w-[130px] px-6">เวลาเบิก</Table.Head>
							<Table.Head class="min-w-[120px] px-6">ผู้เบิก</Table.Head>
							<Table.Head class="min-w-[130px] px-6">แผนต้นทาง</Table.Head>
							<Table.Head class="min-w-[220px] px-6">รายการที่เบิก (จัดของแล้ว / ขอเบิก)</Table.Head
							>
							<Table.Head class="min-w-[140px] px-6 text-center">สถานะ</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each paginatedRows as row (row.id)}
							{@const plan = row.mealPlanId ? (planById[row.mealPlanId] ?? null) : null}
							<Table.Row>
								<Table.Cell class="px-6">
									<Badge variant="outline" class="font-mono text-2xs">
										{row.kind === 'ticket' ? 'ตั๋วใหม่' : 'ใบเบิกเดิม'}
									</Badge>
								</Table.Cell>
								<Table.Cell class="px-6 text-xs text-muted-foreground">
									{formatThaiDateTime(row.timestamp)}
								</Table.Cell>
								<Table.Cell class="px-6 text-sm">{row.createdBy}</Table.Cell>
								<Table.Cell class="px-6">
									{#if !row.mealPlanId}
										<p class="text-sm text-muted-foreground">เบิกนอกแผน</p>
									{:else if !plan}
										<p class="text-sm text-muted-foreground">ไม่พบแผน</p>
									{:else}
										<p class="text-sm font-medium">
											{plan.label ?? MEAL_PERIOD_LABELS[plan.meal]}
										</p>
										<p class="text-xs text-muted-foreground">
											{#if plan.label}{MEAL_PERIOD_LABELS[plan.meal]} ·
											{/if}<span class="font-mono">{plan.date}</span>
										</p>
									{/if}
								</Table.Cell>
								<Table.Cell class="px-6">
									<ul class="space-y-0.5 text-xs">
										{#each row.items as item (item.key)}
											<li>
												<span class="font-mono">{item.label}</span>:
												<span
													class="font-semibold {!qtyGte(item.done, item.requested)
														? 'text-amber-700'
														: ''}"
												>
													{item.done}
												</span>
												/ {item.requested}
												{formatUnit(item.unit, units, langState.current)}
											</li>
										{/each}
									</ul>
								</Table.Cell>
								<Table.Cell class="px-6 text-center">
									<span
										class="inline-flex rounded-full px-2.5 py-1 text-xs font-medium {row.statusClass}"
									>
										{row.statusLabel}
									</span>
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
