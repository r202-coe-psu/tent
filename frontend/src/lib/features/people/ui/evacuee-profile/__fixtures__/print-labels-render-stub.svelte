<script lang="ts">
	// Calls the host's `renderLabels` on click, like the real button does when it sends a job.
	let { renderLabels }: { renderLabels: () => Promise<string[]> } = $props();

	async function run() {
		try {
			await renderLabels();
		} catch {
			// The host reports its own failure (toast); the stub only drives the render.
		}
	}
</script>

<button type="button" data-testid="render-labels" onclick={run}>render</button>
