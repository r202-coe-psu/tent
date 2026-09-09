<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import ClipboardList from '@lucide/svelte/icons/clipboard-list';
	import Clock from '@lucide/svelte/icons/clock';
	import Download from '@lucide/svelte/icons/download';
	import Filter from '@lucide/svelte/icons/filter';
	import LogIn from '@lucide/svelte/icons/log-in';
	import LogOut from '@lucide/svelte/icons/log-out';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Maximize2 from '@lucide/svelte/icons/maximize-2';
	import Phone from '@lucide/svelte/icons/phone';
	import QrCode from '@lucide/svelte/icons/qr-code';
	import Rocket from '@lucide/svelte/icons/rocket';
	import X from '@lucide/svelte/icons/x';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { useQueryClient } from '@tanstack/svelte-query';
	import { generateQrDataUrl } from '$lib/utils/qrcode';
	import { toast } from 'svelte-sonner';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import VolunteerQrScannerModal from '$lib/features/volunteers/components/VolunteerQrScannerModal.svelte';
	import DatePicker from '$lib/components/date-picker.svelte';
	import TimePicker from '$lib/components/time-picker.svelte';
	import {
		useRespondToDispatchMutation,
		useScheduleActionMutation,
		useResolvePortalAccessMutation,
		useVolunteerJobs,
		useVolunteerProfile,
		useVolunteerSchedule,
		useVolunteerTickets
	} from '../application/queries';
	import { volunteerPortalKeys } from '../application/queries';
	import JobBoard from '$lib/features/volunteers/components/JobBoard.svelte';
	import ProfileEditDialog from './profile-edit-dialog.svelte';
	import {
		isJobApplicable,
		normalizeTicketToken,
		portalCredentialSchema,
		PORTAL_SESSION_KEY,
		PORTAL_TOKEN_HANDOFF_KEY,
		responseCodeSchema,
		ticketFindSchema,
		ticketTokenFromScan,
		type PortalCredential,
		type VolunteerProfile
	} from '../domain/volunteer';
	import {
		filterAndSortPortalActivities,
		mergePortalActivities,
		parsePortalTimestamp,
		type PortalActivity
	} from '../domain/schedule-view';

	let {
		mode = 'entry',
		portalId = ''
	}: { mode?: 'entry' | 'dashboard' | 'openings'; portalId?: string } = $props();

	// ── VIEW MODEL ─────────────────────────────────────────────────────────────
	// The live profile, schedule and ticket responses are mapped into one render model.
	interface PortalVolunteer {
		id: string;
		volunteerCode: string;
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
		activities: PortalActivity[];
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
	let restoring = $state(true);
	let isLoggingIn = $state(false);

	function persistSession(credential: PortalCredential | null) {
		try {
			if (credential) sessionStorage.setItem(PORTAL_SESSION_KEY, JSON.stringify(credential));
			else sessionStorage.removeItem(PORTAL_SESSION_KEY);
		} catch {
			// Storage can be unavailable in private mode; the current page still works.
		}
	}

	function portalPath(id: string, section = 'dashboard') {
		return `/volunteers/portal/volunteer/${encodeURIComponent(id)}/${section}`;
	}

	function clearPortalSession() {
		try {
			sessionStorage.removeItem(PORTAL_SESSION_KEY);
			sessionStorage.removeItem(PORTAL_TOKEN_HANDOFF_KEY);
		} catch {
			// Storage unavailable.
		}
	}

	function enterDashboard(credential: PortalCredential & { portal_id: string }) {
		session = credential;
		persistSession(credential);
		void goto(portalPath(credential.portal_id));
	}

	const resolveAccess = useResolvePortalAccessMutation();
	const queryClient = useQueryClient();

	async function resolveAndEnter(credential: PortalCredential) {
		isLoggingIn = true;
		loginError = '';
		try {
			const profile = await resolveAccess.mutateAsync(credential);
			if (!profile?.portal_id) {
				loginError = 'ไม่พบเบอร์โทรศัพท์นี้ในระบบจิตอาสา กรุณาตรวจสอบเบอร์ที่ใช้สมัครอีกครั้ง';
				return;
			}
			toast.success('เข้าสู่ระบบสำเร็จ');
			enterDashboard({ ...credential, portal_id: profile.portal_id });
		} catch (error) {
			loginError = error instanceof Error ? error.message : 'ไม่สามารถตรวจสอบข้อมูลจิตอาสาได้';
		} finally {
			isLoggingIn = false;
		}
	}

	/** Restore a short-lived session or the token handed over after a new booking. */
	onMount(() => {
		if (session) {
			restoring = false;
			if (mode === 'entry' && session.portal_id) void goto(portalPath(session.portal_id));
			return;
		}
		let handed: string | null = null;
		let stored: string | null = null;
		try {
			handed = sessionStorage.getItem(PORTAL_TOKEN_HANDOFF_KEY);
			if (handed) sessionStorage.removeItem(PORTAL_TOKEN_HANDOFF_KEY);
			stored = sessionStorage.getItem(PORTAL_SESSION_KEY);
		} catch {
			// Storage unavailable; the login form is still there.
		}
		const token = handed ? normalizeTicketToken(handed) : null;
		if (token) {
			void resolveAndEnter({ token });
			restoring = false;
			return;
		}
		if (!stored) {
			restoring = false;
			if (mode !== 'entry') void goto('/volunteers/portal');
			return;
		}
		try {
			const parsed = portalCredentialSchema.safeParse(JSON.parse(stored));
			if (parsed.success && parsed.data.portal_id) {
				if (mode !== 'entry' && portalId !== parsed.data.portal_id) {
					clearPortalSession();
					void goto('/volunteers/portal');
					restoring = false;
					return;
				}
				session = parsed.data;
				if (mode === 'entry') void goto(portalPath(parsed.data.portal_id));
			} else {
				clearPortalSession();
				if (mode !== 'entry') void goto('/volunteers/portal');
			}
		} catch {
			clearPortalSession();
			if (mode !== 'entry') void goto('/volunteers/portal');
		}
		restoring = false;
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
	const scheduleAction = useScheduleActionMutation(() => session);

	/** Per-offer code entry, keyed by assignment so two offers keep their own box. */
	let dispatchCodes = $state<Record<string, string>>({});
	let dispatchErrors = $state<Record<string, string>>({});
	let answering = $state<string | null>(null);
	// ── LIVE SESSION → VIEW MODEL ──────────────────────────────────────────────
	const PORTAL_TIME_ZONE = 'Asia/Bangkok';

	function clockText(iso: string | null): string | undefined {
		if (!iso) return undefined;
		const parsed = parsePortalTimestamp(iso);
		return Number.isNaN(parsed.getTime())
			? undefined
			: `${parsed.toLocaleTimeString('th-TH', {
					hour: '2-digit',
					minute: '2-digit',
					second: '2-digit',
					timeZone: PORTAL_TIME_ZONE
				})} น.`;
	}

	function timeRange(activity: PortalActivity): string {
		if (!activity.startTs) return activity.date || 'ยังไม่ระบุวัน';
		const start = parsePortalTimestamp(activity.startTs);
		if (Number.isNaN(start.getTime())) return activity.date || 'ยังไม่ระบุวัน';
		const opts = { hour: '2-digit', minute: '2-digit', timeZone: PORTAL_TIME_ZONE } as const;
		const from = start.toLocaleTimeString('th-TH', opts);
		const end = activity.endTs ? parsePortalTimestamp(activity.endTs) : null;
		const to =
			end && !Number.isNaN(end.getTime()) ? ` - ${end.toLocaleTimeString('th-TH', opts)}` : '';
		return `${activity.date} • ${from}${to}`;
	}

	function toPortalVolunteer(
		profile: VolunteerProfile,
		shifts: Parameters<typeof mergePortalActivities>[0],
		tickets: Parameters<typeof mergePortalActivities>[1]
	): PortalVolunteer {
		const named = `${profile.first_name} ${profile.last_name}`.trim();
		const activities = mergePortalActivities(shifts, tickets);
		const first = activities[0];
		// A token session never holds the raw number — the API returns it masked, which
		// is also what may be shown on a screen held up at a gate (AC-VOL-03).
		const shownPhone = profile.phone_masked;
		return {
			id: profile.portal_id,
			volunteerCode: profile.volunteer_code,
			name: named || profile.nickname || 'จิตอาสา',
			avatar: (named || profile.nickname || 'อา').slice(0, 2),
			phone: shownPhone,
			shelterName: first?.location ?? '',
			shelterCode: first?.shelterCode ?? '',
			verified: profile.identity_verified,
			statusText: activities.some((s) => s.status === 'checked_in')
				? 'ปฏิบัติหน้าที่อยู่'
				: activities.length
					? 'พร้อมปฏิบัติงาน'
					: 'รอการมอบหมาย',
			statusType: activities.some((s) => s.status === 'checked_in') ? 'active' : 'pending',
			roleType: profile.personnel_type || 'จิตอาสา',
			readiness: false,
			scheduleCount: activities.length,
			activities
		};
	}

	const liveVolunteer = $derived.by(() => {
		const credential = session;
		if (!credential) return null;
		// Held back until the schedule has answered, so the dashboard does not flash an
		// empty roster at someone who does have shifts.
		if (restoring || profileQuery.isPending || scheduleQuery.isPending || ticketsQuery.isPending)
			return null;
		const profile = profileQuery.data;
		if (!profile || !profile.portal_id || profile.portal_id !== credential.portal_id) return null;
		return toPortalVolunteer(profile, scheduleQuery.data ?? [], ticketsQuery.data?.tickets ?? []);
	});

	/** The open session, or null when signed out. The markup below reads only this. */
	const currentVolunteer = $derived(liveVolunteer);

	let filterFromDate = $state('');
	let filterToDate = $state('');
	let filterFromTime = $state('');
	let filterToTime = $state('');
	let filterStatus = $state('');
	let filterJobTitle = $state('');
	const visibleActivities = $derived.by(() =>
		filterAndSortPortalActivities(currentVolunteer?.activities ?? [], {
			fromDate: filterFromDate,
			toDate: filterToDate,
			fromTime: filterFromTime,
			toTime: filterToTime,
			status: filterStatus,
			title: filterJobTitle
		})
	);

	let actingAssignment = $state<string | null>(null);
	let withdrawModalOpen = $state(false);
	let pendingWithdrawal = $state<PortalActivity | null>(null);

	function activityStatusLabel(activity: PortalActivity): string {
		if (activity.status === 'booking') return 'รอเจ้าหน้าที่จัดกะ';
		if (activity.dispatchStatus === 'dispatched') return 'รอยืนยันการมอบหมาย';
		return (
			(
				{
					assigned: 'รอ Check-in',
					standby: 'รอ Check-in',
					checked_in: 'กำลังปฏิบัติงาน',
					completed: 'เสร็จสิ้นภารกิจแล้ว',
					done: 'เสร็จสิ้นภารกิจแล้ว',
					no_show: 'ไม่มาปฏิบัติงาน',
					cancelled: 'ถอนกะแล้ว'
				} as Record<string, string>
			)[activity.status] ?? activity.status
		);
	}

	function activityStatusClass(activity: PortalActivity): string {
		if (activity.status === 'checked_in')
			return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300';
		if (activity.status === 'booking')
			return 'bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300';
		if (activity.status === 'completed' || activity.status === 'done')
			return 'bg-muted text-muted-foreground';
		return 'bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300';
	}

	function canCheckIn(activity: PortalActivity): boolean {
		return (
			Boolean(activity.assignmentId) &&
			activity.dispatchStatus !== 'dispatched' &&
			['assigned', 'standby'].includes(activity.status)
		);
	}

	function canCheckOut(activity: PortalActivity): boolean {
		return Boolean(activity.assignmentId) && activity.status === 'checked_in';
	}

	function canWithdraw(activity: PortalActivity): boolean {
		return (
			Boolean(activity.assignmentId) &&
			activity.dispatchStatus !== 'dispatched' &&
			['assigned', 'standby'].includes(activity.status)
		);
	}

	function openWithdrawModal(activity: PortalActivity) {
		if (!activity.assignmentId || actingAssignment !== null) return;
		pendingWithdrawal = activity;
		withdrawModalOpen = true;
	}

	function closeWithdrawModal() {
		if (actingAssignment !== null) return;
		withdrawModalOpen = false;
		pendingWithdrawal = null;
	}

	async function confirmWithdrawal() {
		const activity = pendingWithdrawal;
		if (!activity?.assignmentId || actingAssignment !== null) return;
		withdrawModalOpen = false;
		pendingWithdrawal = null;
		await runScheduleAction(activity, 'withdraw');
	}

	async function runScheduleAction(
		activity: PortalActivity,
		action: 'check_in' | 'check_out' | 'withdraw'
	) {
		if (!activity.assignmentId) return;
		actingAssignment = `${activity.assignmentId}:${action}`;
		try {
			await scheduleAction.mutateAsync({ assignment_id: activity.assignmentId, action });
			toast.success(
				action === 'check_in'
					? 'เช็คอินเข้าปฏิบัติงานแล้ว'
					: action === 'check_out'
						? 'เช็คเอาต์ออกจากงานแล้ว'
						: 'ถอนกะและส่งคำขอลาแล้ว'
			);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'ดำเนินการกับกะงานไม่สำเร็จ');
		} finally {
			actingAssignment = null;
		}
	}

	function clearScheduleFilters() {
		filterFromDate = '';
		filterToDate = '';
		filterFromTime = '';
		filterToTime = '';
		filterStatus = '';
		filterJobTitle = '';
	}

	let dashboardTab = $state<'schedule' | 'openings'>('schedule');
	$effect(() => {
		if (mode === 'openings') dashboardTab = 'openings';
		if (mode === 'dashboard') dashboardTab = 'schedule';
	});
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
	/**
	 * Read a volunteer QR and sign in with what it contains.
	 *
	 * The scanning itself lives in the shared volunteer QR scanner; this only decides
	 * what a decoded payload means. The pass encodes its own
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
	let qrGeneration = 0;

	// The role card must carry a resolvable token, never the internal volunteer id. A
	// token-login session already has the applicant's tracking token. Phone login receives
	// a short-lived read-only VIEW token for the first booking, which still gives the
	// onsite scanner a token-shaped payload without exposing a cancellable ticket token.
	$effect(() => {
		const payload =
			session?.token ??
			currentVolunteer?.activities.find((activity) => activity.ticketToken)?.ticketToken;
		const generation = ++qrGeneration;
		if (!payload) {
			qrDataUrl = '';
			return;
		}
		generateQrDataUrl(payload, {
			width: 320,
			margin: 1,
			color: { dark: '#0A2647', light: '#ffffff' }
		})
			.then((url) => {
				if (generation === qrGeneration) qrDataUrl = url;
			})
			.catch(() => {
				if (generation === qrGeneration) qrDataUrl = '';
			});
	});

	async function handlePhoneLogin(e: SubmitEvent) {
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
		await resolveAndEnter({ phone: parsed.data.phone });
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
	async function submitToken(value: string) {
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
		await resolveAndEnter({ token });
	}

	function handleTokenLogin(e: SubmitEvent) {
		e.preventDefault();
		void submitToken(inputToken);
	}

	/**
	 * Answer an offered shift (CR-092 FR-VOL-06).
	 *
	 * Two factors: the number this session signed in with, and the short code a manager
	 * reads out on the phone. The phone alone is guessable and a declined shift cannot
	 * be un-declined from here, so the code is what makes the write safe.
	 */
	async function answerDispatch(shift: PortalActivity, action: 'accepted' | 'declined') {
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
		clearPortalSession();
		dispatchCodes = {};
		dispatchErrors = {};
		inputPhone = '';
		inputToken = '';
		loginError = '';
		queryClient.removeQueries({ queryKey: volunteerPortalKeys.all });
		toast.info('ออกจากระบบแล้ว');
		void goto('/volunteers/portal');
	}

	function downloadRoleCardQr() {
		if (!qrDataUrl || !currentVolunteer) {
			toast.info('QR Code ยังไม่พร้อมดาวน์โหลด');
			return;
		}
		const link = document.createElement('a');
		link.href = qrDataUrl;
		link.download = `volunteer-role-card-${currentVolunteer.volunteerCode}.png`;
		link.click();
		toast.success('ดาวน์โหลด QR Role Card เรียบร้อยแล้ว');
	}

	$effect(() => {
		if (
			mode !== 'entry' &&
			session &&
			!restoring &&
			!profileQuery.isPending &&
			(profileQuery.isError || profileQuery.data === null)
		) {
			session = null;
			clearPortalSession();
			void goto('/volunteers/portal');
		}
	});
</script>

<div class="mx-auto w-full max-w-6xl space-y-8">
	<!-- TOP BRAND HEADER -->
	<header class="space-y-3 text-center">
		<h1 class="text-3xl font-extrabold tracking-tight text-foreground md:text-4xl">
			{currentVolunteer ? 'ตารางงานจิตอาสา' : 'เข้าสู่ระบบตารางทำงานจิตอาสา'}
		</h1>
		{#if !currentVolunteer}
			<p class="mx-auto max-w-xl text-sm font-medium text-muted-foreground">
				กรุณาระบุหมายเลขโทรศัพท์ หรือสแกน QR Code / กรอกรหัส Token เพื่อเข้าสู่ระบบและจัดการตารางงาน
			</p>
		{/if}
	</header>

	{#if mode !== 'entry' && session && (restoring || !currentVolunteer)}
		<div
			class="mx-auto max-w-2xl rounded-3xl border border-border bg-card p-10 text-center shadow-sm"
		>
			<p class="text-sm font-bold text-foreground">กำลังตรวจสอบข้อมูลจิตอาสา…</p>
			<p class="mt-2 text-xs text-muted-foreground">กำลังโหลดโปรไฟล์และตารางงานของคุณ</p>
		</div>
	{:else if !currentVolunteer}
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
							disabled={isLoggingIn}
							class="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary py-3.5 text-sm font-bold text-primary-foreground shadow-md transition-all hover:opacity-95 active:scale-[0.99] disabled:cursor-wait disabled:opacity-60"
						>
							<Rocket class="size-4" />
							<span>{isLoggingIn ? 'กำลังตรวจสอบ…' : 'เข้าสู่ระบบทันที'}</span>
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
									disabled={isLoggingIn}
									class="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-xl bg-primary px-5 py-3 text-xs font-bold text-primary-foreground shadow-sm hover:opacity-95 disabled:cursor-wait disabled:opacity-60"
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
							<VolunteerQrScannerModal inline disabled={isLoggingIn} onScan={handleScanToken} />
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

			<!-- Right: Actions -->
			<div class="flex flex-wrap items-center gap-3">
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
					onclick={() => void goto(portalPath(currentVolunteer.id, 'dashboard'))}
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
					onclick={() => void goto(portalPath(currentVolunteer.id, 'openings'))}
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
					<div class="flex items-center justify-between pt-2">
						<div>
							<h3 class="text-sm font-bold text-foreground md:text-base">รายการภารกิจของฉัน</h3>
							<p class="mt-1 text-2xs text-muted-foreground">เรียงจากวันที่ใกล้ที่สุดก่อน</p>
						</div>
						<span class="rounded-full bg-primary/10 px-2.5 py-1 text-2xs font-bold text-primary">
							{visibleActivities.length} รายการ
						</span>
					</div>

					<div class="rounded-2xl border border-border bg-card p-4 shadow-sm">
						<div class="mb-3 flex items-center gap-2 text-xs font-bold text-foreground">
							<Filter class="size-4 text-primary" /> ตัวกรองภารกิจ
						</div>
						<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
							<label class="space-y-1 text-2xs font-semibold text-muted-foreground">
								<span>ตั้งแต่วันที่</span>
								<DatePicker
									id="portal-filter-from-date"
									bind:value={filterFromDate}
									placeholder="เลือกวันที่เริ่มต้น"
								/>
							</label>
							<label class="space-y-1 text-2xs font-semibold text-muted-foreground">
								<span>ถึงวันที่</span>
								<DatePicker
									id="portal-filter-to-date"
									bind:value={filterToDate}
									placeholder="เลือกวันที่สิ้นสุด"
								/>
							</label>
							<label class="space-y-1 text-2xs font-semibold text-muted-foreground">
								<span>เวลาตั้งแต่</span>
								<TimePicker
									id="portal-filter-from-time"
									bind:value={filterFromTime}
									placeholder="เลือกเวลาเริ่มต้น"
								/>
							</label>
							<label class="space-y-1 text-2xs font-semibold text-muted-foreground">
								<span>เวลาถึง</span>
								<TimePicker
									id="portal-filter-to-time"
									bind:value={filterToTime}
									placeholder="เลือกเวลาสิ้นสุด"
								/>
							</label>
							<label class="space-y-1 text-2xs font-semibold text-muted-foreground">
								<span>สถานะงาน</span>
								<select
									bind:value={filterStatus}
									class="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground"
								>
									<option value="">ทุกสถานะ</option>
									<option value="booking">รอเจ้าหน้าที่จัดกะ</option>
									<option value="dispatched">รอยืนยันการมอบหมาย</option>
									<option value="assigned">รอ Check-in</option>
									<option value="standby">รอ Check-in (สำรอง)</option>
									<option value="checked_in">กำลังปฏิบัติงาน</option>
									<option value="completed">เสร็จสิ้นภารกิจ</option>
									<option value="no_show">ไม่มาปฏิบัติงาน</option>
								</select>
							</label>
							<label class="space-y-1 text-2xs font-semibold text-muted-foreground">
								<span>ชื่องาน</span>
								<input
									type="search"
									bind:value={filterJobTitle}
									placeholder="ค้นหาชื่องาน..."
									class="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground"
								/>
							</label>
						</div>
						{#if filterFromDate || filterToDate || filterFromTime || filterToTime || filterStatus || filterJobTitle}
							<button
								type="button"
								onclick={clearScheduleFilters}
								class="mt-3 text-2xs font-bold text-primary hover:underline"
							>
								ล้างตัวกรอง
							</button>
						{/if}
					</div>

					{#if currentVolunteer.activities.length === 0}
						<div
							class="rounded-3xl border border-dashed border-border bg-card p-10 text-center text-muted-foreground"
						>
							<ClipboardList class="mx-auto mb-3 size-10 text-muted-foreground/60" />
							<p class="text-sm font-bold text-foreground">ตอนนี้ยังไม่มีภารกิจ</p>
							<p class="mt-1 text-xs">เมื่อมีการจองหรือได้รับมอบหมาย งานจะปรากฏรวมกันที่นี่</p>
							<button
								type="button"
								onclick={() => void goto(portalPath(currentVolunteer.id, 'openings'))}
								class="mt-4 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-white shadow-sm hover:opacity-95"
							>
								ดูตลาดงานจิตอาสา
							</button>
						</div>
					{:else if visibleActivities.length === 0}
						<div
							class="rounded-3xl border border-dashed border-border bg-card p-10 text-center text-muted-foreground"
						>
							<Filter class="mx-auto mb-3 size-10 text-muted-foreground/60" />
							<p class="text-sm font-bold text-foreground">ไม่พบภารกิจตามตัวกรอง</p>
							<p class="mt-1 text-xs">ลองขยายช่วงวันที่หรือเวลา แล้วค้นหาใหม่</p>
						</div>
					{:else}
						{#each visibleActivities as activity (activity.id)}
							<div
								class="rounded-3xl border bg-card p-6 shadow-sm transition-all hover:shadow-md {activity.status ===
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
												{activity.shiftPeriod || 'กะงาน'}
											</span>
											<span
												class="rounded-md px-2 py-0.5 text-2xs font-bold {activityStatusClass(
													activity
												)}"
											>
												{activityStatusLabel(activity)}
											</span>
										</div>

										<h4 class="text-base font-bold text-foreground">{activity.title}</h4>
										<p class="text-xs leading-relaxed text-muted-foreground">
											{activity.description}
										</p>

										<div
											class="flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-muted-foreground"
										>
											<span class="flex items-center gap-1 font-medium text-foreground">
												<MapPin class="size-3 text-primary" />
												{activity.location}
											</span>
											<span class="flex items-center gap-1">
												<Clock class="size-3" />
												{timeRange(activity)}
											</span>
										</div>

										<!-- Checkin info -->
										<div
											class="flex flex-wrap items-center gap-3 pt-1 text-2xs text-muted-foreground"
										>
											{#if activity.checkinAt}
												<span class="flex items-center gap-1 font-medium text-emerald-700">
													<Clock class="size-3" /> เช็คอิน: {clockText(activity.checkinAt)}
												</span>
											{/if}
											{#if activity.checkoutAt}
												<span class="flex items-center gap-1 font-medium text-muted-foreground">
													<Clock class="size-3" /> เช็คเอาต์: {clockText(activity.checkoutAt)}
												</span>
											{/if}
										</div>
									</div>

									<!-- Actions -->
									<div class="flex shrink-0 flex-col gap-2 sm:flex-row md:flex-col">
										{#if activity.dispatchStatus === 'dispatched' && activity.assignmentId}
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
													bind:value={dispatchCodes[activity.assignmentId]}
													placeholder="เช่น 4K7-2M9"
													aria-label="รหัสยืนยันภารกิจ"
													autocomplete="off"
													maxlength={10}
													class="w-full rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground uppercase outline-hidden focus:border-primary focus:ring-1 focus:ring-primary"
												/>
												{#if dispatchErrors[activity.assignmentId]}
													<p class="text-2xs text-destructive" role="alert">
														{dispatchErrors[activity.assignmentId]}
													</p>
												{/if}
												<div class="flex gap-2">
													<button
														type="button"
														disabled={answering === activity.assignmentId}
														onclick={() => answerDispatch(activity, 'accepted')}
														class="flex flex-1 cursor-pointer items-center justify-center gap-1 rounded-lg bg-primary px-3 py-2 text-2xs font-bold text-primary-foreground shadow-sm hover:opacity-95 disabled:opacity-60"
													>
														<Check class="size-3.5" />
														ยอมรับภารกิจ
													</button>
													<button
														type="button"
														disabled={answering === activity.assignmentId}
														onclick={() => answerDispatch(activity, 'declined')}
														class="flex flex-1 cursor-pointer items-center justify-center gap-1 rounded-lg border border-border px-3 py-2 text-2xs font-bold text-muted-foreground transition-colors hover:border-destructive hover:text-destructive disabled:opacity-60"
													>
														<X class="size-3.5" />
														ปฏิเสธภารกิจ
													</button>
												</div>
											</div>
										{/if}
									</div>
									{#if canCheckIn(activity) || canCheckOut(activity) || canWithdraw(activity)}
										<div class="flex w-full flex-col gap-2 md:w-56">
											{#if canCheckIn(activity)}
												<button
													type="button"
													disabled={actingAssignment !== null}
													onclick={() => runScheduleAction(activity, 'check_in')}
													class="flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60"
												>
													<LogIn class="size-4" /> รายงานตัว Check-in
												</button>
											{/if}
											{#if canCheckOut(activity)}
												<button
													type="button"
													disabled={actingAssignment !== null}
													onclick={() => runScheduleAction(activity, 'check_out')}
													class="flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-bold text-white shadow-sm hover:opacity-95 disabled:opacity-60"
												>
													<LogOut class="size-4" /> เช็คเอาต์ออกจากงาน
												</button>
											{/if}
											{#if canWithdraw(activity)}
												<button
													type="button"
													disabled={actingAssignment !== null}
													onclick={() => openWithdrawModal(activity)}
													class="rounded-xl border border-destructive/30 px-4 py-2.5 text-xs font-bold text-destructive hover:bg-destructive/5 disabled:opacity-60"
												>
													ขอลา / ถอนกะ
												</button>
											{/if}
										</div>
									{/if}
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
							<div class="flex items-center gap-3">
								<button
									type="button"
									onclick={downloadRoleCardQr}
									disabled={!qrDataUrl}
									class="flex items-center gap-1 text-2xs font-bold text-primary hover:underline disabled:cursor-wait disabled:opacity-50"
								>
									<Download class="size-3" /> ดาวน์โหลด QR
								</button>
								<button
									type="button"
									onclick={() => (isPassModalOpen = true)}
									class="flex items-center gap-1 text-2xs font-bold text-primary hover:underline"
								>
									<Maximize2 class="size-3" /> ขยายบัตร
								</button>
							</div>
						</div>
						<p class="mt-2 text-2xs text-muted-foreground">
							คุณสามารถรับสิทธิสวัสดิการ อาหารร้อน น้ำดื่ม และเวชภัณฑ์ที่เจ้าหน้าที่จัดเตรียมไว้
							โดยใช้บัตรนี้แสดงต่อเจ้าหน้าที่ ณ จุดแจกจ่าย
						</p>

						<!-- Mini QR Role Card, available for every resolved volunteer session. -->
						<div
							class="mt-4 rounded-2xl border border-border bg-muted/20 p-4 text-center transition-all hover:bg-muted/30"
						>
							{#if qrDataUrl}
								<img
									src={qrDataUrl}
									alt="QR Code รหัสอาสาสมัคร: {currentVolunteer.volunteerCode}"
									class="mx-auto size-28 rounded-xl border border-border bg-white p-1.5 shadow-xs"
								/>
							{:else}
								<div
									class="mx-auto flex size-28 items-center justify-center rounded-xl bg-white text-muted-foreground"
								>
									<QrCode class="size-16 animate-pulse" />
								</div>
							{/if}
							<h5 class="mt-2.5 text-xs font-black text-foreground">{currentVolunteer.name}</h5>
							<p class="text-2xs font-semibold text-muted-foreground">
								รหัสอาสาสมัคร: {currentVolunteer.volunteerCode}
							</p>
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

					<Dialog.Root
						open={withdrawModalOpen}
						onOpenChange={(open) => !open && closeWithdrawModal()}
					>
						<Dialog.Content class="sm:max-w-md">
							<Dialog.Header>
								<Dialog.Title class="flex items-center gap-2">
									<CircleAlert class="size-5 text-destructive" />
									ยืนยันการลาและถอนกะ
								</Dialog.Title>
								<Dialog.Description>
									เมื่อยืนยันแล้ว ระบบจะถอนการมอบหมายกะนี้และส่งสถานะการลาให้เจ้าหน้าที่รับทราบ
								</Dialog.Description>
							</Dialog.Header>

							{#if pendingWithdrawal}
								<div class="rounded-2xl border border-border bg-muted/30 p-4">
									<p class="text-sm font-bold text-foreground">{pendingWithdrawal.title}</p>
									<p class="mt-1 text-xs text-muted-foreground">
										{pendingWithdrawal.date} · {timeRange(pendingWithdrawal)}
									</p>
									<p class="mt-1 text-xs text-muted-foreground">{pendingWithdrawal.location}</p>
								</div>
							{/if}

							<Dialog.Footer class="gap-2">
								<Button
									variant="outline"
									onclick={closeWithdrawModal}
									disabled={actingAssignment !== null}
								>
									กลับไป
								</Button>
								<Button
									variant="destructive"
									onclick={confirmWithdrawal}
									disabled={actingAssignment !== null || pendingWithdrawal === null}
								>
									ยืนยันลาและถอนกะ
								</Button>
							</Dialog.Footer>
						</Dialog.Content>
					</Dialog.Root>
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
			<JobBoard applicantProfile={profileQuery.data} applicantCredential={session} />
		{/if}
	{/if}
</div>

<!-- Esc and the browser's own control leave fullscreen without touching our flag. -->
<svelte:document
	onfullscreenchange={() => (isPassFullscreen = Boolean(document.fullscreenElement))}
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
				<p class="font-mono text-xs text-muted-foreground">{currentVolunteer.volunteerCode}</p>

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
