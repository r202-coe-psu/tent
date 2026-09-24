<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import type { OverviewSummary } from '../domain/schemas';

	let {
		summary,
		loading = false
	}: {
		summary: OverviewSummary | undefined;
		loading?: boolean;
	} = $props();

	function formatPct(value: number | null | undefined): string {
		return value == null ? '—' : `${value}%`;
	}
</script>

{#if loading && !summary}
	<div class="grid gap-4 md:grid-cols-2">
		<Skeleton class="h-36 w-full rounded-xl" />
		<Skeleton class="h-36 w-full rounded-xl" />
	</div>
{:else}
	<div class="grid gap-4 md:grid-cols-2">
		<Card.Root class="rounded-xl border border-emerald-200 bg-white shadow-2xs">
			<Card.Header class="pb-2">
				<Card.Title class="text-base font-semibold text-emerald-900">พร้อมรับ</Card.Title>
				<Card.Description class="text-sm text-slate-500">คิวลงทะเบียนล่วงหน้า</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-2">
				<div class="flex items-baseline justify-between gap-2">
					<span class="text-sm text-slate-600">ยังไม่ผูกศูนย์</span>
					<span class="text-2xl font-bold text-slate-900 tabular-nums">
						{summary?.unassigned_members ?? '—'}
					</span>
				</div>
				<div class="flex items-baseline justify-between gap-2">
					<span class="text-sm text-slate-600">Pre-reg ที่ศูนย์</span>
					<span class="text-2xl font-bold text-slate-900 tabular-nums">
						{summary?.pre_registered_at_sites ?? '—'}
					</span>
				</div>
			</Card.Content>
		</Card.Root>

		<Card.Root class="rounded-xl border border-sky-200 bg-white shadow-2xs">
			<Card.Header class="pb-2">
				<Card.Title class="text-base font-semibold text-sky-900">อยู่ในศูนย์</Card.Title>
				<Card.Description class="text-sm text-slate-500">ปัจจุบัน / คาดการณ์</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-2">
				<div class="flex items-baseline justify-between gap-2">
					<span class="text-sm text-slate-600">ปัจจุบัน</span>
					<span class="text-2xl font-bold text-slate-900 tabular-nums">
						{summary?.present_total ?? '—'}
					</span>
				</div>
				<div class="flex items-baseline justify-between gap-2">
					<span class="text-sm text-slate-600">คาดการณ์</span>
					<span class="text-2xl font-bold text-slate-900 tabular-nums">
						{summary?.forecast_total ?? '—'}
					</span>
				</div>
				<div class="flex items-baseline justify-between gap-2 pt-1 text-sm text-slate-600">
					<span>ความจุเฉลี่ย</span>
					<span class="font-semibold text-slate-800 tabular-nums">
						{formatPct(summary?.avg_present_pct)} / {formatPct(summary?.avg_forecast_pct)}
					</span>
				</div>
			</Card.Content>
		</Card.Root>
	</div>
{/if}
