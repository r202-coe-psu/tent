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
	import type { ThaiDAutofillProfile } from '../../domain/thaid-profile';

	interface Props {
		open?: boolean;
		memberLabel?: string;
		onscanned?: (profile: ThaiDAutofillProfile) => void;
	}

	let {
		open = $bindable(false),
		memberLabel = 'สมาชิกในครอบครัว',
		onscanned
	}: Props = $props();

	type SessionState = 'loading' | 'active' | 'success' | 'expired' | 'error';

	let sessionState = $state<SessionState>('loading');
	let qrDataUrl = $state<string | null>(null);
	let remainingSeconds = $state<number>(300);
	let completedProfile = $state<ThaiDAutofillProfile | null>(null);

	let currentSessionId: string | null = null;
	let eventSource: EventSource | null = null;
	let countdownTimer: NodeJS.Timeout | null = null;
	let pollTimer: NodeJS.Timeout | null = null;

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
			};

			currentSessionId = data.sessionId;
			const totalSec = Math.max(0, Math.floor((data.expiresAt - Date.now()) / 1000));
			remainingSeconds = totalSec;

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
				} catch {}
			});

			es.addEventListener('expired', () => {
				sessionState = 'expired';
				cleanupLiveConnections();
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
					sessionState = 'expired';
					cleanupLiveConnections();
				}
				return;
			}
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
		} catch {}
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
				<span>ดึงข้อมูล {memberLabel} ผ่าน ThaiD</span>
			</Dialog.Title>
			<Dialog.Description class="text-xs text-muted-foreground">
				ให้สมาชิกใช้กล้องมือถือสแกน QR Code นี้ เพื่อยืนยันตัวตนและยินยอมส่งข้อมูล
			</Dialog.Description>
		</Dialog.Header>

		<div class="mt-2 flex flex-col items-center justify-center p-2 text-center">
			{#if sessionState === 'loading'}
				<div class="flex h-64 flex-col items-center justify-center gap-3">
					<Loader2 class="size-8 animate-spin text-primary" />
					<p class="text-xs text-muted-foreground">กำลังสร้าง QR Code เชื่อมต่อ ThaiD...</p>
				</div>
			{:else if sessionState === 'active'}
				<div class="relative flex flex-col items-center rounded-2xl border border-primary/20 bg-muted/20 p-4">
					{#if qrDataUrl}
						<img
							src={qrDataUrl}
							alt="ThaiD Member Scan QR Code"
							class="size-60 rounded-xl bg-white p-2 shadow-xs"
						/>
					{/if}

					<div class="mt-3 flex items-center gap-1.5 rounded-full bg-background/80 px-3 py-1 text-xs font-semibold text-muted-foreground shadow-2xs border border-border">
						<Clock class="size-3.5 text-amber-600" />
						<span>หมดอายุใน {formatRemainingTime(remainingSeconds)}</span>
					</div>
				</div>

				<div class="mt-4 flex items-start gap-2 text-left rounded-xl bg-primary/5 p-3 border border-primary/20">
					<Smartphone class="size-5 shrink-0 text-primary mt-0.5" />
					<div class="text-xs space-y-0.5">
						<p class="font-semibold text-foreground">วิธีสแกนสำหรับสมาชิก:</p>
						<p class="text-muted-foreground">1. เปิด <strong>กล้องถ่ายรูปมือถือ</strong> หรือ <strong>แอป LINE</strong></p>
						<p class="text-muted-foreground">2. ส่องมาที่ QR Code นี้ เพื่อเข้าสู่หน้ายืนยันตัวตน ThaiD</p>
						<p class="text-muted-foreground">3. ยืนยันบนมือถือ ข้อมูลจะวิ่งมาแสดงบนหน้านี้ทันที</p>
					</div>
				</div>
			{:else if sessionState === 'success'}
				<div class="flex h-64 flex-col items-center justify-center gap-3">
					<div class="flex size-16 items-center justify-center rounded-full bg-primary/10 text-primary animate-in zoom-in-50 duration-300">
						<CheckCircle2 class="size-10" />
					</div>
					<h3 class="text-base font-bold text-foreground">ดึงข้อมูลสำเร็จ!</h3>
					{#if completedProfile}
						<p class="text-xs text-muted-foreground">
							{completedProfile.first_name} {completedProfile.last_name}
						</p>
					{/if}
				</div>
			{:else if sessionState === 'expired'}
				<div class="flex h-64 flex-col items-center justify-center gap-3">
					<div class="flex size-14 items-center justify-center rounded-full bg-amber-500/10 text-amber-600">
						<Clock class="size-8" />
					</div>
					<h3 class="text-sm font-bold text-foreground">QR Code หมดอายุแล้ว</h3>
					<p class="text-xs text-muted-foreground max-w-xs">
						ไม่ได้ทำรายการภายในเวลาที่กำหนด กรุณากดปุ่มเพื่อสร้าง QR Code ใหม่
					</p>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onclick={startSession}
						class="mt-2 gap-1.5"
					>
						<RotateCw class="size-4" />
						สร้าง QR Code ใหม่
					</Button>
				</div>
			{:else if sessionState === 'error'}
				<div class="flex h-64 flex-col items-center justify-center gap-3">
					<p class="text-xs text-destructive">เกิดข้อผิดพลาดในการสร้างเซสชัน</p>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onclick={startSession}
						class="gap-1.5"
					>
						<RotateCw class="size-4" />
						ลองใหม่อีกครั้ง
					</Button>
				</div>
			{/if}
		</div>

		<Dialog.Footer class="mt-2 flex flex-row items-center justify-between sm:justify-between">
			<Button
				type="button"
				variant="ghost"
				size="sm"
				onclick={() => (open = false)}
			>
				กรอกข้อมูลด้วยตนเอง (Manual)
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
