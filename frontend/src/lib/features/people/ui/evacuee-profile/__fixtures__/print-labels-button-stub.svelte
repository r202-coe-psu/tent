<script lang="ts">
	let {
		printing = $bindable(false),
		retryHeld = $bindable(false)
	}: { printing?: boolean; retryHeld?: boolean } = $props();
</script>

<button type="button" data-testid="station-print" onclick={() => (printing = !printing)}>
	station print
</button>
<button type="button" data-testid="station-retry-held" onclick={() => (retryHeld = !retryHeld)}>
	retry held
</button>
