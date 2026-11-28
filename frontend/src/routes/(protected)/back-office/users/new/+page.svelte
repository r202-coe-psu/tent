<script lang="ts">
	import { UserCreatePage } from '$lib/features/users';
	import { resolveManagedShelterCode } from '$lib/db/shelter';

	// Selected shelter, else the first one this user manages, not the first `shelter:` role (#477).
	const lockedShelterCode = $derived(resolveManagedShelterCode() ?? undefined);
</script>

{#if lockedShelterCode}
	<UserCreatePage {lockedShelterCode} backHref="/back-office/users" />
{:else}
	<div class="container mx-auto max-w-[1200px] p-4 text-sm text-muted-foreground sm:p-6">
		กำลังเลือกศูนย์พักพิง...
	</div>
{/if}
