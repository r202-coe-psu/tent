<script lang="ts">
	import { useEvacuee } from '$lib/features/people';
	import { useVolunteer } from '$lib/features/volunteers';
	import { useShelterStaffDirectory } from '$lib/features/users';
	import { staffRecipientLabel } from '../model/staff-recipient-label';

	interface Props {
		recipientType: string;
		recipientId?: string | null;
		shelterCode?: string | null;
	}

	let { recipientType, recipientId, shelterCode }: Props = $props();

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

	const staffDirectoryQuery = useShelterStaffDirectory(() =>
		recipientType === 'staff' ? shelterCode : null
	);
</script>

{#if recipientType === 'outside'}
	<span class="text-slate-500">ไม่ระบุตัวตน</span>
{:else if recipientType === 'staff' && recipientId}
	{staffRecipientLabel(recipientId, staffDirectoryQuery.data)}
	<span class="text-xs text-slate-500">เจ้าหน้าที่</span>
{:else if volunteer}
	{volunteer.first_name}
	{volunteer.last_name}
{:else if evacuee}
	{evacuee.first_name}
	{evacuee.last_name}
{:else}
	<span class="text-slate-400">{recipientId ?? '—'}</span>
{/if}
