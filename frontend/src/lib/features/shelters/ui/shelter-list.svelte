<script lang="ts">
	import type { ShelterSummary } from '../data/shelters.api';

	let { shelters }: { shelters: ShelterSummary[] } = $props();
</script>

{#if shelters.length === 0}
	<p class="text-sm text-muted-foreground">No shelters yet.</p>
{:else}
	<div class="flex flex-col gap-2">
		{#each shelters as shelter (shelter.code)}
			<div class="flex items-center justify-between">
				<span class="text-sm font-medium">{shelter.code} — {shelter.name}</span>
				<span class="text-xs text-muted-foreground">{shelter.status} · {shelter.db}</span>
			</div>
		{/each}
	</div>
{/if}
