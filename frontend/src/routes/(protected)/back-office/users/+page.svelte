<script lang="ts">
	import { UserManagementPage } from '$lib/features/users';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { authStore } from '$lib/stores/auth.svelte';
	import { shelterCodeFromRoles } from '$lib/auth/roles';

	const roles = $derived(authStore.user?.roles ?? []);
	const lockedShelterCode = $derived(
		shelterStore.selectedShelterCode ?? shelterCodeFromRoles(roles) ?? undefined
	);
</script>

{#if lockedShelterCode}
	<UserManagementPage {lockedShelterCode} />
{:else}
	<div class="container mx-auto max-w-[1200px] p-6 text-sm text-muted-foreground">
		กำลังเลือกศูนย์พักพิง...
	</div>
{/if}
