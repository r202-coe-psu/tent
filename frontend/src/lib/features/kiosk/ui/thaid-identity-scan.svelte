<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import type { Attachment } from 'svelte/attachments';
	import { resolve } from '$app/paths';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import Clock from '@lucide/svelte/icons/clock';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import { Button } from '$lib/components/ui/button/index.js';
	import { generateQrDataUrl } from '$lib/utils/qrcode';
	import KioskBackButton from './kiosk-back-button.svelte';
	import KioskCheckInWizard from './kiosk-check-in-wizard.svelte';
	import KioskNoticePanel from './kiosk-notice-panel.svelte';
	import KioskPreRegisteredCheckIn from './kiosk-pre-registered-check-in.svelte';
	import { KioskIdleTimeout, KIOSK_IDLE_TIMEOUT_MS } from './kiosk-idle-timeout.svelte.js';
	import {
		KIOSK_NOTICE_PRIMARY_ACTION,
		KIOSK_NOTICE_SECONDARY_ACTION
	} from './kiosk-notice-actions';
	import { navigateToKioskHome } from '../application/kiosk-navigation';
	import { ThaidSession } from '../application/thaid-session.svelte';
	import {
		cancelKioskThaidSession,
		createKioskThaidSession,
		getKioskThaidSessionStatus
	} from '../data/kiosk-thaid.api';
	import type { KioskContextQuery } from '../domain/display-context';

	interface Props {
		contextQuery: KioskContextQuery;
		displayShelterCode: string;
	}

	let { contextQuery, displayShelterCode }: Props = $props();

	const STEPS = ['เปิดกล้องหรือ LINE', 'สแกน QR', 'ยืนยันในแอป ThaiD'] as const;

	const session = new ThaidSession({
		create: createKioskThaidSession,
		getStatus: getKioskThaidSessionStatus,
		cancel: cancelKioskThaidSession
	});
	// Monotonic, like `session.deadline`: the kiosk wall clock never decides how long the QR lives.
	let now = $state(performance.now());

	const homeUrl = $derived(resolve(`/kiosk${contextQuery}`));
	const gate = $derived(session.gate);
	const waitingForScan = $derived(
		session.state === 'idle' || session.state === 'creating' || session.state === 'pending'
	);
	const remainingSeconds = $derived(
		session.deadline === null ? 0 : Math.max(0, Math.ceil((session.deadline - now) / 1000))
	);
	const countdown = $derived(
		`${Math.floor(remainingSeconds / 60)}:${String(remainingSeconds % 60).padStart(2, '0')}`
	);
	// FR-KTD-38: no 60 s kick-out while the QR is alive (its lifetime is the limit); the normal idle
	// timeout covers everything after it - the member list, results, an expired or failed QR.
	const idleTimeout = new KioskIdleTimeout(KIOSK_IDLE_TIMEOUT_MS, () =>
		navigateToKioskHome(contextQuery)
	);

	onMount(() => {
		void session.start();
		return () => {
			idleTimeout.stop();
			session.destroy();
		};
	});

	$effect(() => {
		const waiting = waitingForScan;
		// start() reads `paused`; this effect must follow the scan state only (pausing has its own path).
		untrack(() => (waiting ? idleTimeout.stop() : idleTimeout.start()));
	});

	/** Ticks the countdown while the countdown line is on screen (only while waiting for the scan). */
	const tickClock: Attachment = () => {
		const tick = () => (now = performance.now());
		tick();
		const timer = window.setInterval(tick, 1000);
		return () => window.clearInterval(timer);
	};

	/** Paints the QR for `url` into its <img>; a stale answer (a newer QR already asked) is dropped. */
	const paintQr =
		(url: string): Attachment<HTMLImageElement> =>
		(node) => {
			let stale = false;
			node.removeAttribute('src');
			generateQrDataUrl(url, { width: 640, margin: 2 })
				.then((src) => {
					if (!stale && src) node.src = src;
				})
				.catch(() => {});
			return () => {
				stale = true;
			};
		};

	// Replaced by a newer QR (or cancelled elsewhere) / method switched off: back to the home screen.
	$effect(() => {
		if (session.state === 'cancelled' || session.errorKind === 'disabled') {
			navigateToKioskHome(contextQuery);
		}
	});

	function recordActivity(): void {
		idleTimeout.recordActivity();
	}

	function handlePrintBusyChange(busy: boolean): void {
		idleTimeout.setPaused(busy);
	}

	/** After the hand-off every way out of the result screens ends the visit: back to the home screen. */
	function goHome(): void {
		navigateToKioskHome(contextQuery);
	}

	/** Only the explicit "new QR" / "scan again" actions ask for a fresh QR. */
	function newQr(): void {
		void session.restart();
	}
</script>

<svelte:head>
	<title>สแกนด้วย ThaiD — SmartShelter Kiosk</title>
</svelte:head>

<svelte:window onpointerdown={recordActivity} onkeydown={recordActivity} />

{#if gate}
	<KioskPreRegisteredCheckIn
		input={gate}
		{contextQuery}
		{displayShelterCode}
		onprintbusychange={handlePrintBusyChange}
		onreset={goHome}
		onrescan={newQr}
	/>
{:else}
	<section
		class="thaid-scan-page mx-auto flex w-full max-w-4xl flex-1 flex-col gap-3"
		aria-labelledby="thaid-title"
	>
		<KioskCheckInWizard currentStep={2} step2Label="สแกนด้วย ThaiD" />
		<div class="flex justify-start">
			<KioskBackButton href={homeUrl} />
		</div>

		{#if session.state === 'expired'}
			<KioskNoticePanel tone="warning" icon={Clock} title="QR หมดอายุ" role="status">
				<p>กรุณาสร้าง QR ใหม่แล้วสแกนอีกครั้ง</p>
				{#snippet actions()}
					<Button type="button" onclick={newQr} class={KIOSK_NOTICE_PRIMARY_ACTION}
						><RefreshCw aria-hidden="true" />สร้าง QR ใหม่</Button
					>
					<Button href={homeUrl} variant="outline" class={KIOSK_NOTICE_SECONDARY_ACTION}
						>กลับหน้าเริ่มต้น</Button
					>
				{/snippet}
			</KioskNoticePanel>
		{:else if session.state === 'error' && session.errorKind !== 'disabled'}
			<KioskNoticePanel
				tone="warning"
				icon={CircleAlert}
				title={session.errorKind === 'rate_limited'
					? 'ขอ QR บ่อยเกินไป'
					: 'ใช้ ThaiD ไม่ได้ในขณะนี้'}
				role="alert"
			>
				<p>
					{session.errorKind === 'rate_limited'
						? 'กรุณารอสักครู่ แล้วลองอีกครั้ง'
						: 'ระบบ ThaiD ไม่พร้อมใช้งาน กรุณาลองอีกครั้ง หรือเลือกวิธีอื่น'}
				</p>
				{#snippet actions()}
					<Button type="button" onclick={newQr} class={KIOSK_NOTICE_PRIMARY_ACTION}
						><RefreshCw aria-hidden="true" />ลองอีกครั้ง</Button
					>
					<Button href={homeUrl} variant="outline" class={KIOSK_NOTICE_SECONDARY_ACTION}
						>กลับหน้าเริ่มต้น</Button
					>
				{/snippet}
			</KioskNoticePanel>
		{:else}
			<div
				class="flex flex-1 flex-col items-center justify-center gap-4 landscape:flex-row landscape:gap-8 kiosk-portrait:gap-8"
			>
				<div class="flex flex-col items-center gap-2">
					<div
						class="thaid-qr-frame flex aspect-square items-center justify-center rounded-2xl border border-slate-200 bg-white p-2 shadow-2xs"
					>
						{#if session.qrUrl}
							<img
								{@attach paintQr(session.qrUrl)}
								alt="QR สำหรับยืนยันตัวตนด้วย ThaiD"
								class="size-full object-contain"
							/>
						{:else}
							<span
								class="size-10 animate-spin rounded-full border-[3px] border-slate-300 border-t-[#0A2647] motion-reduce:animate-none"
								role="status"
								aria-label="กำลังสร้าง QR"
							></span>
						{/if}
					</div>
					{#if session.state === 'pending'}
						<p
							{@attach tickClock}
							class="flex items-center gap-2 text-base font-semibold text-slate-700 tabular-nums kiosk-portrait:text-2xl"
						>
							<Clock class="size-5" aria-hidden="true" />QR หมดอายุใน {countdown}
						</p>
					{/if}
				</div>

				<div class="flex max-w-md flex-col gap-3 kiosk-portrait:max-w-xl kiosk-portrait:gap-5">
					<h1
						id="thaid-title"
						class="text-xl font-extrabold tracking-tight text-[#0A2647] sm:text-2xl kiosk-portrait:text-4xl"
					>
						สแกน QR ด้วยมือถือ
					</h1>
					<ol class="flex flex-col gap-2 kiosk-portrait:gap-4">
						{#each STEPS as step, index (step)}
							<li
								class="flex items-center gap-3 text-lg font-semibold text-slate-800 kiosk-portrait:text-3xl"
							>
								<span
									class="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#0A2647] text-base font-bold text-white kiosk-portrait:size-14 kiosk-portrait:text-2xl"
									aria-hidden="true">{index + 1}</span
								>{step}
							</li>
						{/each}
					</ol>
				</div>
			</div>
		{/if}
	</section>
{/if}

<style>
	.thaid-qr-frame {
		width: min(100%, 20rem, max(9rem, calc(100svh - 24rem)));
	}

	@media screen and (orientation: portrait) and (min-height: 1200px) {
		.thaid-qr-frame {
			width: min(100%, 36rem);
		}
	}
</style>
