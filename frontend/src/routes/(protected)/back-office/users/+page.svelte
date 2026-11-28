<script lang="ts">
	import { UserManagementPage } from '$lib/features/users';
	import { resolveManagedShelterCode } from '$lib/db/shelter';

	// Selected shelter, else the first one this user manages, not the first `shelter:` role (#477).
	const lockedShelterCode = $derived(resolveManagedShelterCode() ?? undefined);
</script>

{#if lockedShelterCode}
	<UserManagementPage {lockedShelterCode} />
{:else}
	<div class="container mx-auto max-w-[1200px] p-6 text-sm text-muted-foreground">
		กำลังเลือกศูนย์พักพิง...
	</div>
{/if}
