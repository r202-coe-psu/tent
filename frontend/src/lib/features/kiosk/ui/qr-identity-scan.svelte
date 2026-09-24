<script lang="ts">
	import { Html5Qrcode } from 'html5-qrcode';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import CameraOff from '@lucide/svelte/icons/camera-off';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import { Button } from '$lib/components/ui/button/index.js';
	import KioskCheckInWizard from './kiosk-check-in-wizard.svelte';
	import type { GateInput } from '../data/kiosk-check-in.api';
	import KioskPreRegisteredCheckIn from './kiosk-pre-registered-check-in.svelte';
	import { KioskIdleTimeout, KIOSK_IDLE_TIMEOUT_MS } from './kiosk-idle-timeout.svelte.js';

	interface Props {
		contextQuery: string;
		displayShelterCode: string;
	}

	let { contextQuery, displayShelterCode }: Props = $props();
	let gate = $state<GateInput | null>(null);
	let cameraError = $state('');
	let scanNotice = $state('');
	let cameraAttempt = $state(0);
	let lastScanTime = 0;

	const backUrl = $derived(resolve(`/kiosk${contextQuery as `?${string}`}`));
	const idleTimeout = new KioskIdleTimeout(KIOSK_IDLE_TIMEOUT_MS, () => {
		resetScan();
		void goto(resolve(`/kiosk${contextQuery as `?${string}`}`));
	});
	const cameraReaderId = 'kiosk-registration-qr-reader';
	const tokenPattern = /^evacuee:[0-7][0-9A-HJKMNP-TV-Z]{25}$/i;

	$effect(() => {
		if (!gate) return;
		idleTimeout.start();
		return () => idleTimeout.stop();
	});

	function recordActivity(): void {
		idleTimeout.recordActivity();
	}

	function handlePrintBusyChange(busy: boolean): void {
		idleTimeout.setPaused(busy);
	}

	function handleScan(decodedValue: string): void {
		if (gate) return;
		const now = Date.now();
		if (now - lastScanTime < 1500) return;
		lastScanTime = now;

		const token = decodedValue.trim();
		if (!tokenPattern.test(token)) {
			scanNotice = 'QR นี้ใช้รายงานตัวไม่ได้';
			return;
		}

		scanNotice = '';
		cameraError = '';
		gate = { source: 'qr', token: `evacuee:${token.slice(token.indexOf(':') + 1).toUpperCase()}` };
		if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(100);
	}

	function cameraAttachment(node: HTMLDivElement) {
		const reader = new Html5Qrcode(node.id);
		let isMounted = true;
		reader
			.start(
				{ facingMode: 'environment' },
				{
					fps: 10,
					qrbox: (width, height) => {
						const size = Math.floor(Math.min(width, height) * 0.72);
						return { width: size, height: size };
					}
				},
				(decodedText) => handleScan(decodedText),
				() => {}
			)
			.then(() => {
				if (!isMounted && reader.isScanning) reader.stop().catch(() => {});
			})
			.catch(() => {
				if (isMounted) cameraError = 'เปิดกล้องไม่ได้';
			});

		return () => {
			isMounted = false;
			if (reader.isScanning) reader.stop().catch(() => {});
		};
	}

	function retryCamera(): void {
		cameraError = '';
		scanNotice = '';
		cameraAttempt += 1;
	}

	function resetScan(): void {
		gate = null;
		scanNotice = '';
		cameraError = '';
		retryCamera();
	}
</script>

<svelte:head>
	<title>สแกน QR — SmartShelter Kiosk</title>
</svelte:head>

<svelte:window onpointerdown={recordActivity} onkeydown={recordActivity} />

{#if gate}
	<KioskPreRegisteredCheckIn
		input={gate}
		{contextQuery}
		{displayShelterCode}
		onprintbusychange={handlePrintBusyChange}
		onreset={resetScan}
	/>
{:else}
	<section
		class="qr-scan-page mx-auto flex w-full max-w-3xl flex-col gap-3"
		aria-labelledby="qr-title"
	>
		<KioskCheckInWizard currentStep={2} />
		<div class="qr-scan-back flex justify-start">
			<Button
				href={backUrl}
				variant="ghost"
				aria-label="กลับหน้าเริ่มต้น"
				class="min-h-11 gap-2 px-3 text-base font-semibold text-[#0A2647] focus-visible:ring-2 focus-visible:ring-[#0A2647]"
			>
				<ArrowLeft class="h-5 w-5" aria-hidden="true" />กลับ
			</Button>
		</div>

		<header class="text-center">
			<h1 id="qr-title" class="text-2xl font-extrabold tracking-tight text-[#0A2647] sm:text-3xl">
				สแกน QR ลงทะเบียน
			</h1>
		</header>

		<section
			class="qr-scan-card rounded-2xl border border-slate-200 bg-white p-3 shadow-2xs sm:p-4"
		>
			<div
				class="qr-camera-frame relative mx-auto w-full max-w-sm overflow-hidden rounded-xl border border-slate-200 bg-slate-900"
			>
				<div class="relative aspect-square w-full overflow-hidden">
					{#key cameraAttempt}
						<div
							id={cameraReaderId}
							{@attach cameraAttachment}
							class="absolute inset-0 h-full w-full overflow-hidden [&_video]:h-full! [&_video]:w-full! [&_video]:object-cover!"
							aria-label="ภาพจากกล้องสแกน QR"
						></div>
					{/key}
					{#if !cameraError}
						<div class="pointer-events-none absolute inset-[10%]" aria-hidden="true">
							<span
								class="absolute top-0 left-0 h-8 w-8 rounded-tl-lg border-t-4 border-l-4 border-white"
							></span>
							<span
								class="absolute top-0 right-0 h-8 w-8 rounded-tr-lg border-t-4 border-r-4 border-white"
							></span>
							<span
								class="absolute bottom-0 left-0 h-8 w-8 rounded-bl-lg border-b-4 border-l-4 border-white"
							></span>
							<span
								class="absolute right-0 bottom-0 h-8 w-8 rounded-br-lg border-r-4 border-b-4 border-white"
							></span>
						</div>
					{:else}
						<div
							class="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#F8FAFC] px-4 text-center"
						>
							<CameraOff class="h-9 w-9 text-slate-500" aria-hidden="true" />
							<p class="text-base font-semibold text-slate-700" role="status">{cameraError}</p>
							<Button
								type="button"
								onclick={retryCamera}
								class="min-h-12 gap-2 bg-[#0A2647] px-4 text-base font-bold text-white hover:bg-[#051930]"
								><RefreshCw class="h-5 w-5" aria-hidden="true" />ลองอีกครั้ง</Button
							>
						</div>
					{/if}
				</div>
			</div>
			<p
				class="qr-scan-hint mt-3 text-center text-base font-semibold text-slate-700"
				aria-live="polite"
			>
				วาง QR ในกรอบ
			</p>
			{#if scanNotice}
				<div
					class="mt-3 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-950"
					role="alert"
				>
					<AlertCircle class="h-5 w-5 shrink-0" aria-hidden="true" />
					<p class="text-sm font-semibold sm:text-base">{scanNotice}</p>
				</div>
			{/if}
		</section>
	</section>
{/if}

<style>
	.qr-camera-frame {
		width: min(100%, 24rem, max(10rem, calc(100svh - 20rem)));
	}

	@media (max-height: 650px) {
		.qr-scan-page {
			gap: 0.25rem;
		}

		.qr-scan-card {
			padding: 0.25rem;
		}

		.qr-scan-hint {
			margin-top: 0.25rem;
		}

		.qr-scan-back {
			margin-top: -0.125rem;
		}
	}

	:global(#kiosk-registration-qr-reader *) {
		background: transparent !important;
		background-color: transparent !important;
		border: none !important;
	}
</style>
