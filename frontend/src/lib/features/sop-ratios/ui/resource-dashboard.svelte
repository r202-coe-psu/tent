<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { useResourceCalc } from '../application/resource-calc';
	import {
		RESOURCE_CATEGORY_LABEL,
		severityOf,
		sortBySeverity,
		summarizeByCategory,
		type GapRow,
		type Severity
	} from '../domain/resource-calc';
	import TrendChart from './trend-chart.svelte';

	let { shelterCode }: { shelterCode: string | null } = $props();

	const query = useResourceCalc(() => shelterCode);
	const snapshot = $derived(query.data);
	const rows = $derived(snapshot ? sortBySeverity(snapshot.rows) : []);
	const summaries = $derived(snapshot ? summarizeByCategory(snapshot.rows) : []);

	let expandedId = $state<string | null>(null);
	const toggle = (id: string) => (expandedId = expandedId === id ? null : id);

	const nf = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 1 });
	const pct = new Intl.NumberFormat('th-TH', { style: 'percent', maximumFractionDigits: 0 });
	const fmtDateTime = (iso: string) =>
		new Date(iso).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });

	const SEVERITY_LABEL: Record<Severity, string> = {
		critical: 'วิกฤต',
		low: 'เริ่มขาด',
		ok: 'เพียงพอ'
	};

	// Theme tokens only — keeps the page consistent with other back-office screens.
	function sevBadge(s: Severity): string {
		if (s === 'critical') return 'bg-danger-muted text-danger';
		if (s === 'low') return 'bg-warning-muted text-warning-subtle';
		return 'bg-muted text-muted-foreground';
	}
	function sevBar(s: Severity): string {
		if (s === 'critical') return 'bg-danger';
		if (s === 'low') return 'bg-warning';
		return 'bg-chart-2';
	}
	const rowSeverity = (r: GapRow): Severity => severityOf(r.need, r.have);
</script>

<div class="flex flex-col gap-4">
	<header class="flex flex-col gap-0.5">
		<h1 class="text-lg font-bold">การประเมินทรัพยากรประจำวัน</h1>
		{#if snapshot}
			<p class="text-sm text-muted-foreground">
				ศูนย์ {snapshot.shelter_code} · ผู้พักพิง {nf.format(snapshot.occupancy)} คน · ข้อมูล ณ
				{fmtDateTime(snapshot.as_of)}
			</p>
		{/if}
	</header>

	{#if !shelterCode}
		<p class="text-sm text-muted-foreground">เลือกศูนย์พักพิงเพื่อดูการประเมินทรัพยากร</p>
	{:else if query.isPending}
		<p class="text-sm text-muted-foreground">กำลังคำนวณ…</p>
	{:else if query.isError}
		<p class="text-sm text-danger">โหลดข้อมูลไม่สำเร็จ: {query.error?.message}</p>
	{:else if snapshot}
		<!-- per-category summary -->
		<div class="grid gap-3 sm:grid-cols-3">
			{#each summaries as s (s.category)}
				<Card.Root>
					<Card.Header class="pb-2">
						<Card.Title class="flex items-center justify-between text-sm font-semibold">
							{s.label}
							<span class="rounded-full px-2 py-0.5 text-xs font-medium {sevBadge(s.severity)}">
								{SEVERITY_LABEL[s.severity]}
							</span>
						</Card.Title>
					</Card.Header>
					<Card.Content class="flex flex-col gap-2">
						<div class="flex items-baseline justify-between">
							<span class="text-2xl font-bold tabular-nums">{pct.format(s.coverage)}</span>
							<span class="text-xs text-muted-foreground">
								ขาด {nf.format(s.short_items)}/{nf.format(s.total_items)} รายการ
							</span>
						</div>
						<div class="h-1.5 w-full overflow-hidden rounded-full bg-muted">
							<div
								class="h-full rounded-full {sevBar(s.severity)}"
								style="width:{Math.round(s.coverage * 100)}%"
							></div>
						</div>
					</Card.Content>
				</Card.Root>
			{/each}
		</div>

		<!-- 7-day shortage trend (T-32.4) -->
		<TrendChart series={snapshot.trend} unitLabel="หน่วย" />

		<!-- shortage list, most severe first, with drill-down -->
		<Card.Root>
			<Card.Header class="pb-2">
				<Card.Title class="text-sm font-semibold">รายการที่ต้องเติม (เรียงตามความรุนแรง)</Card.Title
				>
			</Card.Header>
			<Card.Content class="flex flex-col divide-y">
				{#each rows as r (r.item_id)}
					{@const sev = rowSeverity(r)}
					<div class="py-1.5">
						<button
							type="button"
							class="flex w-full items-center justify-between gap-2 rounded px-1 py-1 text-left hover:bg-muted/50"
							onclick={() => toggle(r.item_id)}
							aria-expanded={expandedId === r.item_id}
						>
							<span class="flex min-w-0 items-center gap-2">
								<span class="h-2 w-2 shrink-0 rounded-full {sevBar(sev)}"></span>
								<span class="truncate text-sm font-medium">{r.label}</span>
								<span class="shrink-0 text-xs text-muted-foreground">
									{RESOURCE_CATEGORY_LABEL[r.category]}
								</span>
							</span>
							<span class="flex shrink-0 items-center gap-2 text-xs">
								{#if r.gap > 0}
									<span
										class="font-semibold tabular-nums {sev === 'critical'
											? 'text-danger'
											: 'text-warning-subtle'}"
									>
										ขาด {nf.format(r.gap)}
										{r.unit}
									</span>
								{:else}
									<span class="text-muted-foreground">เพียงพอ</span>
								{/if}
								<span class="rounded-full px-2 py-0.5 font-medium {sevBadge(sev)}">
									{SEVERITY_LABEL[sev]}
								</span>
							</span>
						</button>

						{#if expandedId === r.item_id}
							<dl
								class="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 rounded bg-muted/30 px-3 py-2 text-xs text-muted-foreground sm:grid-cols-4"
							>
								<div>
									<dt>ผู้พักพิง</dt>
									<dd class="text-foreground tabular-nums">
										{nf.format(r.provenance.occupancy)} คน
									</dd>
								</div>
								<div>
									<dt>อัตราส่วน (SOP)</dt>
									<dd class="flex flex-wrap items-center gap-1 text-foreground">
										<span class="tabular-nums">{nf.format(r.provenance.ratio)}/คน</span>
										<span
											class="rounded px-1 {r.ratio_source === 'override'
												? 'bg-warning-muted text-warning-subtle'
												: 'bg-muted'}"
										>
											{r.ratio_source === 'override' ? 'ค่าเฉพาะศูนย์' : 'ค่ากลาง'}
										</span>
									</dd>
								</div>
								<div>
									<dt>ต้องการ</dt>
									<dd class="text-foreground tabular-nums">{nf.format(r.need)} {r.unit}</dd>
								</div>
								<div>
									<dt>คงเหลือ</dt>
									<dd class="text-foreground tabular-nums">{nf.format(r.have)} {r.unit}</dd>
								</div>
								<div class="col-span-full">
									<dt class="inline">ข้อมูล ณ</dt>
									<dd class="inline">{fmtDateTime(r.provenance.as_of)}</dd>
								</div>
							</dl>
						{/if}
					</div>
				{/each}
			</Card.Content>
		</Card.Root>

		<p class="text-xs text-muted-foreground">
			* ตัวเลขเป็นข้อมูลตัวอย่างชั่วคราว — รอเชื่อมกับเครื่องคำนวณ T-31 (FR-45)
		</p>
	{/if}
</div>
