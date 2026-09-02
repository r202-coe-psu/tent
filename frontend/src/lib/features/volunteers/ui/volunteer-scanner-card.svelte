<script lang="ts">
	/**
	 * On-Site Check-In (`volunteer-check-in.svelte`) — camera QR scan +
	 * manual code entry card. Mirrors `people/ui/scan-check-in-out-page.svelte`'s
	 * `html5-qrcode` viewport pattern; owns only the scan input mechanics
	 * (camera lifecycle, debounce/cooldown, the manual `<Input>` form) — code
	 * resolution and the result it produces are the parent's concern, reached
	 * only through `onsubmit`.
	 */
	import { Html5Qrcode } from 'html5-qrcode';
	import ScanLine from '@lucide/svelte/icons/scan-line';
	import CameraOff from '@lucide/svelte/icons/camera-off';
	import Loader from '@lucide/svelte/icons/loader';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';

	let { isProcessing, onsubmit }: { isProcessing: boolean; onsubmit: (code: string) => void } =
		$props();

	let scanCode = $state('');
	let enableCamera = $state(true);
	let cameraError = $state<string | null>(null);
	let lastScannedCode = '';
	let lastScanTime = 0;

	function submit(code: string) {
		const clean = code.trim();
		if (!clean) return;
		onsubmit(clean);
		scanCode = '';
	}

	function cameraAttachment(node: HTMLDivElement) {
		const html5QrCode = new Html5Qrcode(node.id);
		let isMounted = true;

		html5QrCode
			.start(
				{ facingMode: 'environment' },
				{
					fps: 10,
					qrbox: (width, height) => {
						const minDimension = Math.min(width, height);
						const qrboxSize = Math.floor(minDimension * 0.7);
						return { width: qrboxSize, height: qrboxSize };
					}
				},
				(decodedText) => {
					const scannedValue = decodedText.trim();
					if (scannedValue) {
						const now = Date.now();
						const isDuplicate = scannedValue === lastScannedCode;
						const cooldown = isDuplicate ? 3000 : 1500;

						if (!isProcessing && now - lastScanTime > cooldown) {
							lastScanTime = now;
							lastScannedCode = scannedValue;
							if (typeof navigator !== 'undefined' && navigator.vibrate) {
								navigator.vibrate(100);
							}
							submit(scannedValue);
						}
					}
				},
				() => {
					// Silent error handler for parsing failures.
				}
			)
			.then(() => {
				if (!isMounted && html5QrCode.isScanning) {
					html5QrCode.stop().catch(() => {});
				}
			})
			.catch(() => {
				cameraError = 'ไม่สามารถเข้าถึงกล้องได้ โปรดตรวจสอบการอนุญาตใช้งานกล้อง';
			});

		return () => {
			isMounted = false;
			if (html5QrCode.isScanning) {
				html5QrCode.stop().catch(() => {
					// Nothing actionable to surface — the view is unmounting anyway.
				});
			}
		};
	}
</script>

<Card.Root class="overflow-hidden border-border shadow-lg">
	<Card.Content class="flex flex-col items-center">
		<div
			class="relative flex aspect-square w-full max-w-[280px] items-center justify-center overflow-hidden rounded-2xl border border-border bg-muted/40"
			style="isolation: isolate; transform: translateZ(0);"
		>
			{#if enableCamera && !cameraError}
				<div
					id="volunteer-qr-reader"
					class="h-full w-full overflow-hidden rounded-2xl [&_video]:h-full! [&_video]:w-full! [&_video]:rounded-2xl! [&_video]:bg-transparent! [&_video]:object-cover!"
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
				<div
					class="flex flex-col items-center justify-center p-6 text-center text-muted-foreground"
				>
					{#if cameraError}
						<CameraOff class="mb-3 size-12 text-destructive/70" />
						<p class="text-xs font-semibold text-destructive/80">{cameraError}</p>
					{:else}
						<ScanLine class="mb-4 size-16 text-primary/20" />
						<p class="text-xs font-bold">กล้องสแกนเนอร์ปิดอยู่</p>
					{/if}
				</div>
			{/if}
		</div>

		<div class="mt-6 text-center">
			<h3 class="text-base font-bold text-foreground">สแกน QR Code ตัวมือถือ</h3>
			<p class="mt-2 max-w-sm text-xs leading-relaxed text-muted-foreground">
				ถือตั๋ว QR Code บนมือถืออาสาสมัครจ่อหน้าระบบสแกน หรือพิมพ์รหัสอาสาสมัคร (เช่น V-002)
				ลงในช่องด้านล่าง
			</p>
		</div>

		<form
			onsubmit={(e) => {
				e.preventDefault();
				submit(scanCode);
			}}
			class="mt-6 flex w-full max-w-sm gap-2"
		>
			<Input
				type="text"
				placeholder="กรอกรหัส หรือ สแกน QR..."
				bind:value={scanCode}
				disabled={isProcessing}
				class="h-11 flex-1"
			/>
			<Button
				type="submit"
				disabled={isProcessing || !scanCode}
				class="h-11 px-5 text-sm font-bold"
			>
				{#if isProcessing}
					<Loader class="mr-1 size-4 animate-spin" />
				{/if}
				ตกลง
			</Button>
		</form>
	</Card.Content>
</Card.Root>

<style>
	:global(#volunteer-qr-reader *) {
		background: transparent !important;
		background-color: transparent !important;
		border: none !important;
	}
</style>
