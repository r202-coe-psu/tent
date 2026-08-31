<script lang="ts">
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import Camera from '@lucide/svelte/icons/camera';
	import Check from '@lucide/svelte/icons/check';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import ClipboardList from '@lucide/svelte/icons/clipboard-list';
	import Clock from '@lucide/svelte/icons/clock';
	import Lock from '@lucide/svelte/icons/lock';
	import LogOut from '@lucide/svelte/icons/log-out';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Maximize2 from '@lucide/svelte/icons/maximize-2';
	import Phone from '@lucide/svelte/icons/phone';
	import QrCode from '@lucide/svelte/icons/qr-code';
	import Rocket from '@lucide/svelte/icons/rocket';
	import Search from '@lucide/svelte/icons/search';
	import Shield from '@lucide/svelte/icons/shield';
	import X from '@lucide/svelte/icons/x';
	import { Html5Qrcode } from 'html5-qrcode';
	import QRCode from 'qrcode';
	import { toast } from 'svelte-sonner';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import {
		useRespondToDispatchMutation,
		useVolunteerSchedule,
		useVolunteerTickets
	} from '../application/queries';
	import {
		responseCodeSchema,
		ticketFindSchema,
		type ScheduleShift,
		type TicketSummary
	} from '../domain/volunteer';

	// ── VIEW MODEL ─────────────────────────────────────────────────────────────
	// One shape for both sources. The demo fixtures below and the live API are mapped
	// into it, so the markup underneath never has to know which one it is rendering.
	interface PortalShift {
		id: string;
		shiftPeriod: string;
		statusBadge: string;
		statusVariant: 'checked_in' | 'completed' | 'pending';
		title: string;
		description: string;
		location: string;
		dateText: string;
		checkinTime?: string;
		checkoutTime?: string;
		checkinBy?: string;
		/** `shift_assignment:{ulid}` — present only on live shifts. */
		assignmentId?: string;
		/** `dispatched` is an offer still awaiting an answer (CR-092 FR-VOL-06). */
		dispatchStatus?: string | null;
	}

	interface PortalVolunteer {
		id: string;
		token: string;
		name: string;
		avatar: string;
		phone: string;
		shelterName: string;
		shelterCode: string;
		verified: boolean;
		statusText: string;
		statusType: 'active' | 'pending' | 'idle';
		roleType: string;
		readiness: boolean;
		scheduleCount: number;
		openingsCount: number;
		shifts: PortalShift[];
	}

	// ── STATE ──────────────────────────────────────────────────────────────────
	let loginTab = $state<'phone' | 'qr'>('phone');
	let inputPhone = $state('');
	let inputToken = $state('');
	let loginError = $state('');

	/** The phone this session signed in with. Empty = signed out. */
	let livePhone = $state('');

	const scheduleQuery = useVolunteerSchedule(() => livePhone);
	const ticketsQuery = useVolunteerTickets(() => livePhone);
	const respond = useRespondToDispatchMutation(() => livePhone);

	/** Per-offer code entry, keyed by assignment so two offers keep their own box. */
	let dispatchCodes = $state<Record<string, string>>({});
	let dispatchErrors = $state<Record<string, string>>({});
	let answering = $state<string | null>(null);
	// ── LIVE SESSION → VIEW MODEL ──────────────────────────────────────────────

	const SHIFT_BADGE: Record<string, { label: string; variant: PortalShift['statusVariant'] }> = {
		assigned: { label: 'ได้รับมอบหมาย (Assigned)', variant: 'pending' },
		standby: { label: 'รอสแตนด์บาย (Standby)', variant: 'pending' },
		checked_in: { label: 'เช็คอินเข้างานแล้ว (Checked-In)', variant: 'checked_in' },
		completed: { label: 'เสร็จสิ้นภารกิจแล้ว (Completed)', variant: 'completed' },
		done: { label: 'เสร็จสิ้นภารกิจแล้ว (Completed)', variant: 'completed' },
		no_show: { label: 'ไม่มาปฏิบัติงาน (No-show)', variant: 'completed' }
	};

	function clockText(iso: string | null): string | undefined {
		if (!iso) return undefined;
		const parsed = new Date(iso);
		return Number.isNaN(parsed.getTime())
			? undefined
			: `${parsed.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} น.`;
	}

	function timeRange(shift: ScheduleShift): string {
		if (!shift.start_ts) return shift.date;
		const start = new Date(shift.start_ts);
		if (Number.isNaN(start.getTime())) return shift.date;
		const opts = { hour: '2-digit', minute: '2-digit' } as const;
		const from = start.toLocaleTimeString('th-TH', opts);
		const end = shift.end_ts ? new Date(shift.end_ts) : null;
		const to =
			end && !Number.isNaN(end.getTime()) ? ` - ${end.toLocaleTimeString('th-TH', opts)}` : '';
		return `${shift.date} • ${from}${to}`;
	}

	function toPortalShift(shift: ScheduleShift): PortalShift {
		const badge = SHIFT_BADGE[shift.status] ?? {
			label: shift.status,
			variant: 'pending' as const
		};
		return {
			id: shift.assignment_id,
			assignmentId: shift.assignment_id,
			dispatchStatus: shift.dispatch_status,
			shiftPeriod: shift.shift === 'custom' ? 'กะงาน' : shift.shift,
			statusBadge: badge.label,
			statusVariant: badge.variant,
			title: shift.job_title || 'งานอาสาสมัคร',
			description: shift.station ? `จุดปฏิบัติงาน: ${shift.station}` : '',
			location: shift.shelter_name || shift.shelter_code,
			dateText: timeRange(shift),
			checkinTime: clockText(shift.check_in_at),
			checkoutTime: clockText(shift.check_out_at)
		};
	}

	function toPortalVolunteer(
		phone: string,
		shifts: ScheduleShift[],
		tickets: TicketSummary[]
	): PortalVolunteer {
		const named = tickets.find((t) => t.applicant_name)?.applicant_name ?? '';
		const first = shifts[0];
		return {
			id: phone,
			// The portal signs in by phone, so this is what the QR encodes for the
			// check-in station — there is no per-volunteer token on this screen.
			token: `VOL-${phone}`,
			name: named || 'จิตอาสา',
			avatar: (named || 'อา').slice(0, 2),
			phone,
			shelterName: first?.shelter_name ?? '',
			shelterCode: first?.shelter_code ?? '',
			verified: true,
			statusText: shifts.some((s) => s.status === 'checked_in')
				? 'ปฏิบัติหน้าที่อยู่'
				: shifts.length
					? 'พร้อมปฏิบัติงาน'
					: 'รอการมอบหมาย',
			statusType: shifts.some((s) => s.status === 'checked_in') ? 'active' : 'pending',
			roleType: '⚡ Operational (จิตอาสาทั่วไป)',
			readiness: shifts.length > 0,
			scheduleCount: shifts.length,
			openingsCount: tickets.length,
			shifts: shifts.map(toPortalShift)
		};
	}

	const liveVolunteer = $derived.by(() => {
		if (!livePhone) return null;
		// Held back until the schedule has answered, so the dashboard does not flash an
		// empty roster at someone who does have shifts.
		if (scheduleQuery.isPending) return null;
		return toPortalVolunteer(livePhone, scheduleQuery.data ?? [], ticketsQuery.data ?? []);
	});

	/** The open session, or null when signed out. The markup below reads only this. */
	const currentVolunteer = $derived(liveVolunteer);

	let dashboardTab = $state<'schedule' | 'openings'>('schedule');
	let searchJobQuery = $state('');
	let selectedShelterFilter = $state('all');
	let isPassModalOpen = $state(false);
	let passModalEl = $state<HTMLElement | null>(null);
	let isPassFullscreen = $state(false);

	/**
	 * Blow the pass up to the whole screen for the gate.
	 *
	 * The volunteer holds this out to be scanned, often outdoors — filling the screen
	 * makes the QR bigger and lets the device brightness work on it. Fails quietly:
	 * iOS Safari does not grant fullscreen on arbitrary elements, and the modal is
	 * still perfectly usable without it.
	 */
	async function togglePassFullscreen() {
		try {
			if (document.fullscreenElement) {
				await document.exitFullscreen();
			} else if (passModalEl) {
				await passModalEl.requestFullscreen();
			}
		} catch {
			toast.info('อุปกรณ์นี้ไม่รองรับการขยายเต็มจอ');
		}
	}

	function closePassModal() {
		if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
		isPassModalOpen = false;
	}
	let isCameraModalOpen = $state(false);
	let cameraError = $state('');

	function closeCamera() {
		isCameraModalOpen = false;
		cameraError = '';
	}

	/**
	 * Read a volunteer QR and sign in with what it contains.
	 *
	 * The pass encodes its own URL, so the payload is either a bare token or a link
	 * ending in one — both reduce to the last path segment. Anything else is left for
	 * `handleTokenLogin` to reject, rather than guessed at here.
	 */
	function tokenFromScan(decoded: string): string {
		const trimmed = decoded.trim();
		const withoutQuery = trimmed.split(/[?#]/)[0];
		const lastSegment = withoutQuery.split('/').filter(Boolean).pop() ?? '';
		return (lastSegment || trimmed).toUpperCase();
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
					// One scan per opening. The camera keeps firing while the modal tears
					// down, and a second hit would navigate twice.
					if (handled) return;
					const token = tokenFromScan(decodedText);
					if (!token) return;
					handled = true;
					if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(100);
					isCameraModalOpen = false;
					inputToken = token;
					submitToken(token);
				},
				() => {
					// Fires on every frame that does not contain a code — not an error.
				}
			)
			.catch(() => {
				cameraError = 'ไม่สามารถเข้าถึงกล้องได้ โปรดตรวจสอบการอนุญาตใช้งานกล้อง';
			});

		return () => {
			if (reader.isScanning) {
				reader.stop().catch(() => {
					// The view is unmounting; nothing actionable to surface.
				});
			}
		};
	}
	let qrDataUrl = $state<string>('');

	// Generate QR Code data URL when volunteer is active
	$effect(() => {
		if (currentVolunteer) {
			const payload = `SMARTSHELTER:VOLUNTEER:${currentVolunteer.token}:${currentVolunteer.phone}`;
			QRCode.toDataURL(payload, {
				width: 320,
				margin: 1,
				color: { dark: '#0A2647', light: '#ffffff' }
			})
				.then((url) => {
					qrDataUrl = url;
				})
				.catch(() => {
					qrDataUrl = '';
				});
		} else {
			qrDataUrl = '';
		}
	});

	// Filter demo list
	function handlePhoneLogin(e: SubmitEvent) {
		e.preventDefault();
		loginError = '';
		const trimmed = inputPhone.trim().replace(/[-\s]/g, '');
		if (!trimmed) {
			loginError = 'กรุณากรอกเบอร์โทรศัพท์ที่ลงทะเบียนไว้';
			return;
		}

		const parsed = ticketFindSchema.safeParse({ phone: trimmed });
		if (!parsed.success) {
			loginError = parsed.error.issues[0]?.message ?? 'เบอร์โทรศัพท์ไม่ถูกต้อง';
			return;
		}
		// The normalised form, so the query key matches however it was typed. What comes
		// back is whatever the server holds — a number with no shifts opens an empty
		// dashboard rather than a session invented on the spot.
		livePhone = parsed.data.phone;
	}

	/**
	 * Sign in with a ticket code, from the form or from a QR scan.
	 *
	 * A real code opens its own pass: that page resolves the token itself and is where
	 * the QR for on-site check-in lives, so there is nothing to look up here.
	 */
	function submitToken(value: string) {
		loginError = '';
		const trimmed = value.trim().toUpperCase();
		if (!trimmed) {
			loginError = 'กรุณากรอกรหัส Token หรือรหัสตั๋วจิตอาสา';
			return;
		}
		if (trimmed.startsWith('TKT-VOL-') || trimmed.startsWith('VIEW-')) {
			void goto(resolve(`/volunteer/ticket/${encodeURIComponent(trimmed)}`));
			return;
		}
		loginError = 'ไม่พบรหัสตั๋วหรือ Token ในระบบ กรุณาตรวจสอบอีกครั้ง';
	}

	function handleTokenLogin(e: SubmitEvent) {
		e.preventDefault();
		submitToken(inputToken);
	}

	/**
	 * Answer an offered shift (CR-092 FR-VOL-06).
	 *
	 * Two factors: the number this session signed in with, and the short code a manager
	 * reads out on the phone. The phone alone is guessable and a declined shift cannot
	 * be un-declined from here, so the code is what makes the write safe.
	 */
	async function answerDispatch(shift: PortalShift, action: 'accepted' | 'declined') {
		const assignmentId = shift.assignmentId;
		if (!assignmentId) return;

		const parsed = responseCodeSchema.safeParse(dispatchCodes[assignmentId] ?? '');
		if (!parsed.success) {
			dispatchErrors[assignmentId] =
				parsed.error.issues[0]?.message ?? 'กรุณากรอกรหัสที่เจ้าหน้าที่แจ้ง';
			return;
		}
		dispatchErrors[assignmentId] = '';
		answering = assignmentId;
		try {
			await respond.mutateAsync({ assignment_id: assignmentId, code: parsed.data, action });
			toast.success(action === 'accepted' ? 'ยอมรับภารกิจแล้ว' : 'ปฏิเสธภารกิจแล้ว');
			dispatchCodes[assignmentId] = '';
		} catch (err) {
			const message = err instanceof Error ? err.message : 'ตอบรับภารกิจไม่สำเร็จ';
			dispatchErrors[assignmentId] = message;
			toast.error(message);
		} finally {
			answering = null;
		}
	}

	function handleLogout() {
		livePhone = '';
		readinessOverride = null;
		dispatchCodes = {};
		dispatchErrors = {};
		inputPhone = '';
		inputToken = '';
		loginError = '';
		toast.info('ออกจากระบบแล้ว');
	}

	/**
	 * Availability, as the volunteer last set it in this session.
	 *
	 * Held separately from `currentVolunteer` because that is derived from the server
	 * response: writing to it was lost the moment the schedule refetched, which is why
	 * the two buttons appeared to do nothing.
	 *
	 * Not persisted yet — no endpoint accepts it. See the note in CR-096.
	 */
	let readinessOverride = $state<boolean | null>(null);
	const isReady = $derived(readinessOverride ?? currentVolunteer?.readiness ?? false);

	function setReadiness(value: boolean) {
		// Two buttons, each setting one value. They used to share a toggle, so pressing
		// the one already active flipped the state to the opposite of what it said.
		if (isReady === value) return;
		readinessOverride = value;
		toast.success(value ? 'อัปเดตสถานะ: พร้อมปฏิบัติงาน 🟢' : 'อัปเดตสถานะ: พักผ่อน/ไม่พร้อม ⚪');
	}

	function handleBookJob(jobTitle: string) {
		toast.success(`จองภารกิจ "${jobTitle}" สำเร็จ! ได้รับตั๋วดิจิทัลแล้ว`);
		if (currentVolunteer) {
			currentVolunteer.scheduleCount += 1;
		}
	}

	function handleRequestReview(jobTitle: string) {
		toast.info(`ยื่นขอปฏิบัติงาน "${jobTitle}" แล้ว รอเจ้าหน้าที่ตรวจสอบคุณสมบัติ`);
	}
</script>

<div class="mx-auto w-full max-w-6xl space-y-8">
	<!-- TOP BRAND HEADER -->
	<header class="space-y-3 text-center">
		<div
			class="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3.5 py-1 text-2xs font-bold text-amber-700 dark:text-amber-400"
		>
			<Lock class="size-3.5" />
			<span>VOLUNTEER ACCESS PORTAL</span>
		</div>
		<h1 class="text-3xl font-extrabold tracking-tight text-foreground md:text-4xl">
			เข้าสู่ระบบตารางทำงานจิตอาสา
		</h1>
		<p class="mx-auto max-w-xl text-sm font-medium text-muted-foreground">
			กรุณาระบุหมายเลขโทรศัพท์ หรือสแกน QR Code / กรอกรหัส Token เพื่อเข้าสู่ระบบและจัดการตารางงาน
		</p>
	</header>

	{#if !currentVolunteer}
		<!-- ── NOT SIGNED IN VIEW ───────────────────────────────────────────── -->
		<div class="mx-auto max-w-2xl space-y-6">
			<!-- MAIN LOGIN CARD -->
			<div class="rounded-3xl border border-border bg-card p-6 shadow-sm md:p-8">
				<!-- TAB SWITCHER -->
				<div class="mb-6 flex rounded-2xl bg-muted/40 p-1.5">
					<button
						type="button"
						onclick={() => (loginTab = 'phone')}
						class="flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-3 text-xs font-bold transition-all md:text-sm {loginTab ===
						'phone'
							? 'bg-primary text-primary-foreground shadow-md'
							: 'text-muted-foreground hover:text-foreground'}"
					>
						<Phone class="size-4" />
						<span>เข้าสู่ระบบด้วยเบอร์โทรศัพท์</span>
					</button>

					<button
						type="button"
						onclick={() => (loginTab = 'qr')}
						class="flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-3 text-xs font-bold transition-all md:text-sm {loginTab ===
						'qr'
							? 'bg-primary text-primary-foreground shadow-md'
							: 'text-muted-foreground hover:text-foreground'}"
					>
						<QrCode class="size-4" />
						<span>สแกน QR ตั๋ว / รหัส Token</span>
					</button>
				</div>

				{#if loginTab === 'phone'}
					<!-- TAB 1: PHONE LOGIN -->
					<form onsubmit={handlePhoneLogin} class="space-y-4">
						<div class="space-y-1.5">
							<label for="volunteer-phone-input" class="text-xs font-bold text-foreground">
								หมายเลขโทรศัพท์ที่ลงทะเบียนไว้ <span class="text-destructive">*</span>
							</label>
							<div class="relative">
								<div
									class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-muted-foreground"
								>
									<Phone class="size-4" />
								</div>
								<input
									id="volunteer-phone-input"
									type="tel"
									bind:value={inputPhone}
									placeholder="เช่น 081-234-5678"
									class="w-full rounded-xl border border-border bg-muted/20 py-3.5 pr-4 pl-10 text-xs font-medium text-foreground outline-hidden transition-all focus:border-primary focus:bg-card focus:ring-1 focus:ring-primary md:text-sm"
								/>
							</div>
							<p class="text-2xs text-muted-foreground">
								กรอกเบอร์โทรศัพท์เดียวกันกับที่ลงทะเบียนไว้ในระบบฐานข้อมูลอาสาสมัคร
							</p>
						</div>

						{#if loginError}
							<div
								class="flex items-center gap-2 rounded-xl bg-destructive/10 p-3 text-xs font-medium text-destructive"
							>
								<CircleAlert class="size-4 shrink-0" />
								<span>{loginError}</span>
							</div>
						{/if}

						<button
							type="submit"
							class="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary py-3.5 text-sm font-bold text-primary-foreground shadow-md transition-all hover:opacity-95 active:scale-[0.99]"
						>
							<Rocket class="size-4" />
							<span>เข้าสู่ระบบทันที</span>
						</button>
					</form>
				{:else}
					<!-- TAB 2: QR & TOKEN LOGIN -->
					<div class="space-y-6">
						<form onsubmit={handleTokenLogin} class="space-y-2">
							<label for="volunteer-token-input" class="text-xs font-bold text-foreground">
								กรอกรหัส Token หรือ รหัสตั๋วจิตอาสา
							</label>
							<div class="flex gap-2">
								<input
									id="volunteer-token-input"
									type="text"
									bind:value={inputToken}
									placeholder="เช่น TKT-VOL-1001 หรือ V-1001"
									class="flex-1 rounded-xl border border-border bg-muted/20 px-3.5 py-3 text-xs font-medium text-foreground outline-hidden transition-all focus:border-primary focus:bg-card focus:ring-1 focus:ring-primary md:text-sm"
								/>
								<button
									type="submit"
									class="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-xl bg-primary px-5 py-3 text-xs font-bold text-primary-foreground shadow-sm hover:opacity-95"
								>
									<Rocket class="size-3.5" />
									<span>เข้าสู่ระบบ</span>
								</button>
							</div>
						</form>

						<div class="relative flex items-center justify-center">
							<div class="w-full border-t border-border"></div>
							<span class="absolute bg-card px-3 text-2xs font-bold text-muted-foreground"
								>หรือ</span
							>
						</div>

						<!-- QR SCANNER SECTION -->
						<div class="space-y-4 text-center">
							<p class="text-xs font-bold text-foreground">สแกน QR Code ตั๋วประจำตัวอาสาสมัคร</p>
							<div
								class="mx-auto flex size-20 items-center justify-center rounded-2xl border border-sky-200/60 bg-sky-50 text-sky-600 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-400"
							>
								<QrCode class="size-10" />
							</div>

							<button
								type="button"
								onclick={() => (isCameraModalOpen = true)}
								class="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary py-3.5 text-sm font-bold text-primary-foreground shadow-md transition-all hover:opacity-95 active:scale-[0.99]"
							>
								<Camera class="size-4" />
								<span>เปิดกล้องสแกน QR Code ตั๋ว</span>
							</button>
						</div>

						{#if loginError}
							<div
								class="flex items-center gap-2 rounded-xl bg-destructive/10 p-3 text-xs font-medium text-destructive"
							>
								<CircleAlert class="size-4 shrink-0" />
								<span>{loginError}</span>
							</div>
						{/if}
					</div>
				{/if}
			</div>
		</div>
	{:else}
		<!-- ── SIGNED IN VOLUNTEER DASHBOARD ─────────────────────────────────── -->

		<!-- TOP PROFILE HEADER CARD -->
		<div
			class="flex flex-col justify-between gap-6 rounded-3xl border border-border bg-card p-6 shadow-sm lg:flex-row lg:items-center"
		>
			<!-- Left: Avatar + Details -->
			<div class="flex items-start gap-4">
				<div
					class="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-primary text-xl font-black text-primary-foreground shadow-md"
				>
					{currentVolunteer.avatar}
				</div>
				<div class="space-y-1">
					<div class="flex flex-wrap items-center gap-2">
						<h2 class="text-lg font-black text-foreground md:text-xl">{currentVolunteer.name}</h2>
						<span
							class="rounded-md border border-border bg-muted/60 px-2 py-0.5 text-2xs font-bold text-muted-foreground"
						>
							ID: {currentVolunteer.id}
						</span>
						<span
							class="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-2xs font-bold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
						>
							<CircleCheck class="size-3" /> ยืนยันตัวตนแล้ว
						</span>
						<span
							class="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-2xs font-bold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
						>
							{currentVolunteer.statusText}
						</span>
					</div>

					<p class="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
						<span class="flex items-center gap-1">
							<MapPin class="size-3.5 text-primary" /> สังกัด: {currentVolunteer.shelterName}
						</span>
						<span>📞 {currentVolunteer.phone}</span>
					</p>

					<div class="pt-1">
						<span
							class="inline-flex items-center gap-1 rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-0.5 text-2xs font-bold text-sky-800 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-300"
						>
							{currentVolunteer.roleType}
						</span>
					</div>
				</div>
			</div>

			<!-- Right: Readiness Toggle + Actions -->
			<div class="flex flex-wrap items-center gap-3">
				<!-- Status Toggle -->
				<div class="flex rounded-xl border border-border bg-muted/30 p-1">
					<button
						type="button"
						onclick={() => setReadiness(true)}
						aria-pressed={isReady}
						class="flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-all {isReady
							? 'border border-emerald-300 bg-emerald-50 text-emerald-700 shadow-xs dark:bg-emerald-950/80 dark:text-emerald-200'
							: 'text-muted-foreground'}"
					>
						<span class="size-2 rounded-full bg-emerald-500"></span>
						<span>พร้อมปฏิบัติงาน</span>
					</button>
					<button
						type="button"
						onclick={() => setReadiness(false)}
						aria-pressed={!isReady}
						class="flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-all {!isReady
							? 'border border-border bg-card text-foreground shadow-xs'
							: 'text-muted-foreground'}"
					>
						<span class="size-2 rounded-full bg-muted-foreground"></span>
						<span>พักผ่อน/ไม่พร้อม</span>
					</button>
				</div>

				<button
					type="button"
					onclick={() => toast.info('ระบบแก้ไขโปรไฟล์จะเปิดให้บริการในอัปเดตถัดไป')}
					class="rounded-xl border border-border bg-card px-3.5 py-2 text-xs font-bold text-foreground shadow-xs transition-colors hover:bg-muted"
				>
					แก้ไขโปรไฟล์
				</button>

				<button
					type="button"
					onclick={handleLogout}
					title="สลับบัญชี / ออกจากระบบ"
					class="flex size-9 cursor-pointer items-center justify-center rounded-xl border border-border bg-card text-muted-foreground shadow-xs transition-colors hover:border-destructive hover:bg-destructive/10 hover:text-destructive"
				>
					<LogOut class="size-4" />
				</button>
			</div>
		</div>

		<!-- PRIMARY TABS -->
		<div class="flex border-b border-border">
			<div class="inline-flex rounded-t-2xl border-x border-t border-border/60 bg-muted/20 p-1">
				<button
					type="button"
					onclick={() => (dashboardTab = 'schedule')}
					class="flex cursor-pointer items-center gap-2 rounded-xl px-5 py-2.5 text-xs font-bold transition-all {dashboardTab ===
					'schedule'
						? 'bg-card text-foreground shadow-sm'
						: 'text-muted-foreground hover:text-foreground'}"
				>
					<ClipboardList class="size-4" />
					<span>ตารางของฉัน</span>
					<span
						class="rounded-full bg-primary/10 px-2 py-0.5 text-3xs font-black text-primary dark:bg-primary/30"
					>
						{currentVolunteer.scheduleCount}
					</span>
				</button>

				<button
					type="button"
					onclick={() => (dashboardTab = 'openings')}
					class="flex cursor-pointer items-center gap-2 rounded-xl px-5 py-2.5 text-xs font-bold transition-all {dashboardTab ===
					'openings'
						? 'bg-card text-foreground shadow-sm'
						: 'text-muted-foreground hover:text-foreground'}"
				>
					<Rocket class="size-4" />
					<span>ตลาดงานจิตอาสา (Openings)</span>
					<span
						class="rounded-full bg-amber-500/20 px-2 py-0.5 text-3xs font-black text-amber-800 dark:text-amber-300"
					>
						{currentVolunteer.openingsCount}
					</span>
				</button>
			</div>
		</div>

		{#if dashboardTab === 'schedule'}
			<!-- ── TAB 1: MY SCHEDULE ──────────────────────────────────────── -->
			<div class="grid grid-cols-1 gap-6 lg:grid-cols-3">
				<!-- Left 2 Cols: Shift Tasks List -->
				<div class="space-y-4 lg:col-span-2">
					<div class="flex items-center justify-between">
						<h3 class="text-sm font-bold text-foreground md:text-base">รายการภารกิจปฏิบัติการ</h3>
						<span class="text-2xs text-muted-foreground">แสดงเฉพาะงานทั้งหมดที่ลงทะเบียนแล้ว</span>
					</div>

					{#if currentVolunteer.shifts.length === 0}
						<div
							class="rounded-3xl border border-dashed border-border bg-card p-10 text-center text-muted-foreground"
						>
							<ClipboardList class="mx-auto mb-3 size-10 text-muted-foreground/60" />
							<p class="text-sm font-bold text-foreground">ยังไม่มีรายการภารกิจที่ลงทะเบียน</p>
							<p class="mt-1 text-xs">คุณสามารถเลือกดูงานที่เปิดรับได้ที่แท็บ "ตลาดงานจิตอาสา"</p>
							<button
								type="button"
								onclick={() => (dashboardTab = 'openings')}
								class="mt-4 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-white shadow-sm hover:opacity-95"
							>
								ดูตลาดงานจิตอาสา
							</button>
						</div>
					{:else}
						{#each currentVolunteer.shifts as shift (shift.id)}
							<div
								class="rounded-3xl border bg-card p-6 shadow-sm transition-all hover:shadow-md {shift.statusVariant ===
								'checked_in'
									? 'border-l-4 border-border border-l-emerald-500'
									: 'border-border'}"
							>
								<div class="flex flex-col justify-between gap-4 md:flex-row md:items-start">
									<div class="space-y-2">
										<div class="flex flex-wrap items-center gap-2">
											<span
												class="rounded-md bg-sky-50 px-2 py-0.5 text-2xs font-bold text-sky-700 dark:bg-sky-950/60 dark:text-sky-300"
											>
												{shift.shiftPeriod}
											</span>
											<span
												class="rounded-md px-2 py-0.5 text-2xs font-bold {shift.statusVariant ===
												'checked_in'
													? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
													: 'bg-muted text-muted-foreground'}"
											>
												{shift.statusBadge}
											</span>
										</div>

										<h4 class="text-base font-bold text-foreground">{shift.title}</h4>
										<p class="text-xs leading-relaxed text-muted-foreground">
											{shift.description}
										</p>

										<div
											class="flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-muted-foreground"
										>
											<span class="flex items-center gap-1 font-medium text-foreground">
												<MapPin class="size-3 text-primary" />
												{shift.location}
											</span>
											<span class="flex items-center gap-1">
												<Clock class="size-3" />
												{shift.dateText}
											</span>
										</div>

										<!-- Checkin info -->
										<div
											class="flex flex-wrap items-center gap-3 pt-1 text-2xs text-muted-foreground"
										>
											{#if shift.checkinTime}
												<span class="flex items-center gap-1 font-medium text-emerald-700">
													<Clock class="size-3" /> เช็คอิน: {shift.checkinTime}
												</span>
											{/if}
											{#if shift.checkoutTime}
												<span class="flex items-center gap-1 font-medium text-muted-foreground">
													<Clock class="size-3" /> เช็คเอาต์: {shift.checkoutTime}
												</span>
											{/if}
											{#if shift.checkinBy}
												<span class="font-medium text-muted-foreground">{shift.checkinBy}</span>
											{/if}
										</div>
									</div>

									<!-- Actions -->
									<div class="flex shrink-0 flex-col gap-2 sm:flex-row md:flex-col">
										{#if shift.dispatchStatus === 'dispatched' && shift.assignmentId}
											<!--
												The Dispatch Card (CR-092 FR-VOL-06). Answering needs the code a
												manager reads out as well as the number this session signed in
												with — the phone alone is guessable, and a declined shift cannot
												be un-declined from here.
											-->
											<div
												class="w-full space-y-2 rounded-xl border border-warning-border/50 bg-warning/5 p-3 md:w-64"
											>
												<p class="text-2xs leading-relaxed font-bold text-warning-foreground">
													ศูนย์เสนอมอบหมายภารกิจนี้ให้คุณ — กรอกรหัสที่เจ้าหน้าที่แจ้ง
												</p>
												<input
													type="text"
													bind:value={dispatchCodes[shift.assignmentId]}
													placeholder="เช่น 4K7-2M9"
													aria-label="รหัสยืนยันภารกิจ"
													autocomplete="off"
													maxlength={10}
													class="w-full rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground uppercase outline-hidden focus:border-primary focus:ring-1 focus:ring-primary"
												/>
												{#if dispatchErrors[shift.assignmentId]}
													<p class="text-2xs text-destructive" role="alert">
														{dispatchErrors[shift.assignmentId]}
													</p>
												{/if}
												<div class="flex gap-2">
													<button
														type="button"
														disabled={answering === shift.assignmentId}
														onclick={() => answerDispatch(shift, 'accepted')}
														class="flex flex-1 cursor-pointer items-center justify-center gap-1 rounded-lg bg-primary px-3 py-2 text-2xs font-bold text-primary-foreground shadow-sm hover:opacity-95 disabled:opacity-60"
													>
														<Check class="size-3.5" />
														ยอมรับภารกิจ
													</button>
													<button
														type="button"
														disabled={answering === shift.assignmentId}
														onclick={() => answerDispatch(shift, 'declined')}
														class="flex flex-1 cursor-pointer items-center justify-center gap-1 rounded-lg border border-border px-3 py-2 text-2xs font-bold text-muted-foreground transition-colors hover:border-destructive hover:text-destructive disabled:opacity-60"
													>
														<X class="size-3.5" />
														ปฏิเสธภารกิจ
													</button>
												</div>
											</div>
										{/if}
									</div>
								</div>
							</div>
						{/each}
					{/if}
				</div>

				<!-- Right 1 Col: Widgets -->
				<div class="space-y-6">
					<!-- WIDGET 1: กติกาการเข้ากะ -->
					<div class="rounded-3xl border border-border bg-card p-6 shadow-sm">
						<h4 class="flex items-center gap-2 text-sm font-bold text-foreground">
							<span>📢</span> กติกาการเข้ากะ
						</h4>
						<ul class="mt-3.5 space-y-2.5 text-xs leading-relaxed text-muted-foreground">
							<li class="flex items-start gap-2">
								<span class="text-primary">•</span>
								<span>กรุณารายงานตัว Check-in ทันทีเมื่อเดินทางมาถึงศูนย์พักพิง</span>
							</li>
							<li class="flex items-start gap-2">
								<span class="text-primary">•</span>
								<span
									>เมื่อปฏิบัติภารกิจเสร็จสิ้นตามกรอบเวลา ให้กดปุ่ม Check-out
									เพื่อสะสมเวลาปฏิบัติงานและคืนข้อมูลทรัพยากร</span
								>
							</li>
							<li class="flex items-start gap-2">
								<span class="text-primary">•</span>
								<span
									>หากเกิดเหตุฉุกเฉินหรือไม่สามารถเข้าปฏิบัติการได้ตามกำหนด
									ให้กดคำขอยกเลิกเพื่อให้ผู้จัดการศูนย์พิจารณา</span
								>
							</li>
							<li class="flex items-start gap-2">
								<span class="text-primary">•</span>
								<span>ไม่มีการแชร์ข้อมูลส่วนบุคคลของผู้ประสบภัยเพื่อความปลอดภัยของระบบ</span>
							</li>
						</ul>
					</div>

					<!-- WIDGET 2: บัตรอาสาสมัครอัจฉริยะ (QR Role Card) -->
					<div class="rounded-3xl border border-border bg-card p-6 shadow-sm">
						<div class="flex items-center justify-between">
							<h4 class="text-xs font-bold text-foreground">
								บัตรอาสาสมัครอัจฉริยะ (QR Role Card)
							</h4>
							<button
								type="button"
								onclick={() => (isPassModalOpen = true)}
								class="flex items-center gap-1 text-2xs font-bold text-primary hover:underline"
							>
								<Maximize2 class="size-3" /> ขยายบัตร
							</button>
						</div>
						<p class="mt-2 text-2xs text-muted-foreground">
							คุณสามารถรับสิทธิสวัสดิการ อาหารร้อน น้ำดื่ม และเวชภัณฑ์ที่เจ้าหน้าที่จัดเตรียมไว้
							โดยใช้บัตรนี้แสดงต่อเจ้าหน้าที่ ณ จุดแจกจ่าย
						</p>

						<!-- Mini QR Role Card -->
						<div
							class="mt-4 rounded-2xl border border-border bg-muted/20 p-4 text-center transition-all hover:bg-muted/30"
						>
							{#if qrDataUrl}
								<img
									src={qrDataUrl}
									alt="QR Code"
									class="mx-auto size-28 rounded-xl border border-border bg-white p-1.5 shadow-xs"
								/>
							{:else}
								<div
									class="mx-auto flex size-28 items-center justify-center rounded-xl bg-white text-muted-foreground"
								>
									<QrCode class="size-16" />
								</div>
							{/if}
							<h5 class="mt-2.5 text-xs font-black text-foreground">{currentVolunteer.name}</h5>
							<p class="text-2xs font-semibold text-muted-foreground">{currentVolunteer.token}</p>
							<div class="mt-2 flex justify-center gap-1">
								<span
									class="rounded bg-emerald-50 px-1.5 py-0.5 text-3xs font-bold text-emerald-700"
								>
									🟢 ยืนยันตัวตนแล้ว
								</span>
								<span
									class="rounded bg-emerald-50 px-1.5 py-0.5 text-3xs font-bold text-emerald-700"
								>
									🟢 ปฏิบัติหน้าที่อยู่
								</span>
							</div>
						</div>
					</div>
				</div>
			</div>
		{:else}
			<!-- ── TAB 2: JOB OPENINGS (ตลาดงานจิตอาสา) ─────────────────────── -->
			<div class="space-y-6">
				<!-- Search & Filter Bar -->
				<div class="flex flex-col gap-3 sm:flex-row sm:items-center">
					<div class="relative flex-1">
						<Search
							class="pointer-events-none absolute top-3 left-3.5 size-4 text-muted-foreground"
						/>
						<input
							type="text"
							bind:value={searchJobQuery}
							placeholder="ค้นหาภารกิจที่เหมาะสมกับทักษะ..."
							class="w-full rounded-xl border border-border bg-card py-2.5 pr-4 pl-10 text-xs font-medium text-foreground outline-hidden focus:border-primary focus:ring-1 focus:ring-primary md:text-sm"
						/>
					</div>

					<select
						bind:value={selectedShelterFilter}
						class="rounded-xl border border-border bg-card px-4 py-2.5 text-xs font-bold text-foreground outline-hidden focus:ring-1 focus:ring-primary sm:w-64"
					>
						<option value="all">ทุกศูนย์พักพิง</option>
						<option value="psu">มหาวิทยาลัยสงขลานครินทร์ (ศูนย์อพยพหลักระดับจังหวัด)</option>
						<option value="hatyai">ศูนย์พักพิง เทศบาลนครหาดใหญ่ (โรงเรียนเทศบาล 2)</option>
						<option value="klonghae">ศูนย์พักพิง เทศบาลเมืองคลองแห (โรงเรียนวัดคลองแห)</option>
					</select>
				</div>

				<!-- Job Cards 2-Column Grid -->
				<div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
					<!-- JOB CARD 1: EOC COORDINATOR (Controlled Skill) -->
					<div
						class="flex flex-col justify-between rounded-3xl border border-border bg-card p-6 shadow-sm"
					>
						<div class="space-y-3">
							<div class="flex flex-wrap items-center justify-between gap-2">
								<span class="text-2xs font-semibold text-muted-foreground">
									มหาวิทยาลัยสงขลานครินทร์ (ศูนย์...
								</span>
								<div class="flex items-center gap-1.5">
									<span
										class="rounded-md bg-emerald-50 px-2 py-0.5 text-3xs font-bold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
									>
										🟢 เปิดรับสมัคร
									</span>
									<span
										class="rounded-md bg-rose-50 px-2 py-0.5 text-3xs font-bold text-rose-700 dark:bg-rose-950/60 dark:text-rose-300"
									>
										ระดับหัวหน้า/ผู้คุมสายงาน
									</span>
								</div>
							</div>

							<h4 class="text-base font-bold text-foreground">
								ทีมอำนวยการและต้อนรับประสานงาน EOC ม.อ.
							</h4>
							<p class="text-xs leading-relaxed text-muted-foreground">
								ช่วยงานอำนวยการ ต้อนรับผู้ประสานงานจากศูนย์ EOC ม.อ.
								คัดกรองและประสานงานผู้ประสบภัยที่เดินทางมาถึง
							</p>

							<!-- Staff-Capable Notice Box -->
							<div
								class="rounded-2xl border border-sky-200/80 bg-sky-50/60 p-3.5 dark:border-sky-800 dark:bg-sky-950/40"
							>
								<div class="flex items-start gap-2">
									<Shield class="mt-0.5 size-4 shrink-0 text-sky-700 dark:text-sky-400" />
									<p class="text-2xs leading-relaxed text-sky-900 dark:text-sky-200">
										<strong>ภารกิจระดับเจ้าหน้าที่ (Staff-Capable) / ทักษะพิเศษ:</strong>
										จิตอาสาทั่วไปสามารถกด "ยื่นขอปฏิบัติงานนี้ (รอพิจารณา)" เพื่อให้เจ้าหน้าที่ตรวจสอบคุณสมบัติและตรวจบัตรประชาชนตัวจริงหน้างานได้
									</p>
								</div>
							</div>

							<div class="flex flex-wrap gap-1.5">
								<span
									class="rounded-md bg-muted px-2 py-0.5 text-3xs font-medium text-muted-foreground"
								>
									🏷️ สื่อสารและประสานงานทั่วไป
								</span>
								<span
									class="rounded-md bg-muted px-2 py-0.5 text-3xs font-medium text-muted-foreground"
								>
									🏷️ Communications
								</span>
							</div>
						</div>

						<!-- Shift Slot -->
						<div class="mt-5 rounded-2xl border border-border/80 bg-muted/10 p-4">
							<div class="flex items-center justify-between text-xs font-bold">
								<span class="flex items-center gap-1.5 text-foreground">
									📅 2026-06-13
									<span class="py-0.2 rounded bg-sky-100 px-1.5 text-3xs text-sky-800">กะเช้า</span>
								</span>
								<span class="text-2xs text-muted-foreground">🕒 08:00 - 12:00 น.</span>
							</div>

							<!-- 3-Color Quota Bar -->
							<div class="mt-2.5 space-y-1">
								<div class="flex h-2 w-full overflow-hidden rounded-full bg-muted">
									<div class="bg-emerald-500" style="width: 0%"></div>
									<div class="bg-amber-400" style="width: 0%"></div>
									<div class="bg-border" style="width: 100%"></div>
								</div>
								<div class="flex justify-between text-3xs text-muted-foreground">
									<span class="text-emerald-700">🟢 ตอบรับแล้ว: 0</span>
									<span class="text-amber-700">🟡 เสนอแล้ว: 0</span>
									<span>⚪ ยังขาดอีก: 39 <span class="text-2xs">(เป้า 18 คน)</span></span>
								</div>
							</div>

							<button
								type="button"
								onclick={() => handleRequestReview('ทีมอำนวยการและต้อนรับประสานงาน EOC ม.อ.')}
								class="mt-3.5 flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-border bg-card py-2.5 text-xs font-bold text-foreground shadow-xs transition-colors hover:bg-muted"
							>
								<span>📝 ยื่นขอปฏิบัติงานนี้ (รอพิจารณา)</span>
							</button>
						</div>
					</div>

					<!-- JOB CARD 2: HEAVY LIFTING SANDBAGS (Operational) -->
					<div
						class="flex flex-col justify-between rounded-3xl border border-border bg-card p-6 shadow-sm"
					>
						<div class="space-y-3">
							<div class="flex flex-wrap items-center justify-between gap-2">
								<span class="text-2xs font-semibold text-muted-foreground">
									ศูนย์พักพิง เทศบาลนครหาดใหญ่ (...
								</span>
								<div class="flex items-center gap-1.5">
									<span
										class="rounded-md bg-emerald-50 px-2 py-0.5 text-3xs font-bold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
									>
										🟢 เปิดรับสมัคร
									</span>
									<span
										class="rounded-md bg-emerald-50 px-2 py-0.5 text-3xs font-bold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
									>
										ระดับปฏิบัติการ (Operational)
									</span>
								</div>
							</div>

							<h4 class="text-base font-bold text-foreground">
								ทีมพลบริการช่วยยกของ ย้ายกระสอบทรายติดตั้งริมหาด
							</h4>
							<p class="text-xs leading-relaxed text-muted-foreground">
								ต้องการทีมพลบริการช่วยขนย้ายกระสอบทรายลงเครื่องริมหาดเร่งด่วนเพื่อป้องกันน้ำท่วมเข้าพื้นที่ศูนย์
							</p>

							<div class="flex flex-wrap gap-1.5">
								<span
									class="rounded-md bg-muted px-2 py-0.5 text-3xs font-medium text-muted-foreground"
								>
									🏷️ งานกำลังกาย / แบกหาม
								</span>
							</div>
						</div>

						<!-- Shift Slot -->
						<div class="mt-5 rounded-2xl border border-border/80 bg-muted/10 p-4">
							<div class="flex items-center justify-between text-xs font-bold">
								<span class="flex items-center gap-1.5 text-foreground">
									📅 2026-06-13
									<span class="py-0.2 rounded bg-sky-100 px-1.5 text-3xs text-sky-800">กะเช้า</span>
								</span>
								<span class="text-2xs text-muted-foreground">🕒 08:00 - 12:00 น.</span>
							</div>

							<!-- 3-Color Quota Bar -->
							<div class="mt-2.5 space-y-1">
								<div class="flex h-2 w-full overflow-hidden rounded-full bg-muted">
									<div class="bg-emerald-500" style="width: 0%"></div>
									<div class="bg-amber-400" style="width: 0%"></div>
									<div class="bg-border" style="width: 100%"></div>
								</div>
								<div class="flex justify-between text-3xs text-muted-foreground">
									<span class="text-emerald-700">🟢 ตอบรับแล้ว: 0</span>
									<span class="text-amber-700">🟡 เสนอแล้ว: 0</span>
									<span>⚪ ยังขาดอีก: 15 <span class="text-2xs">(เป้า 15 คน)</span></span>
								</div>
							</div>

							<button
								type="button"
								onclick={() => handleBookJob('ทีมพลบริการช่วยยกของ ย้ายกระสอบทรายติดตั้งริมหาด')}
								class="mt-3.5 flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-primary py-2.5 text-xs font-bold text-primary-foreground shadow-md transition-all hover:opacity-95"
							>
								<Rocket class="size-3.5" />
								<span>จองภารกิจนี้</span>
							</button>
						</div>
					</div>

					<!-- JOB CARD 3: KITCHEN (Registered Already) -->
					<div
						class="flex flex-col justify-between rounded-3xl border border-border bg-card p-6 shadow-sm"
					>
						<div class="space-y-3">
							<div class="flex flex-wrap items-center justify-between gap-2">
								<span class="text-2xs font-semibold text-muted-foreground">
									ศูนย์พักพิง เทศบาลเมืองคลองแห (...
								</span>
								<div class="flex items-center gap-1.5">
									<span
										class="rounded-md bg-emerald-50 px-2 py-0.5 text-3xs font-bold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
									>
										🟢 เปิดรับสมัคร
									</span>
									<span
										class="rounded-md bg-emerald-50 px-2 py-0.5 text-3xs font-bold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
									>
										ระดับปฏิบัติการ (Operational)
									</span>
								</div>
							</div>

							<h4 class="text-base font-bold text-foreground">
								ทีมจัดเตรียมและปรุงอาหารร้อน ครัวกลางหาดทอง
							</h4>
							<p class="text-xs leading-relaxed text-muted-foreground">
								ช่วยหั่นผัก เตรียมวัตถุดิบ
								บรรจุอาหารกล่องแจกจ่ายให้แก่ผู้ประสบภัยในพื้นที่ศูนย์พักพิงคลองแห
							</p>

							<div class="flex flex-wrap gap-1.5">
								<span
									class="rounded-md bg-muted px-2 py-0.5 text-3xs font-medium text-muted-foreground"
								>
									🏷️ ประกอบอาหาร / ครัวกลาง
								</span>
							</div>
						</div>

						<!-- Shift Slot -->
						<div class="mt-5 rounded-2xl border border-border/80 bg-muted/10 p-4">
							<div class="flex items-center justify-between text-xs font-bold">
								<span class="flex items-center gap-1.5 text-foreground">
									📅 2026-06-12
									<span class="py-0.2 rounded bg-sky-100 px-1.5 text-3xs text-sky-800">กะบ่าย</span>
								</span>
								<span class="text-2xs text-muted-foreground">🕒 12:00 - 18:00 น.</span>
							</div>

							<!-- 3-Color Quota Bar -->
							<div class="mt-2.5 space-y-1">
								<div class="flex h-2 w-full overflow-hidden rounded-full bg-muted">
									<div class="bg-emerald-500" style="width: 37.5%"></div>
									<div class="bg-amber-400" style="width: 0%"></div>
									<div class="bg-border" style="width: 62.5%"></div>
								</div>
								<div class="flex justify-between text-3xs text-muted-foreground">
									<span class="text-emerald-700">🟢 ตอบรับแล้ว: 3</span>
									<span class="text-amber-700">🟡 เสนอแล้ว: 0</span>
									<span>⚪ ยังขาดอีก: 7 <span class="text-2xs">(เป้า 8 คน)</span></span>
								</div>
							</div>

							<button
								type="button"
								disabled
								class="mt-3.5 flex w-full cursor-not-allowed items-center justify-center gap-1.5 rounded-xl bg-emerald-100 py-2.5 text-xs font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
							>
								<Check class="size-3.5" />
								<span>ลงทะเบียนแล้ว</span>
							</button>
						</div>
					</div>

					<!-- JOB CARD 4: REGISTRATION & SCREENING (Time Collision Demo) -->
					<div
						class="flex flex-col justify-between rounded-3xl border border-border bg-card p-6 shadow-sm"
					>
						<div class="space-y-3">
							<div class="flex flex-wrap items-center justify-between gap-2">
								<span class="text-2xs font-semibold text-muted-foreground">
									มหาวิทยาลัยสงขลานครินทร์ (ศูนย์...
								</span>
								<div class="flex items-center gap-1.5">
									<span
										class="rounded-md bg-emerald-50 px-2 py-0.5 text-3xs font-bold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
									>
										🟢 เปิดรับสมัคร
									</span>
									<span
										class="rounded-md bg-rose-50 px-2 py-0.5 text-3xs font-bold text-rose-700 dark:bg-rose-950/60 dark:text-rose-300"
									>
										ระดับหัวหน้า/ผู้คุมสายงาน
									</span>
								</div>
							</div>

							<h4 class="text-base font-bold text-foreground">
								เจ้าหน้าที่คัดกรองผู้ประสบภัย (Registration & Screening)
							</h4>
							<p class="text-xs leading-relaxed text-muted-foreground">
								ต้อนรับผู้ประสบภัย สอบถามข้อมูลเบื้องต้นและลงทะเบียนเข้าระบบของศูนย์พักพิง
								พร้อมคัดกรองเบื้องต้น
							</p>

							<!-- Staff-Capable Notice Box -->
							<div
								class="rounded-2xl border border-sky-200/80 bg-sky-50/60 p-3.5 dark:border-sky-800 dark:bg-sky-950/40"
							>
								<div class="flex items-start gap-2">
									<Shield class="mt-0.5 size-4 shrink-0 text-sky-700 dark:text-sky-400" />
									<p class="text-2xs leading-relaxed text-sky-900 dark:text-sky-200">
										<strong>ภารกิจระดับเจ้าหน้าที่ (Staff-Capable) / ทักษะพิเศษ:</strong>
										จิตอาสาทั่วไปสามารถกด "ยื่นขอปฏิบัติงานนี้ (รอพิจารณา)" เพื่อให้เจ้าหน้าที่ตรวจสอบคุณสมบัติและตรวจบัตรประชาชนตัวจริงหน้างานได้
									</p>
								</div>
							</div>

							<div class="flex flex-wrap gap-1.5">
								<span
									class="rounded-md bg-muted px-2 py-0.5 text-3xs font-medium text-muted-foreground"
								>
									🏷️ สื่อสารและประสานงานทั่วไป
								</span>
								<span
									class="rounded-md bg-muted px-2 py-0.5 text-3xs font-medium text-muted-foreground"
								>
									🏷️ Communication
								</span>
							</div>
						</div>

						<!-- Two Shift Slots with Collision Warning -->
						<div class="mt-5 space-y-3">
							<!-- Slot 1 -->
							<div
								class="rounded-2xl border border-amber-300/80 bg-amber-50/30 p-4 dark:border-amber-700 dark:bg-amber-950/20"
							>
								<div class="flex items-center justify-between text-xs font-bold">
									<span class="flex items-center gap-1.5 text-foreground">
										📅 2026-07-17
										<span class="py-0.2 rounded bg-sky-100 px-1.5 text-3xs text-sky-800"
											>กะเช้า</span
										>
									</span>
									<span class="text-2xs text-muted-foreground">🕒 08:00 - 12:00 น.</span>
								</div>

								<div class="mt-2.5 space-y-1">
									<div class="flex h-2 w-full overflow-hidden rounded-full bg-muted">
										<div class="bg-emerald-500" style="width: 25%"></div>
										<div class="bg-amber-400" style="width: 0%"></div>
										<div class="bg-border" style="width: 75%"></div>
									</div>
									<div class="flex justify-between text-3xs text-muted-foreground">
										<span class="text-emerald-700">🟢 ตอบรับแล้ว: 1</span>
										<span class="text-amber-700">🟡 เสนอแล้ว: 0</span>
										<span>⚪ ยังขาดอีก: 3 <span class="text-2xs">(เป้า 4 คน)</span></span>
									</div>
								</div>

								<button
									type="button"
									disabled
									class="mt-3 flex w-full cursor-not-allowed items-center justify-center gap-1.5 rounded-xl border border-amber-300 bg-amber-100/70 py-2.5 text-xs font-bold text-amber-800 dark:border-amber-800 dark:bg-amber-950/80 dark:text-amber-300"
								>
									<AlertTriangle class="size-3.5" />
									<span>เวลาชนกับกะที่จองไว้</span>
								</button>
								<p class="mt-1.5 text-center text-3xs text-amber-800 dark:text-amber-300">
									⚠️ ชนกับภารกิจ "ทีมพลบริการช่วยยกของ (Heavy Lifting)" ในช่วงเวลา 09:00 - 15:00 น.
									แล้ว
								</p>
							</div>

							<!-- Slot 2 -->
							<div
								class="rounded-2xl border border-amber-300/80 bg-amber-50/30 p-4 dark:border-amber-700 dark:bg-amber-950/20"
							>
								<div class="flex items-center justify-between text-xs font-bold">
									<span class="flex items-center gap-1.5 text-foreground">
										📅 2026-07-17
										<span class="py-0.2 rounded bg-sky-100 px-1.5 text-3xs text-sky-800"
											>กะบ่าย</span
										>
									</span>
									<span class="text-2xs text-muted-foreground">🕒 12:00 - 18:00 น.</span>
								</div>

								<div class="mt-2.5 space-y-1">
									<div class="flex h-2 w-full overflow-hidden rounded-full bg-muted">
										<div class="bg-emerald-500" style="width: 0%"></div>
										<div class="bg-amber-400" style="width: 0%"></div>
										<div class="bg-border" style="width: 100%"></div>
									</div>
									<div class="flex justify-between text-3xs text-muted-foreground">
										<span class="text-emerald-700">🟢 ตอบรับแล้ว: 0</span>
										<span class="text-amber-700">🟡 เสนอแล้ว: 0</span>
										<span>⚪ ยังขาดอีก: 4 <span class="text-2xs">(เป้า 4 คน)</span></span>
									</div>
								</div>

								<button
									type="button"
									disabled
									class="mt-3 flex w-full cursor-not-allowed items-center justify-center gap-1.5 rounded-xl border border-amber-300 bg-amber-100/70 py-2.5 text-xs font-bold text-amber-800 dark:border-amber-800 dark:bg-amber-950/80 dark:text-amber-300"
								>
									<AlertTriangle class="size-3.5" />
									<span>เวลาชนกับกะที่จองไว้</span>
								</button>
								<p class="mt-1.5 text-center text-3xs text-amber-800 dark:text-amber-300">
									⚠️ ชนกับภารกิจ "ทีมพลบริการช่วยยกของ (Heavy Lifting)" ในช่วงเวลา 09:00 - 15:00 น.
									แล้ว
								</p>
							</div>
						</div>
					</div>
				</div>
			</div>
		{/if}
	{/if}
</div>

<!-- Esc and the browser's own control leave fullscreen without touching our flag. -->
<svelte:document
	onfullscreenchange={() => (isPassFullscreen = Boolean(document.fullscreenElement))}
/>

<!-- ── MODAL: CAMERA QR SCANNER ────────────────────────────────────────────── -->
{#if isCameraModalOpen}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
		<div class="w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-2xl">
			<div class="flex items-center justify-between">
				<h3 class="text-sm font-bold text-foreground">สแกน QR Code ตั๋วจิตอาสา</h3>
				<button
					type="button"
					onclick={closeCamera}
					class="flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground hover:text-foreground"
				>
					<X class="size-4" />
				</button>
			</div>

			<!--
				`{@attach}` rather than an $effect: the camera has to start when this node
				enters the DOM and stop when it leaves, and the attachment's teardown is
				what guarantees the stream is released if the modal is closed mid-scan.
			-->
			<div class="my-5 overflow-hidden rounded-2xl border-2 border-dashed border-primary/50">
				<div id="volunteer-qr-reader" {@attach cameraAttachment}></div>
			</div>

			{#if cameraError}
				<p class="mb-3 text-xs text-destructive" role="alert">{cameraError}</p>
			{:else}
				<p class="mb-3 text-center text-2xs text-muted-foreground">
					หันกล้องไปยัง QR Code บนตั๋วดิจิทัลหรือบัตรงาน
				</p>
			{/if}

			<button
				type="button"
				onclick={closeCamera}
				class="w-full rounded-xl border border-border py-2.5 text-xs font-bold text-muted-foreground hover:bg-muted"
			>
				ปิดหน้าต่าง
			</button>
		</div>
	</div>
{/if}

<!-- ── MODAL: DIGITAL PASS VIEW ───────────────────────────────────────────── -->
{#if isPassModalOpen && currentVolunteer}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
		<div
			bind:this={passModalEl}
			class="w-full max-w-sm rounded-3xl border border-border bg-card p-6 text-center shadow-2xl {isPassFullscreen
				? 'flex max-w-none flex-col justify-center'
				: ''}"
		>
			<div class="flex justify-between">
				<button
					type="button"
					onclick={togglePassFullscreen}
					title={isPassFullscreen ? 'ย่อจากเต็มจอ' : 'ขยายเต็มจอ'}
					class="flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground hover:text-foreground"
				>
					<Maximize2 class="size-4" />
				</button>
				<button
					type="button"
					onclick={closePassModal}
					class="flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground hover:text-foreground"
				>
					<X class="size-4" />
				</button>
			</div>

			<div class="space-y-3">
				<div
					class="mx-auto flex size-12 items-center justify-center rounded-2xl bg-primary text-lg font-black text-white"
				>
					{currentVolunteer.avatar}
				</div>
				<h3 class="text-base font-black text-foreground">{currentVolunteer.name}</h3>
				<p class="font-mono text-xs text-muted-foreground">{currentVolunteer.token}</p>

				{#if qrDataUrl}
					<img
						src={qrDataUrl}
						alt="QR Code Pass"
						class="mx-auto size-48 rounded-2xl border-2 border-primary/20 bg-white p-2 shadow-md"
					/>
				{/if}

				<div class="flex justify-center gap-1.5 pt-1">
					<span class="rounded-md bg-emerald-50 px-2 py-0.5 text-2xs font-bold text-emerald-700">
						🟢 ยืนยันตัวตนแล้ว
					</span>
					<span class="rounded-md bg-emerald-50 px-2 py-0.5 text-2xs font-bold text-emerald-700">
						🟢 ปฏิบัติหน้าที่อยู่
					</span>
				</div>

				<p class="text-2xs text-muted-foreground">
					ยื่นแสดง QR Code นี้ต่อเจ้าหน้าที่ ณ จุดสแกนเช็คอินศูนย์พักพิง
				</p>

				<button
					type="button"
					onclick={closePassModal}
					class="mt-2 w-full rounded-xl bg-primary py-3 text-xs font-bold text-white shadow hover:opacity-95"
				>
					ปิดหน้าต่าง
				</button>
			</div>
		</div>
	</div>
{/if}
