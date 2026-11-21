<script lang="ts">
	import { shelterActorsLine, type ShelterActorsInput } from '../domain/shelter-actors';

	let { actors }: { actors: ShelterActorsInput } = $props();

	const line = $derived(shelterActorsLine(actors));
</script>

<p class="text-xs leading-relaxed text-slate-500" data-testid="shelter-actors-line">
	<span>สร้างโดย {line.createdBy}</span>
	{#if line.createdAt}<span class="tabular-nums"> · {line.createdAt}</span>{/if}
	<span> · แก้ไขล่าสุดโดย {line.updatedBy}</span>
	{#if line.updatedAt}<span class="tabular-nums"> · {line.updatedAt}</span>{/if}
</p>
