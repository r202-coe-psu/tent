<script lang="ts">
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import Camera from '@lucide/svelte/icons/camera';
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
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import UserCheck from '@lucide/svelte/icons/user-check';
	import X from '@lucide/svelte/icons/x';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Pagination from '$lib/components/ui/pagination/index.js';
	import { generateQrDataUrl } from '$lib/utils/qrcode';
	import { toast } from 'svelte-sonner';
	import {
		useVolunteerJobs,
		useVolunteerProfile,
		useVolunteerSchedule,
		useVolunteerTickets
	} from '../application/queries';
	import JobBoard from './job-board.svelte';
	import QrScannerModal from './qr-scanner-modal.svelte';
	import ProfileEditDialog from './profile-edit-dialog.svelte';
	import {
		isJobApplicable,
		normalizeTicketToken,
		personnelTypeLabel,
		PORTAL_TOKEN_HANDOFF_KEY,
		ticketStatusLabel,
		ticketFindSchema,
		ticketTokenFromScan,
		type PortalCredential,
		type ScheduleShift,
		type TicketSummary,
		type VolunteerProfile
	} from '../domain/volunteer';

	// ── VIEW MODEL ─────────────────────────────────────────────────────────────
	// One shape for both sources. The demo fixtures below and the live API are mapped
	// into it, so the markup underneath never has to know which one it is rendering.
	interface PortalShift {
		id: string;
		shiftPeriod: string;
		statusBadge: string;
		statusVariant: 'checked_in' | 'completed' | 'pending' | 'cancelled';
		title: string;
		description: string;
		location: string;
		dateText: string;
		checkinTime?: string;
		checkoutTime?: string;
		checkinBy?: string;
		/** `shift_assignment:{ulid}` — present only on live shifts. */
		assignmentId?: string;
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

	const ticketsQuery = useVolunteerTickets(() => session);
	const scheduleQuery = useVolunteerSchedule(() => session);
	const openingsQuery = useVolunteerJobs(
		() => ({}),
		() => session !== null
	);
	const openingsCount = $derived((openingsQuery.data ?? []).filter(isJobApplicable).length);
	const profileQuery = useVolunteerProfile(() => session);
	let profileDialogOpen = $state(false);
	// ── LIVE SESSION → VIEW MODEL ──────────────────────────────────────────────
	interface ShiftOverride {
		status: 'assigned' | 'standby' | 'checked_in' | 'completed' | 'cancelled';
		check_in_at?: string | null;
		check_out_at?: string | null;
	}

	let shiftOverrides = $state<Record<string, ShiftOverride>>({});

	// Load overrides from sessionStorage when session changes
	$effect(() => {
		const key = session?.token
			? `volunteer_shift_overrides_${session.token}`
			: session?.phone
				? `volunteer_shift_overrides_${session.phone}`
				: null;
		if (!key) {
			shiftOverrides = {};
			return;
		}
		try {
			const saved = sessionStorage.getItem(key);
			if (saved) {
				shiftOverrides = JSON.parse(saved);
			} else {
				shiftOverrides = {};
			}
		} catch {
			shiftOverrides = {};
		}
	});

	function saveShiftOverrides(next: Record<string, ShiftOverride>) {
		shiftOverrides = next;
		const key = session?.token
			? `volunteer_shift_overrides_${session.token}`
			: session?.phone
				? `volunteer_shift_overrides_${session.phone}`
				: null;
		if (!key) return;
		try {
			sessionStorage.setItem(key, JSON.stringify(next));
		} catch {
			// ignore
		}
	}

	function formatShiftLabel(shiftVal?: string): string {
		if (!shiftVal) return 'กะเช้า';
		const s = shiftVal.toLowerCase();
		if (s.includes('เช้า') || s === 'morning') return 'กะเช้า';
		if (s.includes('บ่าย') || s === 'afternoon') return 'กะบ่าย';
		if (s.includes('ดึก') || s === 'night') return 'กะดึก';
		if (s === 'custom') return 'กะพิเศษ';
		return shiftVal;
	}

	const SHIFT_BADGE: Record<string, { label: string; variant: PortalShift['statusVariant'] }> = {
		assigned: { label: 'รอรายงานตัวเข้ากะ', variant: 'pending' },
		standby: { label: 'รอรายงานตัวเข้ากะ', variant: 'pending' },
		checked_in: { label: 'เช็คอินเข้าปฏิบัติงานอยู่', variant: 'checked_in' },
		completed: { label: 'เสร็จสิ้นภารกิจแล้ว (เช็คเอาท์แล้ว)', variant: 'completed' },
		done: { label: 'เสร็จสิ้นภารกิจแล้ว (เช็คเอาท์แล้ว)', variant: 'completed' },
		cancelled: { label: 'ยกเลิก/ถอนกะงานแล้ว', variant: 'cancelled' },
		no_show: { label: 'ไม่มาปฏิบัติงาน (No-show)', variant: 'completed' }
	};

	function clockText(iso: string | null | undefined): string | undefined {
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
		const override = shiftOverrides[shift.assignment_id];
		const effectiveStatus = override?.status ?? shift.status;
		const effectiveCheckIn =
			override?.check_in_at !== undefined ? override.check_in_at : shift.check_in_at;
		const effectiveCheckOut =
			override?.check_out_at !== undefined ? override.check_out_at : shift.check_out_at;

		const badge = SHIFT_BADGE[effectiveStatus] ?? {
			label: effectiveStatus,
			variant: 'pending' as const
		};
		return {
			id: shift.assignment_id,
			assignmentId: shift.assignment_id,
			shiftPeriod: formatShiftLabel(shift.shift),
			statusBadge: badge.label,
			statusVariant: badge.variant,
			title: shift.job_title || 'งานอาสาสมัคร',
			description: shift.station ? `จุดปฏิบัติงาน: ${shift.station}` : '',
			location: shift.shelter_name || shift.shelter_code,
			dateText: timeRange(shift),
			checkinTime: clockText(effectiveCheckIn),
			checkoutTime: clockText(effectiveCheckOut),
			checkinBy: effectiveCheckIn ? 'เช็คอินเอง' : undefined
		};
	}

	function toPortalVolunteer(
		credential: PortalCredential,
		profile: VolunteerProfile | null,
		phoneMasked: string,
		shifts: ScheduleShift[],
		tickets: TicketSummary[]
	): PortalVolunteer {
		/*
		 * The profile is the identity, the ticket is only a fallback.
		 *
		 * It used to be the other way round, which left everyone who never filed an
		 * application — a walk-in, or anyone a coordinator entered by hand — greeted as
		 * the literal word "จิตอาสา", because `ticket/find` answers an empty list for
		 * them. The order is reversed for the opposite case too: someone who applied
		 * seconds ago has a ticket while the inbound loop has yet to write their
		 * `volunteer` document, so neither source alone covers both.
		 */
		const profileName = profile ? `${profile.first_name} ${profile.last_name}`.trim() : '';
		const named = profileName || (tickets.find((t) => t.applicant_name)?.applicant_name ?? '');
		const first = shifts[0];
		// A token session never holds the raw number — the API returns it masked, which
		// is also what may be shown on a screen held up at a gate (AC-VOL-03).
		const shownPhone = profile?.phone_masked || phoneMasked || credential.phone || '';
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
			// Staff decide this, and only the profile carries it. Defaulting to `true`
			// told every unverified volunteer they were verified.
			verified: profile?.identity_verified ?? false,
			statusText: shifts.some((s) => s.status === 'checked_in')
				? 'ปฏิบัติหน้าที่อยู่'
				: shifts.length
					? 'พร้อมปฏิบัติงาน'
					: 'รอการมอบหมาย',
			statusType: shifts.some((s) => s.status === 'checked_in') ? 'active' : 'pending',
			roleType: personnelTypeLabel(profile?.personnel_type ?? 'volunteer'),
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
		// empty roster at someone who does have shifts — and until the profile has, so
		// it does not greet them by the placeholder name first and correct itself after.
		if (scheduleQuery.isPending || profileQuery.isPending) return null;
		return toPortalVolunteer(
			credential,
			profileQuery.data ?? null,
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
	 * The scanning itself lives in this slice's own `qr-scanner-modal.svelte`; this only
	 * decides what a decoded payload means. The pass encodes its own
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
			generateQrDataUrl(payload, {
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

	function handleLogout() {
		session = null;
		readinessOverride = null;
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

	// ── SHIFT ACTIONS & MODALS ────────────────────────────────────────────────
	let isCheckinModalOpen = $state(false);
	let isCheckoutModalOpen = $state(false);
	let isLeaveModalOpen = $state(false);
	let modalTargetShift = $state<PortalShift | null>(null);
	let leaveReason = $state('ติดภารกิจด่วน');
	let leaveReasonDetail = $state('');

	function openCheckinModal(shift: PortalShift) {
		modalTargetShift = shift;
		isCheckinModalOpen = true;
	}

	function openCheckoutModal(shift: PortalShift) {
		modalTargetShift = shift;
		isCheckoutModalOpen = true;
	}

	function openLeaveModal(shift: PortalShift) {
		modalTargetShift = shift;
		leaveReason = 'ติดภารกิจด่วน';
		leaveReasonDetail = '';
		isLeaveModalOpen = true;
	}

	function handleConfirmCheckin() {
		if (!modalTargetShift) return;
		const now = new Date().toISOString();
		const updated: Record<string, ShiftOverride> = {
			...shiftOverrides,
			[modalTargetShift.id]: {
				status: 'checked_in',
				check_in_at: now,
				check_out_at: shiftOverrides[modalTargetShift.id]?.check_out_at ?? null
			}
		};
		saveShiftOverrides(updated);
		isCheckinModalOpen = false;
		toast.success('รายงานตัวเข้างาน (Check-In) สำเร็จ');
	}

	function handleConfirmCheckout() {
		if (!modalTargetShift) return;
		const now = new Date().toISOString();
		const prev = shiftOverrides[modalTargetShift.id];
		const updated: Record<string, ShiftOverride> = {
			...shiftOverrides,
			[modalTargetShift.id]: {
				status: 'completed',
				check_in_at: prev?.check_in_at ?? now,
				check_out_at: now
			}
		};
		saveShiftOverrides(updated);
		isCheckoutModalOpen = false;
		toast.success('เช็คเอาท์ออกจากงาน (Check-Out) เรียบร้อยแล้ว');
	}

	function handleConfirmLeave() {
		if (!modalTargetShift) return;
		const updated: Record<string, ShiftOverride> = {
			...shiftOverrides,
			[modalTargetShift.id]: {
				status: 'cancelled',
				check_in_at: shiftOverrides[modalTargetShift.id]?.check_in_at ?? null,
				check_out_at: shiftOverrides[modalTargetShift.id]?.check_out_at ?? null
			}
		};
		saveShiftOverrides(updated);
		isLeaveModalOpen = false;
		toast.success('ส่งคำขอลา/ถอนกะงานเรียบร้อยแล้ว');
	}

	// ── PAGINATION ────────────────────────────────────────────────────────────
	let currentPage = $state(1);
	const PAGE_SIZE = 2;

	const activeShifts = $derived(
		currentVolunteer ? currentVolunteer.shifts.filter((s) => s.statusVariant !== 'cancelled') : []
	);

	const paginatedShifts = $derived(
		activeShifts.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
	);

	$effect(() => {
		if (activeShifts.length > 0 && (currentPage - 1) * PAGE_SIZE >= activeShifts.length) {
			currentPage = 1;
		}
	});
</script>

<div class="mx-auto w-full max-w-6xl space-y-8">
	{#if !currentVolunteer}
		<!-- TOP BRAND HEADER (Only shown on login screen) -->
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
		<!-- TOP PROFILE HEADER CARD -->
		<div
			class="flex flex-col justify-between gap-5 rounded-3xl border border-border/80 bg-card p-5 shadow-xs sm:p-6 lg:flex-row lg:items-center"
		>
			<!-- Left: Avatar + Details -->
			<div class="flex items-start gap-4">
				<div
					class="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-primary text-xl font-black text-primary-foreground shadow-sm"
				>
					{currentVolunteer.avatar}
				</div>
				<div class="min-w-0 space-y-1.5">
					<div class="flex flex-wrap items-center gap-2">
						<h2 class="text-lg font-black tracking-tight text-foreground md:text-xl">
							{currentVolunteer.name}
						</h2>
						<span
							class="inline-flex max-w-[200px] truncate rounded-md border border-border/80 bg-muted/60 px-2 py-0.5 font-mono text-3xs font-semibold text-muted-foreground"
							title={currentVolunteer.id}
						>
							ID: {currentVolunteer.id.length > 20
								? currentVolunteer.id.slice(0, 15) + '…'
								: currentVolunteer.id}
						</span>
						<span
							class="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-3xs font-bold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
						>
							<CircleCheck class="size-3" /> ยืนยันตัวตนแล้ว
						</span>
						{#if currentVolunteer.statusText}
							<span
								class="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-3xs font-bold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
							>
								{currentVolunteer.statusText}
							</span>
						{/if}
					</div>

					<div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
						{#if currentVolunteer.shelterName}
							<span class="flex items-center gap-1 font-medium text-foreground/80">
								<MapPin class="size-3.5 text-primary" /> สังกัด: {currentVolunteer.shelterName}
							</span>
							<span class="text-border">•</span>
						{/if}
						<span class="flex items-center gap-1">
							<Phone class="size-3" />
							{currentVolunteer.phone}
						</span>
						{#if currentVolunteer.roleType}
							<span class="text-border">•</span>
							<span
								class="inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-2 py-0.5 text-3xs font-bold text-amber-700 dark:text-amber-400"
							>
								⚡ {currentVolunteer.roleType}
							</span>
						{/if}
					</div>
				</div>
			</div>

			<!-- Right: Readiness Toggle + Actions -->
			<div class="flex shrink-0 flex-wrap items-center gap-2.5 sm:flex-nowrap">
				<!-- Status Toggle -->
				<div class="inline-flex rounded-xl border border-border/80 bg-muted/40 p-1">
					<button
						type="button"
						onclick={() => setReadiness(true)}
						aria-pressed={isReady}
						class="flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-all {isReady
							? 'border border-emerald-300/80 bg-emerald-50 text-emerald-700 shadow-xs dark:border-emerald-700/60 dark:bg-emerald-950/80 dark:text-emerald-200'
							: 'text-muted-foreground hover:text-foreground'}"
					>
						<span
							class="size-2 rounded-full {isReady
								? 'bg-emerald-500'
								: 'border border-muted-foreground/50 bg-transparent'}"
						></span>
						<span>พร้อมปฏิบัติงาน</span>
					</button>
					<button
						type="button"
						onclick={() => setReadiness(false)}
						aria-pressed={!isReady}
						class="flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-all {!isReady
							? 'border border-border bg-card text-foreground shadow-xs'
							: 'text-muted-foreground hover:text-foreground'}"
					>
						<span
							class="size-2 rounded-full {!isReady
								? 'bg-muted-foreground'
								: 'border border-muted-foreground/50 bg-transparent'}"
						></span>
						<span>พักผ่อน/ไม่พร้อม</span>
					</button>
				</div>

				<button
					type="button"
					onclick={() => (profileDialogOpen = true)}
					class="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3.5 py-2 text-xs font-bold text-foreground shadow-xs transition-colors hover:bg-muted"
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
					<span>ตารางกะของฉัน</span>
					<span
						class="rounded-full bg-primary/10 px-2 py-0.5 text-3xs font-black text-primary dark:bg-primary/30"
					>
						{activeShifts.length}
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
					<Sparkles class="size-4 text-warning" />
					<span>ตลาดงานจิตอาสา (Openings)</span>
					<span class="rounded-full bg-muted px-2 py-0.5 text-3xs font-bold text-muted-foreground">
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
						<h3 class="text-sm font-bold text-foreground md:text-base">รายการภารกิจปฏิบัติการ</h3>
						<span class="text-2xs text-muted-foreground">แสดงกะงานทั้งหมดที่ลงทะเบียนแล้ว</span>
					</div>

					{#if activeShifts.length === 0}
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
						{#each paginatedShifts as shift (shift.id)}
							<div
								class="rounded-3xl border bg-card p-5 shadow-xs transition-all hover:shadow-md sm:p-6 {shift.statusVariant ===
								'checked_in'
									? 'border-l-4 border-border/80 border-l-emerald-500'
									: 'border-border/80'}"
							>
								<div class="flex flex-col justify-between gap-5 md:flex-row md:items-center">
									<div class="space-y-2.5">
										<div class="flex flex-wrap items-center gap-2">
											<span
												class="rounded-md border border-sky-200/80 bg-sky-50/90 px-2.5 py-0.5 text-2xs font-bold text-sky-800 dark:border-sky-800/80 dark:bg-sky-950/60 dark:text-sky-300"
											>
												{shift.shiftPeriod}
											</span>
											<span
												class="rounded-md border px-2.5 py-0.5 text-2xs font-bold {shift.statusVariant ===
												'checked_in'
													? 'border-emerald-200/80 bg-emerald-50 text-emerald-800 dark:border-emerald-800/80 dark:bg-emerald-950/60 dark:text-emerald-300'
													: shift.statusVariant === 'pending'
														? 'border-sky-200/80 bg-sky-50 text-sky-700 dark:border-sky-800/80 dark:bg-sky-950/60 dark:text-sky-300'
														: 'border-border/80 bg-muted text-muted-foreground'}"
											>
												{shift.statusBadge}
											</span>
										</div>

										<h4 class="text-base leading-snug font-bold text-foreground md:text-lg">
											{shift.title}
										</h4>
										{#if shift.description}
											<p class="text-xs leading-relaxed text-muted-foreground">
												{shift.description}
											</p>
										{/if}

										<div
											class="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-2xs text-muted-foreground"
										>
											<span class="flex items-center gap-1 font-medium text-foreground/80">
												<MapPin class="size-3.5 text-primary" />
												{shift.location}
											</span>
											<span class="text-border">•</span>
											<span class="flex items-center gap-1">
												<Clock class="size-3.5" />
												{shift.dateText}
											</span>
										</div>

										<!-- Checkin info -->
										{#if shift.checkinTime || shift.checkoutTime}
											<div class="flex flex-wrap items-center gap-x-5 gap-y-2 pt-1 text-2xs">
												{#if shift.checkinTime}
													<span
														class="inline-flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-400"
													>
														<Clock class="size-3.5" />
														<span>เช็คอิน: {shift.checkinTime}</span>
														{#if shift.checkinBy}
															<span
																class="inline-flex items-center gap-1 rounded border border-sky-200/80 bg-sky-100/90 px-1.5 py-0.5 text-3xs font-semibold text-sky-800 dark:border-sky-800/80 dark:bg-sky-950/80 dark:text-sky-300"
															>
																<UserCheck class="size-2.5" />
																{shift.checkinBy}
															</span>
														{/if}
													</span>
												{/if}
												{#if shift.checkoutTime}
													<span
														class="inline-flex items-center gap-1.5 font-medium text-muted-foreground"
													>
														<Clock class="size-3.5" />
														<span>เช็คเอาต์: {shift.checkoutTime}</span>
													</span>
												{/if}
											</div>
										{/if}
									</div>

									<!-- Actions -->
									<div
										class="flex shrink-0 flex-col justify-center gap-2 sm:flex-row md:w-60 md:flex-col md:self-center"
									>
										{#if shift.statusVariant === 'pending'}
											<button
												type="button"
												onclick={() => openCheckinModal(shift)}
												class="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white shadow-xs transition hover:bg-emerald-700 active:scale-[0.98]"
											>
												<UserCheck class="size-4" />
												<span>รายงานตัวเข้างาน (Check-In)</span>
											</button>
											<button
												type="button"
												onclick={() => openLeaveModal(shift)}
												class="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-border/80 bg-card px-4 py-2 text-xs font-medium text-muted-foreground transition hover:border-foreground/30 hover:text-foreground active:scale-[0.98]"
											>
												<span>ขอลา/ถอนกะงาน</span>
											</button>
										{:else if shift.statusVariant === 'checked_in'}
											<button
												type="button"
												onclick={() => openCheckoutModal(shift)}
												class="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-bold text-white shadow-xs transition hover:bg-blue-700 active:scale-[0.98]"
											>
												<Clock class="size-4" />
												<span>เช็คเอาท์ออกจากงาน (Check-Out)</span>
											</button>
											<button
												type="button"
												onclick={() => openLeaveModal(shift)}
												class="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-border/80 bg-card px-4 py-2 text-xs font-medium text-muted-foreground transition hover:border-foreground/30 hover:text-foreground active:scale-[0.98]"
											>
												<span>ขอลา/ถอนกะงาน</span>
											</button>
										{/if}
									</div>
								</div>
							</div>
						{/each}

						{#if activeShifts.length > PAGE_SIZE}
							<div class="flex justify-center pt-2">
								<Pagination.Root
									bind:page={currentPage}
									count={activeShifts.length}
									perPage={PAGE_SIZE}
								>
									{#snippet children({ pages })}
										<Pagination.Content>
											<Pagination.Previous />
											{#each pages as p, i (i)}
												<Pagination.Item>
													{#if p.type === 'page'}
														<Pagination.Link page={p} isActive={p.value === currentPage} />
													{:else}
														<Pagination.Ellipsis />
													{/if}
												</Pagination.Item>
											{/each}
											<Pagination.Next />
										</Pagination.Content>
									{/snippet}
								</Pagination.Root>
							</div>
						{/if}
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
<QrScannerModal
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

<!-- ── MODAL: CHECK-IN CONFIRMATION ───────────────────────────────────────── -->
<Dialog.Root bind:open={isCheckinModalOpen}>
	<Dialog.Content class="rounded-3xl p-6 sm:max-w-md">
		<Dialog.Header class="space-y-2 text-left">
			<div
				class="inline-flex size-10 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
			>
				<UserCheck class="size-5" />
			</div>
			<Dialog.Title class="text-lg font-bold text-foreground">
				ยืนยันการรายงานตัวเข้างาน (Check-In)
			</Dialog.Title>
			<Dialog.Description class="text-xs leading-relaxed text-muted-foreground">
				กรุณายืนยันการรายงานตัวเข้ากะปฏิบัติการ ณ จุดศูนย์พักพิง
				ระบบจะบันทึกเวลาปัจจุบันในการเริ่มปฏิบัติงาน
			</Dialog.Description>
		</Dialog.Header>

		{#if modalTargetShift}
			<div class="my-4 space-y-2 rounded-2xl border border-border bg-muted/40 p-4">
				<div class="flex items-center gap-2">
					<span
						class="rounded bg-sky-100 px-2 py-0.5 text-3xs font-bold text-sky-700 dark:bg-sky-950 dark:text-sky-300"
					>
						{modalTargetShift.shiftPeriod}
					</span>
					<span class="text-xs font-bold text-foreground">{modalTargetShift.title}</span>
				</div>
				<p class="flex items-center gap-1.5 text-2xs text-muted-foreground">
					<MapPin class="size-3 text-primary" />
					{modalTargetShift.location}
				</p>
				<p class="flex items-center gap-1.5 text-2xs text-muted-foreground">
					<Clock class="size-3" />
					{modalTargetShift.dateText}
				</p>
			</div>
		{/if}

		<Dialog.Footer class="flex gap-2 sm:justify-end">
			<button
				type="button"
				onclick={() => (isCheckinModalOpen = false)}
				class="rounded-xl border border-border bg-card px-4 py-2.5 text-xs font-medium text-foreground hover:bg-muted"
			>
				ยกเลิก
			</button>
			<button
				type="button"
				onclick={handleConfirmCheckin}
				class="rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.98]"
			>
				ยืนยันเช็คอินเข้างาน
			</button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<!-- ── MODAL: CHECK-OUT CONFIRMATION ──────────────────────────────────────── -->
<Dialog.Root bind:open={isCheckoutModalOpen}>
	<Dialog.Content class="rounded-3xl p-6 sm:max-w-md">
		<Dialog.Header class="space-y-2 text-left">
			<div
				class="inline-flex size-10 items-center justify-center rounded-2xl bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
			>
				<Clock class="size-5" />
			</div>
			<Dialog.Title class="text-lg font-bold text-foreground">
				ยืนยันการเช็คเอาท์ออกจากงาน (Check-Out)
			</Dialog.Title>
			<Dialog.Description class="text-xs leading-relaxed text-muted-foreground">
				คุณได้ปฏิบัติภารกิจเสร็จสิ้นเรียบร้อยแล้วใช่หรือไม่?
				ระบบจะทำการบันทึกเวลาสิ้นสุดและสะสมชั่วโมงการทำงาน
			</Dialog.Description>
		</Dialog.Header>

		{#if modalTargetShift}
			<div class="my-4 space-y-2 rounded-2xl border border-border bg-muted/40 p-4">
				<div class="flex items-center gap-2">
					<span
						class="rounded bg-sky-100 px-2 py-0.5 text-3xs font-bold text-sky-700 dark:bg-sky-950 dark:text-sky-300"
					>
						{modalTargetShift.shiftPeriod}
					</span>
					<span class="text-xs font-bold text-foreground">{modalTargetShift.title}</span>
				</div>
				<p class="flex items-center gap-1.5 text-2xs text-muted-foreground">
					<MapPin class="size-3 text-primary" />
					{modalTargetShift.location}
				</p>
				{#if modalTargetShift.checkinTime}
					<p
						class="flex items-center gap-1.5 text-2xs font-medium text-emerald-600 dark:text-emerald-400"
					>
						<Clock class="size-3" /> เช็คอินเมื่อ: {modalTargetShift.checkinTime}
					</p>
				{/if}
			</div>
		{/if}

		<Dialog.Footer class="flex gap-2 sm:justify-end">
			<button
				type="button"
				onclick={() => (isCheckoutModalOpen = false)}
				class="rounded-xl border border-border bg-card px-4 py-2.5 text-xs font-medium text-foreground hover:bg-muted"
			>
				ยังไม่เช็คเอาท์
			</button>
			<button
				type="button"
				onclick={handleConfirmCheckout}
				class="rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-blue-700 active:scale-[0.98]"
			>
				ยืนยันเช็คเอาท์ออกจากงาน
			</button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<!-- ── MODAL: LEAVE / WITHDRAW SHIFT ──────────────────────────────────────── -->
<Dialog.Root bind:open={isLeaveModalOpen}>
	<Dialog.Content class="rounded-3xl p-6 sm:max-w-md">
		<Dialog.Header class="space-y-2 text-left">
			<div
				class="inline-flex size-10 items-center justify-center rounded-2xl bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
			>
				<AlertTriangle class="size-5" />
			</div>
			<Dialog.Title class="text-lg font-bold text-foreground">ขอลา / ถอนกะปฏิบัติการ</Dialog.Title>
			<Dialog.Description class="text-xs leading-relaxed text-muted-foreground">
				หากไม่สามารถมาปฏิบัติภารกิจได้ กรุณาระบุเหตุผลเพื่อให้เจ้าหน้าที่ศูนย์จัดสรรกำลังพลทดแทน
			</Dialog.Description>
		</Dialog.Header>

		<div class="my-4 space-y-3">
			{#if modalTargetShift}
				<div class="space-y-1 rounded-2xl border border-border bg-muted/40 p-3">
					<p class="text-xs font-bold text-foreground">{modalTargetShift.title}</p>
					<p class="text-2xs text-muted-foreground">{modalTargetShift.dateText}</p>
				</div>
			{/if}

			<div class="space-y-1.5">
				<label for="leave-reason-select" class="text-xs font-bold text-foreground">
					เหตุผลการขอลา
				</label>
				<select
					id="leave-reason-select"
					bind:value={leaveReason}
					class="w-full rounded-xl border border-border bg-card px-3 py-2 text-xs text-foreground outline-hidden focus:border-primary focus:ring-1 focus:ring-primary"
				>
					<option value="ติดภารกิจด่วน">ติดภารกิจด่วน / ธุระส่วนตัวจำเป็น</option>
					<option value="มีอาการป่วย/ไม่สบาย">มีอาการป่วย / สภาพร่างกายไม่พร้อม</option>
					<option value="ปัญหาการเดินทาง">ปัญหาการเดินทาง / เส้นทางถูกตัดขาด</option>
					<option value="อื่นๆ">อื่นๆ</option>
				</select>
			</div>

			<div class="space-y-1.5">
				<label for="leave-detail-input" class="text-xs font-bold text-foreground">
					รายละเอียดเพิ่มเติม (ถ้ามี)
				</label>
				<textarea
					id="leave-detail-input"
					bind:value={leaveReasonDetail}
					rows="2"
					placeholder="ระบุรายละเอียดเพิ่มเติม..."
					class="w-full resize-none rounded-xl border border-border bg-card p-2.5 text-xs text-foreground outline-hidden focus:border-primary focus:ring-1 focus:ring-primary"
				></textarea>
			</div>
		</div>

		<Dialog.Footer class="flex gap-2 sm:justify-end">
			<button
				type="button"
				onclick={() => (isLeaveModalOpen = false)}
				class="rounded-xl border border-border bg-card px-4 py-2.5 text-xs font-medium text-foreground hover:bg-muted"
			>
				ยกเลิก
			</button>
			<button
				type="button"
				onclick={handleConfirmLeave}
				class="text-destructive-foreground rounded-xl bg-destructive px-4 py-2.5 text-xs font-bold shadow-sm transition hover:opacity-95 active:scale-[0.98]"
			>
				ยืนยันการถอนกะงาน
			</button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
