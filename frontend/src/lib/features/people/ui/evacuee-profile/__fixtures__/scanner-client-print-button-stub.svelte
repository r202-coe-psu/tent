<!-- Stand-in for ScannerClientPrintButton: outside the scanner client the real one renders nothing. -->
<script lang="ts">
	let { printing = $bindable(false) }: { printing?: boolean } = $props();
</script>

<output hidden data-testid="scanner-client-printing">{printing}</output>
