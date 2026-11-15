<script lang="ts">
	import WalkInRegistrationDialog from './walk-in-registration-dialog.svelte';

	let open = $state(true);

	export function reopen() {
		open = true;
	}

	export function getOpen() {
		return open;
	}
</script>

<WalkInRegistrationDialog bind:open />
