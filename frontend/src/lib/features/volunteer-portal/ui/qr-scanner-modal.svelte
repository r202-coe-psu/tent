<script lang="ts">
	/**
	 * Camera QR reader for the Access Portal's sign-in and pass screens.
	 *
	 * A deliberate copy of `volunteers/components/VolunteerQrScannerModal.svelte` rather
	 * than an import of it. The two volunteer slices share no code by design (see
	 * `../index.ts`): one renders projected public data with no account, the other is the
	 * staff system of record. Importing across that line is what made a change inside
	 * `features/volunteers` able to break this portal — and it slipped past the barrel
	 * lint rule because `components/` sat outside the four guarded layers. If the two
	 * ever genuinely need one scanner, it belongs in `features/shared`, not in either
	 * slice's internals.
	 *
	 * Hands the decoded payload back untouched apart from the URL-tail trim; deciding
	 * what a payload *means* is `ticketTokenFromScan`'s job in the domain layer.
	 */
	import { Html5Qrcode } from 'html5-qrcode';
	import X from '@lucide/svelte/icons/x';
	import Camera from '@lucide/svelte/icons/camera';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';

	let {
		isOpen = $bindable(false),
		onScan,
		title = 'สแกน QR Code ตั๋วจิตอาสา'
	}: {
		isOpen: boolean;
		onScan: (token: string) => void;
		title?: string;
	} = $props();

	let cameraError = $state<string>('');

	/**
	 * Distinct from the staff scanner's element id on purpose — html5-qrcode mounts by
	 * DOM id, and two readers sharing one id would fight over the same node if both
	 * were ever open at once.
	 */
	const scannerElementId = 'volunteer-portal-qr-camera-reader';

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
			.catch(() => {
				cameraError = 'ไม่สามารถเข้าถึงกล้องได้ โปรดตรวจสอบการอนุญาตใช้งานกล้อง';
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
					<h3 class="text-sm font-bold text-foreground">{title}</h3>
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
					หันกล้องไปยัง QR Code บนตั๋วดิจิทัลหรือบัตรงานจิตอาสา
				</p>
			{/if}

			<button
				type="button"
				onclick={handleClose}
				class="w-full cursor-pointer rounded-xl border border-border py-2.5 text-xs font-bold text-muted-foreground transition-colors hover:bg-muted"
			>
				ปิดหน้าต่าง
			</button>
		</div>
	</div>
{/if}
