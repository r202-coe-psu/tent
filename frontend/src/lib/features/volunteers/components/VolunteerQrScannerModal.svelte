<script lang="ts">
	import { Html5Qrcode } from 'html5-qrcode';
	import X from '@lucide/svelte/icons/x';
	import Camera from '@lucide/svelte/icons/camera';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import { languageStore } from '$lib/stores/language.svelte';
	import { jobsI18n } from '$lib/features/volunteers/i18n/jobs.i18n';

	let {
		isOpen = $bindable(false),
		onScan,
		title
	} = $props<{
		isOpen: boolean;
		onScan: (token: string) => void;
		title?: string;
	}>();

	const t = $derived(jobsI18n[languageStore.current]);
	const displayTitle = $derived(title || t.ticketScanTitle);

	let cameraError = $state<string>('');
	const scannerElementId = 'volunteer-qr-camera-reader';

	function tokenFromScan(decoded: string): string {
		const trimmed = decoded.trim();
		const withoutQuery = trimmed.split(/[?#]/)[0];
		const lastSegment = withoutQuery.split('/').filter(Boolean).pop() ?? '';
		return lastSegment || trimmed;
	}

	function cameraAttachment(node: HTMLDivElement) {
		const reader = new Html5Qrcode(node.id);
		let handled = false;

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
					if (handled) return;
					const token = tokenFromScan(decodedText);
					if (!token) return;
					handled = true;
					if (typeof navigator !== 'undefined' && navigator.vibrate) {
						navigator.vibrate(100);
					}
					isOpen = false;
					onScan(token);
				},
				() => {
					// Frame without QR
				}
			)
			.catch((err: unknown) => {
				console.warn('Camera start error:', err);
				cameraError = t.cameraPermissionError;
			});

		return () => {
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

{#if isOpen}
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

			<div
				class="my-5 overflow-hidden rounded-2xl border-2 border-dashed border-primary/50 bg-black/10"
			>
				<div id={scannerElementId} {@attach cameraAttachment} class="w-full"></div>
			</div>

			{#if cameraError}
				<div
					class="mb-3 flex items-center gap-2 rounded-xl bg-destructive/10 p-3 text-xs text-destructive"
				>
					<CircleAlert class="size-4 shrink-0" />
					<span>{cameraError}</span>
				</div>
			{:else}
				<p class="mb-3 text-center text-2xs text-muted-foreground">
					{t.cameraScanHint}
				</p>
			{/if}

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
