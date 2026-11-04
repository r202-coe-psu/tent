<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { formatServiceDuration, type StationActorRank } from '$lib/features/dashboard';

	let {
		actors,
		rowClass
	}: {
		/** This station's actors, already in rank order (fastest first, FR-STL-35). */
		actors: readonly StationActorRank[];
		/** Station tint for each row, matching the station card. */
		rowClass: string;
	} = $props();

	const TOP = 5;

	let expanded = $state(false);
	const shown = $derived(expanded ? actors : actors.slice(0, TOP));
</script>

<div class="mt-4 border-t pt-3">
	<h4 class="mb-2 text-xs font-semibold text-foreground">อันดับเวลาให้บริการ</h4>
	{#if actors.length === 0}
		<p class="text-2xs text-muted-foreground">ยังไม่มีข้อมูลในช่วงวันที่นี้</p>
	{:else}
		<ol class="space-y-1">
			{#each shown as actor, index (actor.actor_id + actor.kind)}
				<li class={['flex items-center gap-2 rounded-md px-2 py-1.5 text-sm', rowClass]}>
					<span class="w-5 shrink-0 text-center font-semibold text-muted-foreground tabular-nums">
						{index + 1}
					</span>
					<span class="min-w-0 flex-1 truncate" title={actor.display_name}>
						{actor.display_name}
					</span>
					<span class="shrink-0 text-right">
						<span class="block font-semibold tabular-nums">
							{formatServiceDuration(actor.avg_duration_sec)}
						</span>
						<span class="block text-2xs text-muted-foreground tabular-nums">
							{actor.timed_visits} ราย
						</span>
					</span>
				</li>
			{/each}
		</ol>
		{#if actors.length > TOP}
			<Button
				variant="ghost"
				size="sm"
				class="mt-1 w-full"
				aria-expanded={expanded}
				onclick={() => (expanded = !expanded)}
			>
				{expanded ? 'แสดงเฉพาะ 5 อันดับแรก' : `ดูทั้งหมด (${actors.length})`}
			</Button>
		{/if}
	{/if}
</div>
