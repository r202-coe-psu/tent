<script lang="ts">
	/** Stand-in for CreatePrinterDialog: exposes the shelter lock the page passed down. */
	let { fixedShelterCode }: { fixedShelterCode: string | null } = $props();
</script>

<div data-testid="create-dialog" data-fixed-shelter={fixedShelterCode ?? 'null'}></div>
