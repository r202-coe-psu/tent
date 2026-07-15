<script lang="ts">
	/**
	 * T-31.7 — minimal status badge + on-demand trigger for a single day's resource calc.
	 * Deliberately NOT a dashboard: no gap breakdown, no charts, no route wiring — that's T-32.
	 */
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { toast } from 'svelte-sonner';
	import { authStore } from '$lib/stores/auth.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import { useDailyCalc } from '../application/use-daily-calc';
	import { useRunCalc } from '../application/use-run-calc';

	let { date }: { date: string } = $props();

	const record = useDailyCalc(() => date);
	const runCalc = useRunCalc();

	const fmtDateTime = (iso: string) =>
		new Date(iso).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });

	// record.data.updated_at is the "last recalculated at" public contract (see the JSDoc on
	// DailyCalcRecord in data/daily-calc.repository.ts) — NOT record.data.as_of, which is a
	// different concept (when the calc *inputs* were snapshotted).
	const updatedAtLabel = $derived(record.data ? fmtDateTime(record.data.updated_at) : null);

	async function handleRecalculate() {
		// Concurrency assumption (documented, not a code mechanism): runOnDemand mints a
		// deterministic id daily_calc:{date}, so concurrent triggers (double-click, two tabs)
		// converge safely server-side. The isPending-disable on the button below is a UX nicety,
		// not the source of correctness.
		const ctx = { shelterCode: getShelterCode(), createdBy: authStore.user?.name ?? 'staff' };
		try {
			await runCalc.mutateAsync({ date, ctx });
			toast.success('คำนวณใหม่เรียบร้อย');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'คำนวณไม่สำเร็จ');
		}
	}
</script>

<div class="flex items-center gap-2">
	{#if record.data}
		<Badge variant="secondary">
			อัปเดตล่าสุด {updatedAtLabel} · โดย {record.data.created_by}
		</Badge>
	{:else}
		<Badge variant="outline">ยังไม่เคยคำนวณ</Badge>
	{/if}
	<Button variant="outline" size="sm" onclick={handleRecalculate} disabled={runCalc.isPending}>
		{runCalc.isPending ? 'กำลังคำนวณ...' : 'คำนวณใหม่'}
	</Button>
</div>
