<script lang="ts">
	import type { Evacuee } from '../domain/people';

	let { evacuees }: { evacuees: Evacuee[] } = $props();
</script>

{#if evacuees.length === 0}
	<p class="text-sm text-muted-foreground">No evacuees yet.</p>
{:else}
	<div class="flex flex-col gap-2">
		{#each evacuees as evacuee (evacuee._id)}
			<div class="flex items-center justify-between">
				<span class="text-sm font-medium">{evacuee.first_name} {evacuee.last_name}</span>
				<span class="text-xs text-muted-foreground">
					{evacuee.gender} · {evacuee.phone ?? 'ไม่มี'} · {evacuee.current_stay.status}
				</span>
			</div>
		{/each}
	</div>
{/if}
