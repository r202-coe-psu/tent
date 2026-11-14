<script lang="ts">
	import type { PreRegistrationListItem } from '../domain';

	let { item }: { item: PreRegistrationListItem } = $props();
</script>

{#if item.shelter_name}
	<div class="flex flex-col">
		<span class="text-sm font-medium text-slate-900">{item.shelter_name}</span>
		{#if item.shelter_code}
			<span class="font-mono text-xs text-slate-500">[{item.shelter_code}]</span>
		{/if}
	</div>
{:else if item.shelter_code}
	<span class="font-mono text-sm font-medium text-slate-900">[{item.shelter_code}]</span>
{:else}
	<span class="text-sm text-slate-400">ยังไม่ผูกศูนย์</span>
{/if}
