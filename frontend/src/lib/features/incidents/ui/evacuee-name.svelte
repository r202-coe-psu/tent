<script lang="ts">
	import { useEvacuee } from '$lib/features/people';

	const { evacueeId }: { evacueeId: string } = $props();

	const query = useEvacuee(() => evacueeId);
	const label = $derived(
		query.data ? `${query.data.first_name} ${query.data.last_name}`.trim() : evacueeId
	);
</script>

{#if query.isLoading}
	<span class="text-muted-foreground">กำลังโหลด…</span>
{:else}
	<span>{label}</span>
{/if}
