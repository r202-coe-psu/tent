<script lang="ts">
	let { printing = $bindable(false) }: { printing?: boolean } = $props();
</script>

<button type="button" data-testid="station-print" onclick={() => (printing = !printing)}>
	station print
</button>
