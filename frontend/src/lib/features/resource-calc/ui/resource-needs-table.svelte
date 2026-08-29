<script lang="ts">
	import * as Table from '$lib/components/ui/table/index.js';
	import { RATIO_LABELS } from '$lib/features/sop-ratios';
	import type { SopRatioKey } from '$lib/features/sop-ratios';
	import { qtyGt, roundQtyNumber } from '$lib/utils/qty';
	import type { ResourceCalcResult } from '../domain/calc.formula';
	import { daysOfSupply, rowSeverity } from '../domain/dashboard-view';
	import { CATEGORY_LABELS, categoryOf } from './sop-category';
	import { SEVERITY_LABEL, severityBar, severityPill } from './severity-style';

	let { rows }: { rows: ResourceCalcResult[] } = $props();

	const nf = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 1 });
	/** Format a decimal-string quantity (CR-038) for display. */
	const fmtQty = (q: string) => nf.format(roundQtyNumber(q));

	const meta = (key: string) => RATIO_LABELS[key as SopRatioKey] ?? null;
	const label = (key: string) => meta(key)?.label ?? key;
	const unit = (key: string) => meta(key)?.unit ?? '';

	/** Days-of-supply bar width — full at ≥14 days. */
	const barPct = (dos: number) => Math.max(4, Math.min(100, (dos / 14) * 100));
</script>

<div class="overflow-x-auto rounded-2xl border border-border/80 bg-card">
	<Table.Root>
		<Table.Header class="bg-muted/50">
			<Table.Row>
				<Table.Head class="text-2xs font-bold tracking-wider text-foreground uppercase">
					หมวดหมู่ / ความต้องการ
				</Table.Head>
				<Table.Head class="text-right text-2xs font-bold tracking-wider text-foreground uppercase">
					เป้าหมายใช้/วัน
				</Table.Head>
				<Table.Head class="text-right text-2xs font-bold tracking-wider text-foreground uppercase">
					สต็อกปัจจุบัน
				</Table.Head>
				<Table.Head class="text-2xs font-bold tracking-wider text-foreground uppercase">
					ความคงเหลือ
				</Table.Head>
				<Table.Head class="text-2xs font-bold tracking-wider text-foreground uppercase">
					สถานะ
				</Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each rows as r (r.ordinal)}
				{@const sev = rowSeverity(r)}
				{@const dos = daysOfSupply(r)}
				<Table.Row>
					<!-- category + resource name -->
					<Table.Cell>
						<div class="flex items-center gap-2.5">
							<span class="h-8 w-1 shrink-0 rounded-full {severityBar(sev)}"></span>
							<div class="min-w-0">
								<div class="truncate text-sm font-semibold text-foreground">{label(r.key)}</div>
								<div class="text-xs text-muted-foreground">
									{CATEGORY_LABELS[categoryOf(r.key)]}
								</div>
							</div>
						</div>
					</Table.Cell>

					<!-- daily target (need) -->
					<Table.Cell class="text-right">
						{#if r.need != null}
							<span class="font-mono text-sm font-semibold text-foreground tabular-nums">
								{fmtQty(r.need)}
							</span>
							<span class="ml-1 text-xs text-muted-foreground">{unit(r.key)}</span>
						{:else}
							<span class="text-xs text-muted-foreground">—</span>
						{/if}
					</Table.Cell>

					<!-- current stock (have) -->
					<Table.Cell class="text-right">
						{#if r.have != null}
							<span class="font-mono text-sm text-foreground tabular-nums">{fmtQty(r.have)}</span>
						{:else}
							<span class="text-xs text-muted-foreground">รอสต็อก</span>
						{/if}
					</Table.Cell>

					<!-- days of supply -->
					<Table.Cell>
						{#if dos != null}
							<div class="flex items-center gap-2">
								<div class="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
									<div
										class="h-full rounded-full {severityBar(sev)}"
										style="width:{barPct(dos)}%"
									></div>
								</div>
								<span class="text-xs font-medium text-foreground tabular-nums">
									{nf.format(dos)} วัน
								</span>
							</div>
						{:else if r.kind === 'divide' && r.gap != null && qtyGt(r.gap, 0)}
							<span class="text-xs font-medium text-danger">ขาด {fmtQty(r.gap)} {unit(r.key)}</span>
						{:else}
							<span class="text-xs text-muted-foreground">—</span>
						{/if}
					</Table.Cell>

					<!-- status pill -->
					<Table.Cell>
						<span
							class="inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold {severityPill(
								sev
							)}"
						>
							{SEVERITY_LABEL[sev]}
						</span>
					</Table.Cell>
				</Table.Row>
			{/each}
		</Table.Body>
	</Table.Root>

	{#if rows.length === 0}
		<div class="px-4 py-10 text-center text-sm text-muted-foreground">ไม่มีรายการตรงกับตัวกรอง</div>
	{/if}
</div>
