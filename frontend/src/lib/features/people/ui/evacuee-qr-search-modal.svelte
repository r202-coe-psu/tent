<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { Html5Qrcode } from 'html5-qrcode';
	import { useQueryClient } from '@tanstack/svelte-query';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import Camera from '@lucide/svelte/icons/camera';
	import CameraOff from '@lucide/svelte/icons/camera-off';
	import Keyboard from '@lucide/svelte/icons/keyboard';
	import Lock from '@lucide/svelte/icons/lock';
	import Loader from '@lucide/svelte/icons/loader';
	import { lookupEvacueeByScanCode } from '$lib/features/people';
	import { getShelterCode } from '$lib/db/shelter';

	let {
		show,
		onClose,
		onFound
	}: {
		show: boolean;
		onClose: () => void;
		onFound: (evacueeId: string) => void;
	} = $props();

	const queryClient = useQueryClient();

	let manualCode = $state('');
	let isLooking = $state(false);
	let cameraError = $state<string | null>(null);

	let lastScannedCode = '';
	let lastScanTime = 0;

	$effect(() => {
		if (!show) {
			manualCode = '';
			cameraError = null;
			isLooking = false;
		}
	});

	// Same html5-qrcode wiring as the check-in/out scanner (scan-check-in-out-page.svelte),
	// reused here so the search flow accepts the same evacuee ID cards / QR passes.
	function cameraAttachment(node: HTMLDivElement) {
		const html5QrCode = new Html5Qrcode(node.id);

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
					if (!scannedValue) return;

					const now = Date.now();
					const isDuplicate = scannedValue === lastScannedCode;
					const cooldown = isDuplicate ? 3000 : 1500;

					if (!isLooking && now - lastScanTime > cooldown) {
						lastScanTime = now;
						lastScannedCode = scannedValue;

						if (typeof navigator !== 'undefined' && navigator.vibrate) {
							navigator.vibrate(100);
						}

						handleLookup(scannedValue);
					}
				},
				() => {
					// Silent error handler for parsing failures
				}
			)
			.catch(() => {
				cameraError = 'ไม่สามารถเข้าถึงกล้องได้ โปรดตรวจสอบการอนุญาตใช้งานกล้อง';
			});

		return () => {
			if (html5QrCode.isScanning) {
				html5QrCode.stop().catch(() => {
					// Nothing actionable to surface — the modal is unmounting anyway.
				});
			}
		};
	}

	async function handleLookup(code: string) {
		const cleanCode = code.trim();
		if (!cleanCode) return;

		isLooking = true;
		try {
			const evacuee = await lookupEvacueeByScanCode(queryClient, cleanCode);
			if (!evacuee) {
				toast.error(`ไม่พบข้อมูลผู้พักพิงจากรหัส "${cleanCode}" ในศูนย์ ${getShelterCode()}`);
				return;
			}
			manualCode = '';
			toast.success(`สแกนสำเร็จ: พบข้อมูล ${evacuee.first_name} ${evacuee.last_name}`);
			onFound(evacuee._id);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการค้นหา');
		} finally {
			isLooking = false;
		}
	}
</script>

<Dialog.Root
	open={show}
	onOpenChange={(open) => {
		if (!open) onClose();
	}}
>
	<Dialog.Content class="flex w-full max-w-md flex-col gap-5 rounded-3xl p-6">
		<Dialog.Header class="pr-6 text-left">
			<Dialog.Title class="flex items-center gap-2 text-base font-black">
				<Camera class="size-5 text-primary" />
				สแกน QR Code ตั๋วผู้พักพิง (Digital Pass Scanner)
			</Dialog.Title>
		</Dialog.Header>

		<div
			class="relative mx-auto flex aspect-square w-full max-w-[280px] items-center justify-center overflow-hidden rounded-2xl bg-slate-950"
			style="isolation: isolate; transform: translateZ(0);"
		>
			{#if !cameraError}
				<div
					id="evacuee-search-qr-reader"
					class="h-full w-full overflow-hidden [&_video]:h-full! [&_video]:w-full! [&_video]:rounded-2xl! [&_video]:bg-transparent! [&_video]:object-cover!"
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
				<div class="flex flex-col items-center gap-2 p-6 text-center">
					<CameraOff class="size-10 animate-bounce text-red-400" />
					<p class="text-xs font-semibold text-red-400">{cameraError}</p>
				</div>
			{/if}
		</div>

		<form
			onsubmit={(e) => {
				e.preventDefault();
				handleLookup(manualCode);
			}}
			class="space-y-2"
		>
			<label
				for="qr-manual-code"
				class="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"
			>
				<Keyboard class="size-3.5" />
				หรือระบุรหัสด้วยเครื่องสแกนบาร์โค้ด / พิมพ์ด้วยมือ:
			</label>
			<div class="flex gap-2">
				<Input
					id="qr-manual-code"
					type="text"
					placeholder="สแกนหรือพิมพ์เลขประจำตัว / รหัสตั๋ว..."
					bind:value={manualCode}
					disabled={isLooking}
					class="h-11 flex-1"
				/>
				<Button
					type="submit"
					disabled={isLooking || !manualCode.trim()}
					class="h-11 px-5 font-bold"
				>
					{#if isLooking}
						<Loader class="size-4 animate-spin" />
					{/if}
					ตกลง
				</Button>
			</div>
		</form>

		<div class="flex items-center justify-between border-t border-border pt-3 text-xs">
			<span class="inline-flex items-center gap-1.5 font-semibold text-emerald-600">
				<Lock class="size-3.5" />
				PDPA Secure Reader
			</span>
			<button
				type="button"
				class="cursor-pointer font-semibold text-muted-foreground transition-colors hover:text-foreground"
				onclick={onClose}
			>
				ยกเลิก
			</button>
		</div>
	</Dialog.Content>
</Dialog.Root>

<style>
	:global(#evacuee-search-qr-reader *) {
		background: transparent !important;
		background-color: transparent !important;
		border: none !important;
	}
</style>
