<script lang="ts">
	import * as Table from '$lib/components/ui/table/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { RATIO_LABELS } from '$lib/features/sop-ratios';
	import Decimal from 'decimal.js';
	import type { ScenarioComparisonRow, ScenarioResult } from '../domain/scenario.schema';
	import {
		formatScenarioQuantity,
		scenarioAvailabilityLabel,
		scenarioKindLabel,
		scenarioRequirementLabel,
		scenarioStockBalanceLabel,
		scenarioStockBalanceState,
		type ScenarioStockBalanceState
	} from '../domain/scenario-display';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import Clock from '@lucide/svelte/icons/clock';
	import Info from '@lucide/svelte/icons/info';

	let { result }: { result: ScenarioResult } = $props();
	const number = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 });
	const overriddenCount = $derived(result.comparison.filter((row) => row.ratio_overridden).length);
	const currentShortfallCount = $derived(
		result.comparison.filter((row) => scenarioStockBalanceState(row, 'current') === 'shortage')
			.length
	);
	const scenarioShortfallCount = $derived(
		result.comparison.filter((row) => scenarioStockBalanceState(row, 'scenario') === 'shortage')
			.length
	);
	const newlyShortCount = $derived(
		result.comparison.filter(
			(row) =>
				scenarioStockBalanceState(row, 'scenario') === 'shortage' &&
				scenarioStockBalanceState(row, 'current') !== 'shortage'
		).length
	);
	const missingStockCount = $derived(
		result.comparison.filter((row) => scenarioStockBalanceState(row, 'scenario') === 'missing')
			.length
	);

	const dailyNeed = (row: ScenarioComparisonRow, side: 'current' | 'scenario') =>
		formatScenarioQuantity(side === 'current' ? row.current_daily_need : row.scenario_daily_need);

	const requirement = (row: ScenarioComparisonRow, side: 'current' | 'scenario') => {
		if (row.kind !== 'threshold') return scenarioRequirementLabel(row, side);
		const ratio = side === 'current' ? row.current_ratio : row.scenario_ratio;
		return `เกณฑ์ ≤ ${formatScenarioQuantity(ratio)}`;
	};

	const balanceClass = (state: ScenarioStockBalanceState) =>
		`stock-balance stock-balance--${state}`;

	const needChangeLabel = (row: ScenarioComparisonRow) => {
		if (row.kind === 'threshold' || row.need_delta === null) return '—';
		const delta = new Decimal(row.need_delta);
		if (delta.isZero()) return 'เท่าเดิม';
		return `${delta.gt(0) ? 'เพิ่ม' : 'ลด'} ${formatScenarioQuantity(delta.abs().toString())}`;
	};

	const needChangeClass = (row: ScenarioComparisonRow) => {
		if (row.kind === 'threshold' || row.need_delta === null) return 'need-change';
		const delta = new Decimal(row.need_delta);
		if (delta.gt(0)) return 'need-change need-change--increase';
		if (delta.lt(0)) return 'need-change need-change--decrease';
		return 'need-change';
	};
</script>

<div class="compare-stack">
	<div class="compare-occupancy">
		<div class="compare-side">
			<div class="compare-side-label"><span class="compare-dot"></span>Current</div>
			<p class="compare-occupancy-value">{number.format(result.current.occupancy)}</p>
			<p class="compare-occupancy-unit">คน · {result.input.days} วัน</p>
		</div>
		<div class="compare-arrow" aria-hidden="true"><ArrowRight class="size-4" /></div>
		<div class="compare-side compare-side--scenario">
			<div class="compare-side-label"><span class="compare-dot"></span>Scenario</div>
			<p class="compare-occupancy-value">{number.format(result.scenario.occupancy)}</p>
			<p class="compare-occupancy-unit">คน · {result.input.days} วัน</p>
		</div>
	</div>

	<div class="compare-mode-line">
		<Badge variant={overriddenCount > 0 ? 'secondary' : 'outline'}>
			{overriddenCount > 0 ? 'ปรับเกณฑ์ใน Scenario' : 'จำลองทั่วไป'}
		</Badge>
		<span
			>{overriddenCount > 0
				? `ปรับอัตราเฉพาะผลจำลอง ${overriddenCount} รายการ`
				: 'ใช้เกณฑ์ SOP ปัจจุบันทั้งหมด'}</span
		>
	</div>

	<div class="compare-summary-grid" aria-label="สรุปผลเทียบ Stock">
		<div class="compare-summary-item">
			<span>ปัจจุบันขาด</span><strong>{currentShortfallCount}</strong><small>รายการ</small>
		</div>
		<div class="compare-summary-item compare-summary-item--scenario">
			<span>Scenario ขาด</span><strong>{scenarioShortfallCount}</strong><small>รายการ</small>
		</div>
		<div class="compare-summary-item">
			<span>ขาดเพิ่ม</span><strong>{newlyShortCount}</strong><small>จากปัจจุบัน</small>
		</div>
		<div class="compare-summary-item">
			<span>รอข้อมูล Stock</span><strong>{missingStockCount}</strong><small>รายการ</small>
		</div>
	</div>

	<details class="compare-assumptions">
		<summary><Info class="size-4" /> วิธีอ่านผลและรายละเอียดการคำนวณ</summary>
		<div>
			<p>
				Current และ Scenario ใช้ Stock snapshot ชุดเดียวกัน ณ เวลาเดียวกัน ตลอด {result.input.days} วันสมมุติให้จำนวนผู้พักพิงและอัตราคงที่
				ส่วนรายการที่ต้องใช้พร้อมกัน เช่น ห้องน้ำ จะไม่คูณจำนวนวัน
			</p>
			<div class="compare-metadata">
				<span
					><Clock class="size-3.5" />ข้อมูล ณ {new Date(result.snapshot.as_of).toLocaleString(
						'th-TH'
					)}</span
				>
				<span>สูตร {result.snapshot.formula_v}</span>
				<span>มาตรฐาน v{result.snapshot.profile.effective_version}</span>
			</div>
		</div>
	</details>

	<div class="compare-table-wrap hidden md:block">
		<Table.Root class="compare-table">
			<Table.Header>
				<Table.Row class="bg-muted/40">
					<Table.Head class="w-[19%]">ทรัพยากร</Table.Head>
					<Table.Head class="w-[14%] text-right">มีอยู่ปัจจุบัน</Table.Head>
					<Table.Head class="w-[16%] text-right">ต้องใช้ปัจจุบัน</Table.Head>
					<Table.Head class="w-[16%] text-right">ต้องใช้ใน Scenario</Table.Head>
					<Table.Head class="w-[22%]">ผลเทียบ Stock</Table.Head>
					<Table.Head class="w-[13%] text-right">ความต้องการที่เปลี่ยน</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each result.comparison as row (row.key)}
					{@const meta = RATIO_LABELS[row.key]}
					{@const currentBalance = scenarioStockBalanceState(row, 'current')}
					{@const scenarioBalance = scenarioStockBalanceState(row, 'scenario')}
					<Table.Row>
						<Table.Cell class="align-top">
							<div class="font-semibold">{meta.label}</div>
							<div class="resource-meta">
								{meta.unit} · {scenarioKindLabel(row, result.input.days)}
							</div>
							{#if row.ratio_overridden}<div class="ratio-change">
									{formatScenarioQuantity(row.current_ratio)} → {formatScenarioQuantity(
										row.scenario_ratio
									)}
								</div>{/if}
						</Table.Cell>
						<Table.Cell class="text-right align-top tabular-nums"
							><small>{row.kind === 'threshold' ? 'ค่าที่ตรวจพบ' : 'Stock ปัจจุบัน'}</small><strong
								>{scenarioAvailabilityLabel(row)}</strong
							></Table.Cell
						>
						<Table.Cell class="text-right align-top tabular-nums"
							><strong>{requirement(row, 'current')}</strong>{#if row.kind === 'multiply'}<small
									>{dailyNeed(row, 'current')} / วัน</small
								>{/if}</Table.Cell
						>
						<Table.Cell class="text-right align-top tabular-nums"
							><strong>{requirement(row, 'scenario')}</strong>{#if row.kind === 'multiply'}<small
									>{dailyNeed(row, 'scenario')} / วัน</small
								>{/if}</Table.Cell
						>
						<Table.Cell class="align-top">
							<div class="balance-pair">
								<span>Current</span><b class={balanceClass(currentBalance)}
									>{scenarioStockBalanceLabel(row, 'current')}</b
								>
								<span>Scenario</span><b class={balanceClass(scenarioBalance)}
									>{scenarioStockBalanceLabel(row, 'scenario')}</b
								>
							</div>
						</Table.Cell>
						<Table.Cell class="text-right align-top"
							><strong class={needChangeClass(row)}>{needChangeLabel(row)}</strong></Table.Cell
						>
					</Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
	</div>

	<div class="compare-mobile-list md:hidden">
		{#each result.comparison as row (row.key)}
			{@const meta = RATIO_LABELS[row.key]}
			{@const currentBalance = scenarioStockBalanceState(row, 'current')}
			{@const scenarioBalance = scenarioStockBalanceState(row, 'scenario')}
			<article class="compare-mobile-row">
				<header>
					<div>
						<h4>{meta.label}</h4>
						<p>{meta.unit} · {scenarioKindLabel(row, result.input.days)}</p>
					</div>
					{#if row.ratio_overridden}<Badge variant="secondary">ปรับเกณฑ์</Badge>{/if}
				</header>
				{#if row.ratio_overridden}<p class="ratio-change">
						อัตรา {formatScenarioQuantity(row.current_ratio)} → {formatScenarioQuantity(
							row.scenario_ratio
						)}
					</p>{/if}
				<div class="mobile-stock">
					<span>{row.kind === 'threshold' ? 'ค่าที่ตรวจพบ' : 'มีอยู่ปัจจุบัน'}</span><strong
						>{scenarioAvailabilityLabel(row)}</strong
					>
				</div>
				<div class="compare-mobile-grid">
					<div>
						<span>Current</span><strong>{requirement(row, 'current')}</strong><b
							class={balanceClass(currentBalance)}>{scenarioStockBalanceLabel(row, 'current')}</b
						>
					</div>
					<div>
						<span>Scenario</span><strong>{requirement(row, 'scenario')}</strong><b
							class={balanceClass(scenarioBalance)}>{scenarioStockBalanceLabel(row, 'scenario')}</b
						>
					</div>
				</div>
				<footer>
					<span>ความต้องการที่เปลี่ยน</span><strong class={needChangeClass(row)}
						>{needChangeLabel(row)}</strong
					>
				</footer>
			</article>
		{/each}
	</div>
</div>

<style>
	.compare-stack {
		display: grid;
		gap: 0.75rem;
	}
	.compare-occupancy {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
		overflow: hidden;
		border: 1px solid var(--border);
		border-radius: 0.7rem;
	}
	.compare-side {
		padding: 0.85rem 1rem;
	}
	.compare-side--scenario {
		background: color-mix(in srgb, var(--primary) 5%, var(--background));
	}
	.compare-side-label {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.68rem;
		font-weight: 750;
		color: var(--muted-foreground);
	}
	.compare-side--scenario .compare-side-label {
		color: var(--primary);
	}
	.compare-dot {
		width: 0.4rem;
		height: 0.4rem;
		border-radius: 999px;
		background: currentColor;
	}
	.compare-occupancy-value {
		margin-top: 0.25rem;
		font-size: clamp(1.45rem, 3vw, 2rem);
		font-weight: 900;
		line-height: 1;
		font-variant-numeric: tabular-nums;
	}
	.compare-occupancy-unit {
		margin-top: 0.25rem;
		font-size: 0.68rem;
		color: var(--muted-foreground);
	}
	.compare-arrow {
		display: grid;
		place-items: center;
		border-inline: 1px solid var(--border);
		padding-inline: 0.6rem;
		color: var(--primary);
	}
	.compare-mode-line {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.68rem;
		color: var(--muted-foreground);
	}
	.compare-summary-grid {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 0.45rem;
	}
	.compare-summary-item {
		display: grid;
		border: 1px solid var(--border);
		border-radius: 0.55rem;
		padding: 0.6rem 0.65rem;
	}
	.compare-summary-item--scenario {
		border-color: color-mix(in srgb, var(--primary) 35%, var(--border));
		background: color-mix(in srgb, var(--primary) 4%, var(--background));
	}
	.compare-summary-item span,
	.compare-summary-item small {
		font-size: 0.62rem;
		color: var(--muted-foreground);
	}
	.compare-summary-item strong {
		font-size: 1.05rem;
		font-variant-numeric: tabular-nums;
	}
	.compare-assumptions {
		border: 1px solid var(--border);
		border-radius: 0.6rem;
		background: var(--muted);
	}
	.compare-assumptions summary {
		display: flex;
		min-height: 2.5rem;
		align-items: center;
		gap: 0.45rem;
		padding: 0.5rem 0.7rem;
		cursor: pointer;
		font-size: 0.7rem;
		font-weight: 750;
	}
	.compare-assumptions > div {
		display: grid;
		gap: 0.5rem;
		border-top: 1px solid var(--border);
		padding: 0.7rem;
	}
	.compare-assumptions p,
	.compare-metadata {
		font-size: 0.68rem;
		line-height: 1.55;
		color: var(--muted-foreground);
	}
	.compare-metadata {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem 0.8rem;
	}
	.compare-metadata span {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
	}
	.compare-table-wrap {
		max-height: 34rem;
		overflow: auto;
		border: 1px solid var(--border);
		border-radius: 0.65rem;
	}
	.compare-table {
		width: 100%;
		min-width: 900px;
		table-layout: fixed;
	}
	.compare-table :global(thead) {
		position: sticky;
		top: 0;
		z-index: 2;
		background: var(--card);
	}
	.compare-table :global(td small),
	.compare-table :global(td strong) {
		display: block;
	}
	.compare-table :global(td small),
	.resource-meta {
		margin-top: 0.2rem;
		font-size: 0.62rem;
		color: var(--muted-foreground);
	}
	.ratio-change {
		margin-top: 0.35rem;
		font-size: 0.63rem;
		font-weight: 750;
		color: var(--primary);
		font-variant-numeric: tabular-nums;
	}
	.balance-pair {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: 0.25rem 0.45rem;
		align-items: center;
		font-size: 0.65rem;
	}
	.balance-pair span {
		color: var(--muted-foreground);
	}
	.stock-balance {
		font-size: 0.68rem;
		font-weight: 800;
	}
	.stock-balance--missing,
	.stock-balance--not_applicable,
	.need-change {
		color: var(--muted-foreground);
	}
	.need-change {
		font-size: 0.72rem;
	}
	.stock-balance--shortage,
	.need-change--increase {
		color: var(--destructive);
	}
	.stock-balance--surplus,
	.stock-balance--balanced,
	.need-change--decrease {
		color: var(--success-dark);
	}
	.compare-mobile-list {
		display: grid;
		gap: 0.55rem;
	}
	.compare-mobile-row {
		border: 1px solid var(--border);
		border-radius: 0.65rem;
		padding: 0.75rem;
	}
	.compare-mobile-row header,
	.compare-mobile-row footer,
	.mobile-stock {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.65rem;
	}
	.compare-mobile-row h4 {
		font-size: 0.85rem;
		font-weight: 800;
	}
	.compare-mobile-row header p,
	.mobile-stock span,
	.compare-mobile-row footer span {
		font-size: 0.63rem;
		color: var(--muted-foreground);
	}
	.mobile-stock {
		margin-top: 0.6rem;
		border-block: 1px solid var(--border);
		padding-block: 0.5rem;
	}
	.mobile-stock strong {
		font-size: 0.8rem;
	}
	.compare-mobile-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.45rem;
		margin-top: 0.55rem;
	}
	.compare-mobile-grid > div {
		display: grid;
		gap: 0.18rem;
		border-radius: 0.45rem;
		background: var(--muted);
		padding: 0.5rem;
	}
	.compare-mobile-grid span {
		font-size: 0.62rem;
		color: var(--muted-foreground);
	}
	.compare-mobile-grid strong {
		font-size: 0.8rem;
		font-variant-numeric: tabular-nums;
	}
	.compare-mobile-row footer {
		margin-top: 0.55rem;
	}
	@media (max-width: 40rem) {
		.compare-summary-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
	@media (max-width: 24rem) {
		.compare-summary-grid,
		.compare-mobile-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
