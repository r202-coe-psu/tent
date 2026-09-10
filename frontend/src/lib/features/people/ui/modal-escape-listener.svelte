<script lang="ts">
	let {
		open,
		disabled = false,
		onEscape
	}: {
		open: boolean;
		disabled?: boolean;
		onEscape: () => void;
	} = $props();

	function handleKeydown(event: KeyboardEvent) {
		if (!open || disabled || event.key !== 'Escape') return;
		event.preventDefault();
		onEscape();
	}
</script>

<svelte:window onkeydown={handleKeydown} />
