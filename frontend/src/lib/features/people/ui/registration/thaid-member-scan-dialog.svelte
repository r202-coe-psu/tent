<script lang="ts">
	import { onDestroy } from 'svelte';
	import QRCode from 'qrcode';
	import QrCodeIcon from '@lucide/svelte/icons/qr-code';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import Clock from '@lucide/svelte/icons/clock';
	import RotateCw from '@lucide/svelte/icons/rotate-cw';
	import Smartphone from '@lucide/svelte/icons/smartphone';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { PUBLIC_BOOKING_FORM_I18N } from '$lib/constants/i18n';
	import type { ThaiDAutofillProfile } from '../../domain/thaid-profile';

	interface Props {
		open?: boolean;
		memberLabel?: string;
		onscanned?: (profile: ThaiDAutofillProfile) => void;
	}

	let { open = $bindable(false), memberLabel = '', onscanned }: Props = $props();

	const t = $derived(getTranslation(PUBLIC_BOOKING_FORM_I18N, langState.current));

	type SessionState = 'loading' | 'active' | 'success' | 'expired' | 'error';

	let sessionState = $state<SessionState>('loading');
	let qrDataUrl = $state<string | null>(null);
	let remainingSeconds = $state<number>(900);
	let completedProfile = $state<ThaiDAutofillProfile | null>(null);

	const titleText = $derived(t.thaidScanTitle(memberLabel || t.thaidScanFamilyMember));
	const expiresText = $derived(`${t.thaidScanExpiresIn} ${formatRemainingTime(remainingSeconds)}`);

	let eventSource: EventSource | null = null;
	let countdownTimer: NodeJS.Timeout | null = null;
	let pollTimer: NodeJS.Timeout | null = null;
	let consecutiveNotFoundCount = 0;

	function formatRemainingTime(seconds: number): string {
		const m = Math.floor(Math.max(0, seconds) / 60);
		const s = Math.max(0, seconds) % 60;
		return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
	}

	function cleanupLiveConnections() {
		if (eventSource) {
			eventSource.close();
			eventSource = null;
		}
		if (countdownTimer) {
			clearInterval(countdownTimer);
			countdownTimer = null;
		}
		if (pollTimer) {
			clearInterval(pollTimer);
			pollTimer = null;
		}
	}

	async function startSession() {
		cleanupLiveConnections();
		sessionState = 'loading';
		qrDataUrl = null;
		completedProfile = null;
		consecutiveNotFoundCount = 0;

		try {
			const res = await fetch('/api/public/v1/thaid/scan-session', {
				method: 'POST',
				headers: { Accept: 'application/json' }
			});
			if (!res.ok) throw new Error('Failed to create scan session');
			const data = (await res.json()) as {
				sessionId: string;
				qrUrl: string;
				expiresAt: number;
				ttlSeconds?: number;
			};

			remainingSeconds =
				typeof data.ttlSeconds === 'number' && data.ttlSeconds > 0
					? data.ttlSeconds
					: Math.max(0, Math.floor((data.expiresAt - Date.now()) / 1000)) || 900;

			// Generate QR code image
			qrDataUrl = await QRCode.toDataURL(data.qrUrl, {
				width: 280,
				margin: 1,
				color: {
					dark: '#0f172a',
					light: '#ffffff'
				}
			});

			sessionState = 'active';

			// Start countdown
			countdownTimer = setInterval(() => {
				remainingSeconds -= 1;
				if (remainingSeconds <= 0) {
					sessionState = 'expired';
					cleanupLiveConnections();
				}
			}, 1000);

			// Connect SSE
			connectEventSource(data.sessionId);

			// Setup polling fallback every 3.5s
			pollTimer = setInterval(() => {
				void pollStatus(data.sessionId);
			}, 3500);
		} catch {
			sessionState = 'error';
		}
	}

	function handleScanSuccess(profile: ThaiDAutofillProfile) {
		if (sessionState === 'success') return;
		sessionState = 'success';
		completedProfile = profile;
		cleanupLiveConnections();

		setTimeout(() => {
			onscanned?.(profile);
			open = false;
		}, 1200);
	}

	function connectEventSource(sessionId: string) {
		if (typeof window === 'undefined' || !window.EventSource) return;

		try {
			const es = new EventSource(`/api/public/v1/thaid/scan-session/${sessionId}/events`);
			eventSource = es;

			es.addEventListener('completed', (e: MessageEvent) => {
				try {
					const payload = JSON.parse(e.data) as { profile: ThaiDAutofillProfile };
					if (payload?.profile) {
						handleScanSuccess(payload.profile);
					}
				} catch {
					// ignore malformed SSE event payload
				}
			});

			es.addEventListener('expired', () => {
				if (remainingSeconds <= 0) {
					sessionState = 'expired';
					cleanupLiveConnections();
				}
			});

			es.onerror = () => {
				// Don't mark error — polling fallback will handle it
				es.close();
				eventSource = null;
			};
		} catch {
			// Fallback polling will handle it
		}
	}

	async function pollStatus(sessionId: string) {
		if (sessionState === 'success' || sessionState === 'expired') return;
		try {
			const res = await fetch(`/api/public/v1/thaid/scan-session/${sessionId}`);
			if (!res.ok) {
				if (res.status === 404) {
					consecutiveNotFoundCount += 1;
					// Only transition to expired if we got multiple consecutive 404s or timer ran out
					if (consecutiveNotFoundCount >= 3 || remainingSeconds <= 0) {
						sessionState = 'expired';
						cleanupLiveConnections();
					}
				}
				return;
			}
			consecutiveNotFoundCount = 0;
			const data = (await res.json()) as {
				status: 'pending' | 'completed' | 'expired';
				profile?: ThaiDAutofillProfile;
			};
			if (data.status === 'completed' && data.profile) {
				handleScanSuccess(data.profile);
			} else if (data.status === 'expired') {
				sessionState = 'expired';
				cleanupLiveConnections();
			}
		} catch {
			// ignore transient polling network errors
		}
	}

	$effect(() => {
		if (open) {
			void startSession();
		} else {
			cleanupLiveConnections();
		}
	});

	onDestroy(() => {
		cleanupLiveConnections();
	});
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2 text-base font-bold sm:text-lg">
				<QrCodeIcon class="size-5 text-primary" />
				<span>{titleText}</span>
			</Dialog.Title>
			<Dialog.Description class="text-xs text-muted-foreground">
				{t.thaidScanDesc}
			</Dialog.Description>
		</Dialog.Header>

		<div class="mt-2 flex flex-col items-center justify-center p-2 text-center">
			{#if sessionState === 'loading'}
				<div class="flex h-64 flex-col items-center justify-center gap-3">
					<Loader2 class="size-8 animate-spin text-primary" />
					<p class="text-xs text-muted-foreground">{t.thaidScanGenerating}</p>
				</div>
			{:else if sessionState === 'active'}
				<div
					class="relative flex flex-col items-center rounded-2xl border border-primary/20 bg-muted/20 p-4"
				>
					{#if qrDataUrl}
						<img
							src={qrDataUrl}
							alt={t.thaidScanQrAlt}
							class="size-60 rounded-xl bg-white p-2 shadow-xs"
						/>
					{/if}

					<div
						class="mt-3 flex items-center gap-1.5 rounded-full border border-border bg-background/80 px-3 py-1 text-xs font-semibold text-muted-foreground shadow-2xs"
					>
						<Clock class="size-3.5 text-amber-600" />
						<span>{expiresText}</span>
					</div>
				</div>

				<div
					class="mt-4 flex items-start gap-2 rounded-xl border border-primary/20 bg-primary/5 p-3 text-left"
				>
					<Smartphone class="mt-0.5 size-5 shrink-0 text-primary" />
					<div class="space-y-0.5 text-xs">
						<p class="font-semibold text-foreground">{t.thaidScanHowTo}</p>
						<p class="text-muted-foreground">
							{t.thaidScanStep1Prefix} <strong>{t.thaidScanStep1Camera}</strong>
							{t.thaidScanStep1Or} <strong>{t.thaidScanStep1Line}</strong>
						</p>
						<p class="text-muted-foreground">
							{t.thaidScanStep2}
						</p>
						<p class="text-muted-foreground">{t.thaidScanStep3}</p>
					</div>
				</div>
			{:else if sessionState === 'success'}
				<div class="flex h-64 flex-col items-center justify-center gap-3">
					<div
						class="flex size-16 animate-in items-center justify-center rounded-full bg-primary/10 text-primary duration-300 zoom-in-50"
					>
						<CheckCircle2 class="size-10" />
					</div>
					<h3 class="text-base font-bold text-foreground">{t.thaidScanSuccess}</h3>
					{#if completedProfile}
						<p class="text-xs text-muted-foreground">
							{completedProfile.first_name}
							{completedProfile.last_name}
						</p>
					{/if}
				</div>
			{:else if sessionState === 'expired'}
				<div class="flex h-64 flex-col items-center justify-center gap-3">
					<div
						class="flex size-14 items-center justify-center rounded-full bg-amber-500/10 text-amber-600"
					>
						<Clock class="size-8" />
					</div>
					<h3 class="text-sm font-bold text-foreground">{t.thaidScanExpiredTitle}</h3>
					<p class="max-w-xs text-xs text-muted-foreground">
						{t.thaidScanExpiredDesc}
					</p>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onclick={startSession}
						class="mt-2 gap-1.5"
					>
						<RotateCw class="size-4" />
						{t.thaidScanRegenerate}
					</Button>
				</div>
			{:else if sessionState === 'error'}
				<div class="flex h-64 flex-col items-center justify-center gap-3">
					<p class="text-xs text-destructive">{t.thaidScanError}</p>
					<Button type="button" variant="outline" size="sm" onclick={startSession} class="gap-1.5">
						<RotateCw class="size-4" />
						{t.thaidScanRetry}
					</Button>
				</div>
			{/if}
		</div>

		<Dialog.Footer class="mt-2 flex flex-row items-center justify-between sm:justify-between">
			<Button type="button" variant="ghost" size="sm" onclick={() => (open = false)}>
				{t.thaidScanManual}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
