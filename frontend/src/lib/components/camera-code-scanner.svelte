<script lang="ts">
	import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
	import CameraOff from '@lucide/svelte/icons/camera-off';

	const RETAIL_FORMATS = [
		Html5QrcodeSupportedFormats.EAN_13,
		Html5QrcodeSupportedFormats.EAN_8,
		Html5QrcodeSupportedFormats.UPC_A,
		Html5QrcodeSupportedFormats.UPC_E,
		Html5QrcodeSupportedFormats.CODE_128,
		Html5QrcodeSupportedFormats.CODE_39
	];

	let {
		onScan,
		formats = RETAIL_FORMATS,
		disabled = false
	}: {
		/** Called once per distinct read, after the duplicate cooldown. */
		onScan: (code: string) => void;
		/** Symbologies to decode; 1D retail codes by default. Include `QR_CODE` for QR labels. */
		formats?: Html5QrcodeSupportedFormats[];
		disabled?: boolean;
	} = $props();

	// html5-qrcode binds to an element id, and several scanners may share a page.
	const uid = $props.id();
	const readerId = `camera-code-reader-${uid}`;

	let cameraError = $state<string | null>(null);
	let lastScannedCode = '';
	let lastScanTime = 0;

	function cameraAttachment(node: HTMLDivElement) {
		const reader = new Html5Qrcode(node.id, {
			formatsToSupport: formats,
			useBarCodeDetectorIfSupported: true,
			verbose: false
		});
		// 1D codes are wide and short; a QR needs a square.
		const square = formats.includes(Html5QrcodeSupportedFormats.QR_CODE);
		let mounted = true;

		reader
			.start(
				{ facingMode: 'environment' },
				{
					fps: 10,
					qrbox: (width, height) => {
						const side = Math.min(width, height);
						return square
							? { width: Math.floor(side * 0.7), height: Math.floor(side * 0.7) }
							: { width: Math.floor(width * 0.85), height: Math.floor(side * 0.5) };
					}
				},
				(decodedText) => {
					const code = decodedText.trim();
					if (!code || disabled) return;

					const now = Date.now();
					const cooldown = code === lastScannedCode ? 3000 : 1500;
					if (now - lastScanTime <= cooldown) return;
					lastScanTime = now;
					lastScannedCode = code;

					if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(100);
					onScan(code);
				},
				() => {
					// Frames without a code are expected.
				}
			)
			.then(() => {
				// The dialog may have closed while the camera was still starting.
				if (!mounted && reader.isScanning) reader.stop().catch(() => {});
			})
			.catch(() => {
				if (mounted) cameraError = 'ไม่สามารถเข้าถึงกล้องได้ โปรดตรวจสอบการอนุญาตใช้งานกล้อง';
			});

		return () => {
			mounted = false;
			if (reader.isScanning) reader.stop().catch(() => {});
		};
	}
</script>

<div
	class="relative mx-auto flex aspect-square w-full max-w-[280px] items-center justify-center overflow-hidden rounded-2xl bg-slate-950"
	style="isolation: isolate; transform: translateZ(0);"
>
	{#if !cameraError}
		<div
			id={readerId}
			class="camera-code-reader h-full w-full overflow-hidden [&_video]:h-full! [&_video]:w-full! [&_video]:rounded-2xl! [&_video]:bg-transparent! [&_video]:object-cover!"
			style="isolation: isolate; transform: translateZ(0);"
			{@attach cameraAttachment}
		></div>

		<div class="pointer-events-none absolute inset-4">
			<div
				class="absolute top-0 left-0 h-6 w-6 rounded-tl-md border-t-4 border-l-4 border-white/80"
			></div>
			<div
				class="absolute top-0 right-0 h-6 w-6 rounded-tr-md border-t-4 border-r-4 border-white/80"
			></div>
			<div
				class="absolute bottom-0 left-0 h-6 w-6 rounded-bl-md border-b-4 border-l-4 border-white/80"
			></div>
			<div
				class="absolute right-0 bottom-0 h-6 w-6 rounded-br-md border-r-4 border-b-4 border-white/80"
			></div>
		</div>
	{:else}
		<div class="flex flex-col items-center gap-2 p-6 text-center" role="alert">
			<CameraOff class="size-10 text-red-400" aria-hidden="true" />
			<p class="text-xs font-semibold text-red-400">{cameraError}</p>
		</div>
	{/if}
</div>

<style>
	.camera-code-reader :global(*) {
		background: transparent !important;
		background-color: transparent !important;
		border: none !important;
	}
</style>
