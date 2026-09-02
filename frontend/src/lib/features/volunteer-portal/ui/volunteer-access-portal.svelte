<script lang="ts">
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
	import X from '@lucide/svelte/icons/x';
	import QRCode from 'qrcode';
	import { toast } from 'svelte-sonner';
	import VolunteerQrScannerModal from '$lib/features/volunteers/components/VolunteerQrScannerModal.svelte';
	import {
		useRespondToDispatchMutation,
		useVolunteerJobs,
		useVolunteerProfile,
		useVolunteerSchedule,
		useVolunteerTickets
	} from '../application/queries';
	import JobBoard from './job-board.svelte';
	import ProfileEditDialog from './profile-edit-dialog.svelte';
	import {
		isJobApplicable,
		normalizeTicketToken,
		PORTAL_TOKEN_HANDOFF_KEY,
		ticketStatusLabel,
		responseCodeSchema,
		ticketFindSchema,
		ticketTokenFromScan,
		type PortalCredential,
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

	/** One booking the volunteer holds — a `job_application`, not a rostered shift. */
	interface PortalBooking {
		id: string;
		title: string;
		location: string;
		dateText: string;
		statusLabel: string;
		confirmed: boolean;
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
		shifts: PortalShift[];
		bookings: PortalBooking[];
	}

	// ── STATE ──────────────────────────────────────────────────────────────────
	let loginTab = $state<'phone' | 'qr'>('phone');
	let inputPhone = $state('');
	let inputToken = $state('');
	let loginError = $state('');

	/**
	 * What this session signed in with — a phone number or a ticket token. `null` =
	 * signed out. Both doors resolve to the same volunteer server-side, so everything
	 * below is written against the credential, never against "the phone".
	 */
	let session = $state<PortalCredential | null>(null);

	/**
	 * Pick up the token a just-completed booking left behind, so the volunteer lands on
	 * their own ตารางทำงาน already signed in instead of being asked for the number they
	 * typed thirty seconds ago. Cleared immediately: a shared tablet must not sign the
	 * next person in as this one.
	 */
	$effect(() => {
		if (session) return;
		let handed: string | null = null;
		try {
			handed = sessionStorage.getItem(PORTAL_TOKEN_HANDOFF_KEY);
			if (handed) sessionStorage.removeItem(PORTAL_TOKEN_HANDOFF_KEY);
		} catch {
			// Storage unavailable (private mode). The login form is still there.
		}
		const token = handed ? normalizeTicketToken(handed) : null;
		if (token) session = { token };
	});

	const scheduleQuery = useVolunteerSchedule(() => session);
	const ticketsQuery = useVolunteerTickets(() => session);
	/**
	 * Only for the count on the "ภารกิจที่เปิดรับ" tab button. The board itself fetches
	 * with the same key, so this costs no extra request — and the badge counts jobs that
	 * can actually be applied to, not, as it once did, the volunteer's own tickets.
	 */
	const openingsQuery = useVolunteerJobs(
		() => ({}),
		() => session !== null
	);
	const openingsCount = $derived((openingsQuery.data ?? []).filter(isJobApplicable).length);
	const profileQuery = useVolunteerProfile(() => session);
	let profileDialogOpen = $state(false);
	const respond = useRespondToDispatchMutation(() => session);

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
		credential: PortalCredential,
		phoneMasked: string,
		shifts: ScheduleShift[],
		tickets: TicketSummary[]
	): PortalVolunteer {
		const named = tickets.find((t) => t.applicant_name)?.applicant_name ?? '';
		const first = shifts[0];
		// A token session never holds the raw number — the API returns it masked, which
		// is also what may be shown on a screen held up at a gate (AC-VOL-03).
		const shownPhone = phoneMasked || credential.phone || '';
		return {
			id: credential.token ?? credential.phone ?? '',
			// A real ticket token is what the check-in station can actually resolve; a
			// phone session has none, so it falls back to the number it signed in with.
			token: credential.token ?? `VOL-${credential.phone}`,
			name: named || 'จิตอาสา',
			avatar: (named || 'อา').slice(0, 2),
			phone: shownPhone,
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
			shifts: shifts.map(toPortalShift),
			bookings: tickets.map((ticket) => ({
				id: ticket.view_token,
				title: ticket.job_title || 'ภารกิจอาสาสมัคร',
				location: ticket.shelter_code,
				dateText: ticket.shift_date || 'ยังไม่ระบุวัน',
				statusLabel: ticketStatusLabel(ticket.status),
				confirmed: ticket.status === 'confirmed'
			}))
		};
	}

	const liveVolunteer = $derived.by(() => {
		const credential = session;
		if (!credential) return null;
		// Held back until the schedule has answered, so the dashboard does not flash an
		// empty roster at someone who does have shifts.
		if (scheduleQuery.isPending) return null;
		return toPortalVolunteer(
			credential,
			ticketsQuery.data?.phoneMasked ?? '',
			scheduleQuery.data ?? [],
			ticketsQuery.data?.tickets ?? []
		);
	});

	/** The open session, or null when signed out. The markup below reads only this. */
	const currentVolunteer = $derived(liveVolunteer);

	let dashboardTab = $state<'schedule' | 'openings'>('schedule');
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

	/**
	 * Read a volunteer QR and sign in with what it contains.
	 *
	 * The scanning itself lives in `VolunteerQrScannerModal`, which the ticket screens
	 * share; this only decides what a decoded payload means. The pass encodes its own
	 * URL, so what comes back is either a bare token or a link ending in one — both
	 * reduce to the same token, and anything else is left for `submitToken` to reject
	 * rather than guessed at here.
	 *
	 * Normalised through `ticketTokenFromScan`, never `toUpperCase()`: a `VIEW-`
	 * reference is base64url and upper-casing it destroys the signature.
	 */
	function handleScanToken(scanned: string) {
		const token = ticketTokenFromScan(scanned);
		if (!token) {
			loginError = 'ไม่พบรหัสตั๋วใน QR Code นี้ กรุณาลองใหม่อีกครั้ง';
			return;
		}
		if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(100);
		inputToken = token;
		submitToken(token);
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
		session = { phone: parsed.data.phone };
	}

	/**
	 * Sign in with a ticket code, from the form or from a QR scan.
	 *
	 * This is a sign-in, not a shortcut to the pass: the token opens the same ตารางทำงาน
	 * the phone would, because the API resolves both to one volunteer. It used to
	 * navigate away to the ticket page, which left the QR on someone's pass unable to do
	 * the one thing the login screen offers it for.
	 *
	 * Whether the token is real is the server's answer, not ours — a wrong one opens an
	 * empty dashboard, the same as an unknown phone number, so this screen cannot be
	 * used to probe which tokens exist.
	 */
	function submitToken(value: string) {
		loginError = '';
		if (!value.trim()) {
			loginError = 'กรุณากรอกรหัส Token หรือรหัสตั๋วจิตอาสา';
			return;
		}
		const token = normalizeTicketToken(value);
		if (!token) {
			loginError = 'รูปแบบรหัสไม่ถูกต้อง — ต้องขึ้นต้นด้วย TKT-VOL- หรือ VIEW-';
			return;
		}
		session = { token };
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
		session = null;
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
					onclick={() => (profileDialogOpen = true)}
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
						{openingsCount}
					</span>
				</button>
			</div>
		</div>

		{#if dashboardTab === 'schedule'}
			<!-- ── TAB 1: MY SCHEDULE ──────────────────────────────────────── -->
			<div class="grid grid-cols-1 gap-6 lg:grid-cols-3">
				<!-- Left 2 Cols: Shift Tasks List -->
				<div class="space-y-4 lg:col-span-2">
					<!--
						Two lists, because they are two different things and conflating them is how
						a volunteer concludes their booking vanished: a BOOKING is the
						`job_application` they just made, a SHIFT is the `shift_assignment` a
						manager rosters them onto afterwards. Nothing turns the first into the
						second automatically.
					-->
					{#if currentVolunteer.bookings.length > 0}
						<div class="flex items-center justify-between">
							<h3 class="text-sm font-bold text-foreground md:text-base">ภารกิจที่คุณจองไว้</h3>
							<span class="text-2xs text-muted-foreground">รอเจ้าหน้าที่จัดกะให้</span>
						</div>

						<div class="space-y-3">
							{#each currentVolunteer.bookings as booking (booking.id)}
								<div class="rounded-2xl border border-border bg-card p-4 shadow-sm">
									<div class="flex flex-wrap items-start justify-between gap-3">
										<div class="min-w-0 space-y-1">
											<p class="text-sm font-bold text-foreground">{booking.title}</p>
											<p class="flex items-center gap-1.5 text-2xs text-muted-foreground">
												<MapPin class="size-3.5 shrink-0" />
												{booking.location}
												<span class="text-muted-foreground/60">·</span>
												{booking.dateText}
											</p>
										</div>
										<div class="flex shrink-0 items-center gap-2">
											<span
												class="rounded-lg px-2.5 py-1 text-3xs font-bold {booking.confirmed
													? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
													: 'bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'}"
											>
												{booking.statusLabel}
											</span>
											<a
												href="/volunteer/ticket/{booking.id}"
												class="rounded-lg border border-border px-2.5 py-1 text-3xs font-bold text-foreground hover:bg-muted"
											>
												เปิดตั๋ว
											</a>
										</div>
									</div>
								</div>
							{/each}
						</div>
					{/if}

					<div class="flex items-center justify-between pt-2">
						<h3 class="text-sm font-bold text-foreground md:text-base">ตารางกะที่ได้รับมอบหมาย</h3>
						<span class="text-2xs text-muted-foreground">กะที่เจ้าหน้าที่จัดให้แล้ว</span>
					</div>

					{#if currentVolunteer.shifts.length === 0}
						<div
							class="rounded-3xl border border-dashed border-border bg-card p-10 text-center text-muted-foreground"
						>
							<ClipboardList class="mx-auto mb-3 size-10 text-muted-foreground/60" />
							{#if currentVolunteer.bookings.length > 0}
								<p class="text-sm font-bold text-foreground">ยังไม่มีกะที่ได้รับมอบหมาย</p>
								<p class="mt-1 text-xs">
									การจองของคุณเข้าระบบแล้ว — เจ้าหน้าที่ศูนย์จะจัดกะและแจ้งให้ทราบ
									กะที่จัดแล้วจะขึ้นที่นี่
								</p>
							{:else}
								<p class="text-sm font-bold text-foreground">ยังไม่มีรายการภารกิจที่ลงทะเบียน</p>
								<p class="mt-1 text-xs">คุณสามารถเลือกดูงานที่เปิดรับได้ที่แท็บ "ตลาดงานจิตอาสา"</p>
								<button
									type="button"
									onclick={() => (dashboardTab = 'openings')}
									class="mt-4 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-white shadow-sm hover:opacity-95"
								>
									ดูตลาดงานจิตอาสา
								</button>
							{/if}
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
			<!--
				The same public board `/volunteers/jobs` renders, mounted here so a signed-in
				volunteer can pick up another shift without leaving the portal. It carries its
				own search, filters and no-auth application form, and TanStack dedupes the
				fetch with the `openingsQuery` above rather than asking twice.
			-->
			<JobBoard />
		{/if}
	{/if}
</div>

<!-- Esc and the browser's own control leave fullscreen without touching our flag. -->
<svelte:document
	onfullscreenchange={() => (isPassFullscreen = Boolean(document.fullscreenElement))}
/>

<!-- ── MODAL: CAMERA QR SCANNER ────────────────────────────────────────────── -->
<VolunteerQrScannerModal
	bind:isOpen={isCameraModalOpen}
	onScan={handleScanToken}
	title="สแกน QR Code ตั๋วจิตอาสา"
/>

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

<ProfileEditDialog
	bind:open={profileDialogOpen}
	profile={profileQuery.data ?? null}
	credential={session}
/>
