<script lang="ts">
	import { Html5Qrcode } from 'html5-qrcode';
	import X from '@lucide/svelte/icons/x';
	import Camera from '@lucide/svelte/icons/camera';
	import CameraOff from '@lucide/svelte/icons/camera-off';
	import ImageUp from '@lucide/svelte/icons/image-up';
	import { Button } from '$lib/components/ui/button/index.js';
	import { languageStore } from '$lib/stores/language.svelte';
	import { jobsI18n } from '$lib/features/volunteers/i18n/jobs.i18n';

	let {
		isOpen = $bindable(false),
		onScan,
		title,
		inline = false,
		disabled = false
	} = $props<{
		isOpen?: boolean;
		onScan: (token: string) => void;
		title?: string;
		inline?: boolean;
		disabled?: boolean;
	}>();

	const t = $derived(jobsI18n[languageStore.current]);
	const displayTitle = $derived(title || t.ticketScanTitle);

	let cameraError = $state<string>('');
	const scannerElementId = 'volunteer-qr-camera-reader';
	let lastScannedCode = '';
	let lastScanTime = 0;

	function tokenFromScan(decoded: string): string {
		const trimmed = decoded.trim();
		const withoutQuery = trimmed.split(/[?#]/)[0];
		const lastSegment = withoutQuery.split('/').filter(Boolean).pop() ?? '';
		return lastSegment || trimmed;
	}

	/**
	 * QR from an image file — for a ticket saved as a screenshot, or a camera that will
	 * not start. Decoded entirely in this browser by html5-qrcode (`scanFile`): the image
	 * is never uploaded, so the token inside it never leaves the device and the server
	 * gains no file-handling surface. The decoded text is still untrusted — it goes
	 * through `onScan` exactly like a camera scan, where the caller accepts only a
	 * `TKT-VOL-` token and never opens it as a link.
	 */
	const MAX_QR_IMAGE_BYTES = 10 * 1024 * 1024;
	const uid = $props.id();
	const fileReaderId = `volunteer-qr-file-reader-${uid}`;
	let fileInput = $state<HTMLInputElement>();
	let fileError = $state('');
	let readingFile = $state(false);

	async function scanImageFile(event: Event & { currentTarget: HTMLInputElement }) {
		const file = event.currentTarget.files?.[0];
		// Reset so choosing the same file again still fires `change`.
		event.currentTarget.value = '';
		if (!file || disabled || readingFile) return;
		fileError = '';
		if (!file.type.startsWith('image/')) {
			fileError = t.qrUploadNotImage;
			return;
		}
		if (file.size > MAX_QR_IMAGE_BYTES) {
			fileError = t.qrUploadTooLarge;
			return;
		}
		readingFile = true;
		const reader = new Html5Qrcode(fileReaderId);
		try {
			const token = tokenFromScan(await reader.scanFile(file, false));
			if (!token) {
				fileError = t.qrUploadNotFound;
				return;
			}
			if (!inline) isOpen = false;
			onScan(token);
		} catch {
			fileError = t.qrUploadNotFound;
		} finally {
			reader.clear();
			readingFile = false;
		}
	}

	function cameraAttachment(node: HTMLDivElement) {
		const reader = new Html5Qrcode(node.id);
		let handled = false;
		let isMounted = true;

		reader
			.start(
				{ facingMode: 'environment' },
				{
					fps: 10,
					qrbox: (width, height) => {
						const size = Math.floor(Math.min(width, height) * 0.7);
						return { width: size, height: size };
					}
				},
				(decodedText) => {
					if (disabled || (!inline && handled)) return;
					const token = tokenFromScan(decodedText);
					if (!token) return;
					const now = Date.now();
					const isDuplicate = token === lastScannedCode;
					const cooldown = isDuplicate ? 3000 : 1500;
					if (now - lastScanTime <= cooldown) return;
					lastScanTime = now;
					lastScannedCode = token;
					handled = true;
					if (typeof navigator !== 'undefined' && navigator.vibrate) {
						navigator.vibrate(100);
					}
					if (!inline) isOpen = false;
					onScan(token);
				},
				() => {
					// Frame without QR
				}
			)
			.then(() => {
				if (!isMounted && reader.isScanning) {
					reader.stop().catch(() => {});
				}
			})
			.catch((err: unknown) => {
				if (!isMounted) return;
				console.warn('Camera start error:', err);
				cameraError = t.cameraPermissionError;
			});

		return () => {
			isMounted = false;
			if (reader.isScanning) {
				reader.stop().catch(() => {
					// Stop scanning on unmount
				});
			}
		};
	}

	function handleClose() {
		cameraError = '';
		isOpen = false;
	}
</script>

{#snippet cameraViewport()}
	<div
		class="relative mx-auto my-5 flex aspect-square w-full max-w-[280px] items-center justify-center overflow-hidden rounded-2xl bg-slate-950"
		style="isolation: isolate; transform: translateZ(0);"
	>
		<div
			id={scannerElementId}
			{@attach cameraAttachment}
			class="h-full w-full overflow-hidden [&_video]:h-full! [&_video]:w-full! [&_video]:rounded-2xl! [&_video]:bg-transparent! [&_video]:object-cover!"
			style="isolation: isolate; transform: translateZ(0);"
		></div>

		{#if !cameraError}
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
			<div class="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center">
				<CameraOff class="size-10 text-red-400" />
				<p class="text-xs font-semibold text-red-400">{cameraError}</p>
			</div>
		{/if}
	</div>
{/snippet}

{#snippet imagePicker()}
	<div class="mb-3 space-y-2">
		<input
			bind:this={fileInput}
			type="file"
			accept="image/*"
			class="sr-only"
			tabindex="-1"
			aria-hidden="true"
			onchange={scanImageFile}
		/>
		<Button
			type="button"
			variant="outline"
			class="min-h-11 w-full gap-2"
			disabled={disabled || readingFile}
			onclick={() => fileInput?.click()}
		>
			<ImageUp class="size-4" />
			{readingFile ? t.qrUploadReading : t.qrUploadButton}
		</Button>
		<p class="text-center text-xs text-muted-foreground">{t.qrUploadHint}</p>
		{#if fileError}
			<p role="alert" class="text-center text-sm font-medium text-destructive">{fileError}</p>
		{/if}
		<!-- html5-qrcode needs an element to decode a file into; it stays hidden. -->
		<div id={fileReaderId} class="hidden"></div>
	</div>
{/snippet}

{#if inline}
	{@render cameraViewport()}
	{#if !cameraError}
		<p class="mb-3 text-center text-2xs text-muted-foreground">{t.cameraScanHint}</p>
	{/if}
	{@render imagePicker()}
{:else if isOpen}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs">
		<div
			class="relative w-full max-w-md overflow-hidden rounded-3xl border border-border bg-card p-6 shadow-2xl"
		>
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-2">
					<Camera class="h-4 w-4 text-primary" />
					<h3 class="text-sm font-bold text-foreground">{displayTitle}</h3>
				</div>
				<button
					type="button"
					onclick={handleClose}
					class="flex size-8 cursor-pointer items-center justify-center rounded-full bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
				>
					<X class="size-4" />
				</button>
			</div>

			{@render cameraViewport()}

			{#if !cameraError}
				<p class="mb-3 text-center text-2xs text-muted-foreground">
					{t.cameraScanHint}
				</p>
			{/if}

			{@render imagePicker()}

			<button
				type="button"
				onclick={handleClose}
				class="w-full cursor-pointer rounded-xl border border-border py-2.5 text-xs font-bold text-muted-foreground transition-colors hover:bg-muted"
			>
				{t.closeModal}
			</button>
		</div>
	</div>
{/if}
