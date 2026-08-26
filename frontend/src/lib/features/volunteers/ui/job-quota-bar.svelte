<script lang="ts">
	/**
	 * Reusable 3-color quota bar (CR-094 FR-VOL-09.2): confirmed 🟢 / dispatched 🟡
	 * / remaining ⚪. Fed from `computeQuota()` — never recomputes the split itself.
	 */
	import { computeQuota } from '../domain/quota';

	let {
		job
	}: {
		job: Parameters<typeof computeQuota>[0];
	} = $props();

	const quota = $derived(computeQuota(job));
	const total = $derived(job.quota > 0 ? job.quota : 1);
	const confirmedPct = $derived((quota.confirmed / total) * 100);
	const dispatchedPct = $derived((quota.dispatched / total) * 100);
	const remainingPct = $derived((quota.remaining / total) * 100);
</script>

<div class="w-full">
	<div class="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
		<div class="h-full bg-emerald-500" style:width="{confirmedPct}%" title="ตอบรับแล้ว"></div>
		<div class="h-full bg-amber-400" style:width="{dispatchedPct}%" title="เสนอแล้ว"></div>
		<div
			class="h-full bg-muted-foreground/20"
			style:width="{remainingPct}%"
			title="ยังขาดอีก"
		></div>
	</div>
	<div class="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
		<span class="inline-flex items-center gap-1">
			<span class="h-2 w-2 rounded-full bg-emerald-500"></span>
			ตอบรับแล้ว {quota.confirmed}
		</span>
		<span class="inline-flex items-center gap-1">
			<span class="h-2 w-2 rounded-full bg-amber-400"></span>
			เสนอแล้ว {quota.dispatched}
		</span>
		<span class="inline-flex items-center gap-1">
			<span class="h-2 w-2 rounded-full bg-muted-foreground/30"></span>
			ยังขาดอีก {quota.remaining}
		</span>
		<span class="ml-auto font-medium text-foreground"
			>{job.quota - quota.remaining}/{job.quota}</span
		>
	</div>
</div>
