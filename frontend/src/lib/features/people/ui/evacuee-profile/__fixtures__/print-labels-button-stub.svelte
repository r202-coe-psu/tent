<script lang="ts">
	let {
		printing = $bindable(false),
		retryHeld = $bindable(false),
		label,
		source,
		renderLabels
	}: {
		printing?: boolean;
		retryHeld?: boolean;
		label?: string;
		source?: string;
		renderLabels?: () => Promise<string[]>;
	} = $props();
</script>

<button
	type="button"
	data-testid="station-print"
	data-label={label}
	data-source={source}
	onclick={() => (printing = !printing)}
>
	station print
</button>
<button type="button" data-testid="station-retry-held" onclick={() => (retryHeld = !retryHeld)}>
	retry held
</button>
<button type="button" data-testid="render-labels" onclick={() => renderLabels?.()}>
	render labels
</button>
