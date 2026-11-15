<script lang="ts">
	let { open = false, volunteer }: { open?: boolean; volunteer: { volunteer_code?: string } } =
		$props();
</script>

{#if open}
	<div data-testid="manage-dialog-stub">{volunteer.volunteer_code}</div>
{/if}
