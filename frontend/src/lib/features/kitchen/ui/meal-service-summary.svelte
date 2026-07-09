<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import * as Table from '$lib/components/ui/table';
	import ClipboardCheck from '@lucide/svelte/icons/clipboard-check';
	import {
		useMealServices,
		useMealPlans,
		computeMealVariance,
		MEAL_PERIOD_LABELS,
		type MealPlan,
		type MealVarianceStatus
	} from '$lib/features/kitchen';

	const services = useMealServices();
	const plans = useMealPlans();

	// Index plans by "date:meal" — the shared deterministic key both meal_plan and
	// meal_service ids are built from — so each service finds its source plan. Plain
	// record (not a Map): a throwaway lookup table, no reactive-collection semantics.
	const planByKey = $derived.by(() => {
		const m: Record<string, MealPlan> = {};
		for (const p of plans.data ?? []) m[`${p.date}:${p.meal}`] = p;
		return m;
	});

	// Newest first — created_at is the audit timestamp of the record.
	const rows = $derived.by(() =>
		[...(services.data ?? [])]
			.sort((a, b) => b.created_at.localeCompare(a.created_at))
			.map((svc) => {
				const plan = planByKey[`${svc.date}:${svc.meal}`];
				return { svc, plan, v: computeMealVariance(svc, plan) };
			})
	);

	const STATUS: Record<MealVarianceStatus, { label: string; class: string }> = {
		on_target: { label: 'ตรงแผน', class: 'bg-green-100 text-green-800' },
		over: { label: 'เกินแผน', class: 'bg-blue-100 text-blue-800' },
		under: { label: 'ต่ำกว่าแผน', class: 'bg-amber-100 text-amber-800' },
		no_plan: { label: 'ไม่มีแผนอ้างอิง', class: 'bg-gray-100 text-gray-600' }
	};

	function formatTime(iso: string): string {
		return new Date(iso).toLocaleString('th-TH', {
			day: '2-digit',
			month: '2-digit',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function signed(n: number): string {
		return `${n >= 0 ? '+' : ''}${n.toLocaleString()}`;
	}
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
							<Table.Head class="min-w-[150px] px-6">มื้อ (วัน:มื้อ)</Table.Head>
							<Table.Head class="min-w-[80px] px-6 text-right">วางแผน</Table.Head>
							<Table.Head class="min-w-[80px] px-6 text-right">เสิร์ฟ</Table.Head>
							<Table.Head class="min-w-[80px] px-6 text-right">เหลือทิ้ง</Table.Head>
							<Table.Head class="min-w-[90px] px-6 text-right">นอกศูนย์</Table.Head>
							<Table.Head class="min-w-[110px] px-6 text-right">ผลต่าง</Table.Head>
							<Table.Head class="min-w-[110px] px-6 text-center">สถานะ</Table.Head>
							<Table.Head class="min-w-[130px] px-6">ผู้บันทึก / เวลา</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each rows as { svc, v } (svc._id)}
							<Table.Row>
								<Table.Cell class="px-6">
									<p class="text-sm font-medium">{MEAL_PERIOD_LABELS[svc.meal]}</p>
									<p class="font-mono text-xs text-muted-foreground">{svc.date}</p>
								</Table.Cell>
								<Table.Cell class="px-6 text-right text-sm">
									{v.planned === null ? '—' : v.planned.toLocaleString()}
								</Table.Cell>
								<Table.Cell class="px-6 text-right text-sm font-semibold">
									{v.served.toLocaleString()}
								</Table.Cell>
								<Table.Cell class="px-6 text-right text-sm {v.waste > 0 ? 'text-amber-700' : ''}">
									{v.waste.toLocaleString()}
								</Table.Cell>
								<Table.Cell class="px-6 text-right text-sm"
									>{v.external.toLocaleString()}</Table.Cell
								>
								<Table.Cell class="px-6 text-right text-sm">
									{#if v.variance_pct === null}
										<span class="text-muted-foreground">—</span>
									{:else}
										<span
											class="font-semibold {v.variance < 0
												? 'text-amber-700'
												: v.variance > 0
													? 'text-blue-700'
													: 'text-emerald-700'}"
										>
											{signed(v.variance)}
										</span>
										<span class="text-xs text-muted-foreground">
											({signed(Math.round(v.variance_pct))}%)
										</span>
									{/if}
								</Table.Cell>
								<Table.Cell class="px-6 text-center">
									<span
										class="inline-flex rounded-full px-2.5 py-1 text-xs font-medium {STATUS[
											v.status
										].class}"
									>
										{STATUS[v.status].label}
									</span>
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
		{/if}
	</Card.Content>
</Card.Root>
