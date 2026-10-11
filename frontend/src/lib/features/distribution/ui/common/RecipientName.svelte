<script lang="ts">
	import { useEvacuee } from '$lib/features/people';

	interface Props {
		recipientType: string;
		recipientId?: string | null;
	}

	let { recipientType, recipientId }: Props = $props();

	const evacueeQuery = useEvacuee(
		() => recipientId ?? '',
		() => recipientType === 'evacuee' && Boolean(recipientId)
	);
	const evacuee = $derived(evacueeQuery.data);
</script>

{#if recipientType === 'outside'}
	บุคคลภายนอก
{:else if recipientType === 'volunteer'}
	จิตอาสา
{:else if evacuee}
	{evacuee.first_name}
	{evacuee.last_name}
{:else}
	<span class="text-slate-400">{recipientId ?? '—'}</span>
{/if}
