<script lang="ts">
	import QrIdCard from '$lib/components/qr-id-card.svelte';
	import type { KioskLabelSheetItem } from '../domain/kiosk-label-item';
	import {
		KIOSK_LABEL_CHECKLIST,
		KIOSK_LABEL_GAP_MM,
		KIOSK_LABEL_LINK,
		KIOSK_LABEL_MM,
		KIOSK_LABEL_PADDING_MM,
		kioskQrBoxMm,
		labelZoneLine
	} from '../domain/print-label';

	interface Props {
		label: Omit<KioskLabelSheetItem, 'key'>;
		class?: string;
	}

	let { label, class: className }: Props = $props();

	const isStaffCard = $derived(label.lines !== undefined);
</script>

<!-- One 80x60 mm kiosk label: the print sheet and on-screen previews render this same card. -->
<div
	class={['kiosk-label-card', className]}
	style:--qr-size="{label.qrSizeMm ?? kioskQrBoxMm()}mm"
	style:--label-gap="{KIOSK_LABEL_GAP_MM}mm"
	style:width="{KIOSK_LABEL_MM.width}mm"
	style:height="{KIOSK_LABEL_MM.height}mm"
	style:padding="{KIOSK_LABEL_PADDING_MM}mm"
>
	<QrIdCard
		src={label.qrSrc}
		alt={label.alt ?? 'QR ประจำตัวสำหรับใช้ภายในศูนย์'}
		name={label.name}
		badge={label.badge}
		lines={label.lines}
		zone={isStaffCard ? undefined : labelZoneLine(label.zone)}
		checkedCount={label.checkedCount}
		footer={KIOSK_LABEL_LINK}
		checklist={isStaffCard ? undefined : KIOSK_LABEL_CHECKLIST}
	/>
</div>

<style>
	.kiosk-label-card {
		box-sizing: border-box;
		overflow: hidden;
		background: #fff;
		font-family: 'IBM Plex Sans Thai', sans-serif;
		color: #000;
	}
</style>
