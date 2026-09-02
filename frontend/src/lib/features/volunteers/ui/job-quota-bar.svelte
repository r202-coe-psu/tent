<script lang="ts">
	/**
	 * Quota bar for the job board card (CR-094 FR-VOL-09.2).
	 *
	 * Counts APPROVED volunteers only: 🟢 ยืนยันแล้ว (`slots_confirmed`) vs
	 * ⚪ ยังขาดอีก (`quota - slots_confirmed`). The former 🟡 "เสนอแล้ว"
	 * (`slots_dispatched`) segment is deliberately gone — an offer that nobody
	 * has accepted yet is not staffing, so it reads as a gap here, exactly like
	 * an untouched slot. `computeQuota()` is still called so the job's quota
	 * invariant is validated (and a corrupt document fails loudly) rather than
	 * rendering a bogus bar.
	 */
	import { computeQuota } from '../domain/quota';

	let {
		job
	}: {
		job: Parameters<typeof computeQuota>[0];
	} = $props();

	const quota = $derived(computeQuota(job));
	const total = $derived(job.quota > 0 ? job.quota : 1);
	/** Everything not yet approved — dispatched-but-unanswered slots included. */
	const missing = $derived(quota.dispatched + quota.remaining);
	const confirmedPct = $derived((quota.confirmed / total) * 100);
	const missingPct = $derived((missing / total) * 100);
</script>

<div class="w-full">
	<div class="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
		<div class="h-full bg-emerald-500" style:width="{confirmedPct}%" title="ยืนยันแล้ว"></div>
		<div class="h-full bg-muted-foreground/20" style:width="{missingPct}%" title="ยังขาดอีก"></div>
	</div>
	<div class="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
		<span class="inline-flex items-center gap-1">
			<span class="h-2 w-2 rounded-full bg-emerald-500"></span>
			ยืนยันแล้ว {quota.confirmed}
		</span>
		<span class="inline-flex items-center gap-1">
			<span class="h-2 w-2 rounded-full bg-muted-foreground/30"></span>
			ยังขาดอีก {missing}
		</span>
		<span class="ml-auto font-medium text-foreground">{quota.confirmed}/{job.quota}</span>
	</div>
</div>
