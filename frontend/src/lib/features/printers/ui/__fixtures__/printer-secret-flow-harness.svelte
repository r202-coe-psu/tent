<script lang="ts">
	/** Wires create → reveal exactly as the back-office page does, so the flow is testable. */
	import CreatePrinterDialog from '../create-printer-dialog.svelte';
	import RevealPrinterSecretDialog from '../reveal-printer-secret-dialog.svelte';
	import type { PrinterSecretResponse } from '../../domain/print-device.schema';

	let createOpen = $state(true);
	let revealOpen = $state(false);
	let revealed = $state.raw<PrinterSecretResponse | null>(null);

	/** The reveal dialog closed: keep no plaintext secret in page state. */
	function handleRevealClosed() {
		revealed = null;
	}
</script>

<CreatePrinterDialog
	bind:open={createOpen}
	fixedShelterCode="SH001"
	oncreated={(created) => {
		revealed = created;
		revealOpen = true;
	}}
/>
<RevealPrinterSecretDialog
	bind:open={revealOpen}
	device={revealed?.device ?? null}
	secret={revealed?.secret ?? null}
	reason="created"
	onclose={handleRevealClosed}
/>
