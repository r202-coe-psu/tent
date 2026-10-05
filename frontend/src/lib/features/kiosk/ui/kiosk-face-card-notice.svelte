<script lang="ts">
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';

	interface Props {
		/** The chip photo has been read: the card may be taken out. */
		removable: boolean;
	}

	let { removable }: Props = $props();
</script>

<!--
	Check-in reads the chip photo while the person is at the camera, so the card has to stay in
	until the system says otherwise (same amber warning as the card-reading page).
-->
{#if removable}
	<div
		class="mx-auto mb-4 flex max-w-xl items-center justify-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-lg font-bold text-emerald-950 kiosk-portrait:p-4 kiosk-portrait:text-2xl kiosk-compact:mb-2 kiosk-compact:p-1.5 kiosk-compact:text-base kiosk-compact:leading-tight"
		role="status"
		data-testid="kiosk-face-card-notice"
		data-card-removable="true"
	>
		<CheckCircle2 class="size-6 shrink-0" aria-hidden="true" />
		<p>ถอดบัตรได้แล้ว</p>
	</div>
{:else}
	<div
		class="mx-auto mb-4 flex max-w-xl items-center justify-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-lg font-bold text-amber-950 kiosk-portrait:p-4 kiosk-portrait:text-2xl kiosk-compact:mb-2 kiosk-compact:p-1.5 kiosk-compact:text-base kiosk-compact:leading-tight"
		role="status"
		data-testid="kiosk-face-card-notice"
		data-card-removable="false"
	>
		<CircleAlert class="size-6 shrink-0" aria-hidden="true" />
		<p>กรุณาเสียบบัตรค้างไว้จนกว่าระบบจะบอกให้ถอด</p>
	</div>
{/if}
