<script lang="ts">
	import { useEvacuee } from '$lib/features/people';
	import { useVolunteer } from '$lib/features/volunteers';

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

	const volunteerQuery = useVolunteer(
		() => recipientId ?? '',
		() => recipientType === 'volunteer' && Boolean(recipientId)
	);
	const volunteer = $derived(volunteerQuery.data);
</script>

{#if recipientType === 'outside'}
	<span class="text-slate-500">ไม่ระบุตัวตน</span>
{:else if volunteer}
	{volunteer.first_name}
	{volunteer.last_name}
{:else if evacuee}
	{evacuee.first_name}
	{evacuee.last_name}
{:else}
	<span class="text-slate-400">{recipientId ?? '—'}</span>
{/if}
