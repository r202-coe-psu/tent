<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import type { ScenarioSummary } from '../data/scenario.repository';
	import FolderOpen from '@lucide/svelte/icons/folder-open';

	let {
		scenarios,
		loading,
		error,
		onRetry,
		loadingMore,
		hasMore,
		onLoadMore,
		onOpen
	}: {
		scenarios: ScenarioSummary[];
		loading: boolean;
		error: boolean;
		onRetry: () => void;
		loadingMore: boolean;
		hasMore: boolean;
		onLoadMore: () => void;
		onOpen: (id: string) => void;
	} = $props();
</script>

<div class="saved-list">
	{#if loading}
		<div class="saved-state">
			<span class="saved-state-line"></span>
			<p>กำลังโหลดผลจำลองที่บันทึก…</p>
		</div>
	{:else if error}
		<div class="saved-state saved-state--error">
			<p class="text-sm font-semibold text-destructive">โหลดสถานการณ์ที่บันทึกไม่สำเร็จ</p>
			<p class="mt-1 text-xs text-muted-foreground">
				ตรวจสอบการเชื่อมต่อหรือสิทธิ์ แล้วลองใหม่อีกครั้ง
			</p>
			<Button type="button" variant="outline" size="sm" class="mt-3" onclick={onRetry}
				>ลองใหม่</Button
			>
		</div>
	{:else if scenarios.length === 0}
		<div class="saved-state saved-state--empty">
			<p class="text-sm font-semibold">ยังไม่มีสถานการณ์ที่บันทึก</p>
			<p class="mt-1 text-xs text-muted-foreground">รันสถานการณ์แล้วกดบันทึกเพื่อเปิดดูภายหลัง</p>
		</div>
	{:else}
		<div class="saved-list-head hidden sm:grid">
			<span>ชื่อสถานการณ์</span><span>ขอบเขต</span><span>บันทึกเมื่อ</span><span class="text-right"
				>การทำงาน</span
			>
		</div>
		{#each scenarios as scenario (scenario.id)}
			<div class="saved-row">
				<div class="min-w-0">
					<p class="truncate text-sm font-bold">{scenario.name}</p>
					<span class:mode-badge--override={scenario.override_count > 0} class="mode-badge">
						{scenario.override_count > 0 ? 'ปรับเกณฑ์ใน Scenario' : 'จำลองทั่วไป'}
					</span>
					<p class="mt-1 text-[11px] text-muted-foreground sm:hidden">
						{scenario.occupancy.toLocaleString('th-TH')} คน · {scenario.days} วัน · {new Date(
							scenario.created_at
						).toLocaleString('th-TH')}
					</p>
				</div>
				<div class="saved-scope hidden sm:flex">
					<span>{scenario.occupancy.toLocaleString('th-TH')} คน</span><span
						>{scenario.days} วัน</span
					>
				</div>
				<div class="saved-date hidden text-xs text-muted-foreground sm:block">
					{new Date(scenario.created_at).toLocaleString('th-TH')}
				</div>
				<div class="shrink-0">
					<Button
						type="button"
						variant="outline"
						size="sm"
						aria-label={`เปิดผล ${scenario.name}`}
						onclick={() => onOpen(scenario.id)}
					>
						<FolderOpen class="size-3.5" /> เปิดผล
					</Button>
				</div>
			</div>
		{/each}
		{#if hasMore}
			<div class="pt-2 text-center">
				<Button type="button" variant="ghost" size="sm" disabled={loadingMore} onclick={onLoadMore}>
					{loadingMore ? 'กำลังโหลด…' : 'โหลดเพิ่มเติม'}
				</Button>
			</div>
		{/if}
	{/if}
</div>

<style>
	.saved-list {
		min-width: 0;
	}

	.saved-list-head,
	.saved-row {
		display: grid;
		grid-template-columns: minmax(0, 1.6fr) minmax(8rem, 0.8fr) minmax(11rem, 1fr) auto;
		align-items: center;
		gap: 1rem;
	}

	.saved-list-head {
		border-bottom: 1px solid var(--border);
		padding: 0 0.15rem 0.55rem;
		font-size: 0.62rem;
		font-weight: 800;
		letter-spacing: 0.04em;
		color: var(--muted-foreground);
		text-transform: uppercase;
	}

	.saved-row {
		border-bottom: 1px solid var(--border);
		padding: 0.7rem 0.15rem;
	}

	.saved-row:last-of-type {
		border-bottom: 0;
	}

	.saved-scope {
		flex-wrap: wrap;
		gap: 0.35rem;
	}

	.saved-scope span {
		border-radius: 999px;
		background: var(--muted);
		padding: 0.2rem 0.45rem;
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 0.63rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}

	.mode-badge {
		display: inline-flex;
		margin-top: 0.3rem;
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 0.12rem 0.4rem;
		font-size: 0.6rem;
		font-weight: 750;
		color: var(--muted-foreground);
	}

	.mode-badge--override {
		border-color: color-mix(in srgb, var(--primary) 30%, var(--border));
		background: var(--primary-muted);
		color: var(--primary-dark);
	}

	.saved-state {
		display: grid;
		place-items: center;
		min-height: 7rem;
		border: 1px dashed var(--border);
		border-radius: 0.65rem;
		padding: 1.5rem;
		text-align: center;
		font-size: 0.78rem;
		color: var(--muted-foreground);
	}

	.saved-state-line {
		width: 1.5rem;
		height: 2px;
		margin-bottom: 0.6rem;
		background: var(--primary);
	}

	.saved-state--error {
		border-style: solid;
		border-color: color-mix(in srgb, var(--destructive) 30%, var(--border));
		background: color-mix(in srgb, var(--destructive) 4%, transparent);
	}

	@media (max-width: 40rem) {
		.saved-row {
			grid-template-columns: minmax(0, 1fr) auto;
			gap: 0.6rem;
		}
	}
</style>
