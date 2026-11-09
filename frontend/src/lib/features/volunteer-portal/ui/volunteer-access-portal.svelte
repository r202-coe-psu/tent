<script lang="ts">
	import Calendar from '@lucide/svelte/icons/calendar';
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
	import Ticket from '@lucide/svelte/icons/ticket';
	import QrCode from '@lucide/svelte/icons/qr-code';
	import Rocket from '@lucide/svelte/icons/rocket';
	import X from '@lucide/svelte/icons/x';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { useQueryClient } from '@tanstack/svelte-query';
	import { generateQrDataUrl } from '$lib/utils/qrcode';
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { toast } from 'svelte-sonner';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import VolunteerQrScannerModal from '$lib/features/volunteers/ui/volunteer-qr-scanner-modal.svelte';
	import DatePicker from '$lib/components/date-picker.svelte';
	import TimePicker from '$lib/components/time-picker.svelte';
	import {
		useRespondToDispatchMutation,
		useScheduleActionMutation,
		useResolvePortalAccessMutation,
		useRoleCardTokenMutation,
		useVolunteerAccessStatus,
		useVolunteerApplications,
		useVolunteerJobs,
		useVolunteerProfile,
		useVolunteerSchedule,
		useVolunteerTickets
	} from '../application/queries';
	import { useCancelTicketMutation, volunteerPortalKeys } from '../application/queries';
	import JobBoard from '$lib/features/volunteers/ui/public-job-board.svelte';
	import AccessStatusCard from './access-status-card.svelte';
	import ProfileEditDialog from './profile-edit-dialog.svelte';
	import {
		buildRememberedPortalCredential,
		buildStoredPortalSession,
		isJobApplicable,
		isStoredPortalSessionExpired,
		normalizeTicketToken,
		portalCredentialSchema,
		PORTAL_REMEMBER_KEY,
		PORTAL_SESSION_KEY,
		PORTAL_TOKEN_HANDOFF_KEY,
		readRememberedPortalCredential,
		responseCodeSchema,
		ticketFindSchema,
		ticketTokenFromScan,
		type PortalCredential,
		type VolunteerProfile
	} from '../domain/volunteer';
	import { localizeVolunteerMessage } from '$lib/constants/i18n/volunteer-messages';
	import { accessPortalI18n } from '../i18n/access-portal.i18n';
	import {
		filterAndSortPortalActivities,
		mergePortalActivities,
		parsePortalTimestamp,
		portalTicketActions,
		type PortalActivity
	} from '../domain/schedule-view';

	let {
		mode = 'entry',
		portalId = ''
	}: { mode?: 'entry' | 'dashboard' | 'openings'; portalId?: string } = $props();

	const t = $derived(getTranslation(accessPortalI18n, langState.current));
	/** Server and schema messages arrive in Thai; read at the moment of display, in the current language. */
	const localized = (message: string) => localizeVolunteerMessage(message, langState.current);

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
	/** Opt-in "จดจำเครื่องนี้" for the next sign-in on this tab (#625). Unticked by default. */
	let rememberDevice = $state(false);

	/**
	 * What this session signed in with — a phone number or a ticket token. `null` =
	 * signed out. Both doors resolve to the same volunteer server-side, so everything
	 * below is written against the credential, never against "the phone".
	 *
	 * A token sign-in also gets an explicit 30-minute clock in `sessionStorage` (see
	 * `PORTAL_TOKEN_SESSION_TTL_MS`) — the permanent `TKT-VOL-` token behind it no longer
	 * expires on its own, so this portal enforces its own session timeout for that door.
	 * Phone sign-ins are unaffected: they stay unbounded for the life of the tab, same as
	 * today, because re-entering a phone number is cheap.
	 */
	let session = $state<PortalCredential | null>(null);
	let restoring = $state(true);
	let isLoggingIn = $state(false);
	let roleCardPayload = $state('');
	let roleCardLookupKey = $state('');
	let roleCardLoading = $state(false);

	function persistSession(credential: PortalCredential | null) {
		try {
			if (credential) {
				sessionStorage.setItem(
					PORTAL_SESSION_KEY,
					JSON.stringify(buildStoredPortalSession(credential))
				);
			} else {
				sessionStorage.removeItem(PORTAL_SESSION_KEY);
			}
		} catch {
			// Storage can be unavailable in private mode; the current page still works.
		}
	}

	/** Typed so `resolve()` can check it against the real `[portalId]/{section}` routes. */
	function portalPath(id: string, section: 'dashboard' | 'openings' = 'dashboard') {
		return `/volunteers/portal/volunteer/${encodeURIComponent(id)}/${section}` as const;
	}

	function clearPortalSession() {
		try {
			sessionStorage.removeItem(PORTAL_SESSION_KEY);
			sessionStorage.removeItem(PORTAL_TOKEN_HANDOFF_KEY);
		} catch {
			// Storage unavailable.
		}
	}

	/**
	 * "จดจำเครื่องนี้" (#625, CR-127 note): the token sign-in kept in `localStorage` for
	 * `PORTAL_REMEMBER_TTL_MS`. A phone sign-in is never remembered.
	 */
	function rememberThisDevice(credential: PortalCredential & { portal_id: string }) {
		const record = buildRememberedPortalCredential(credential);
		if (!record) return;
		try {
			localStorage.setItem(PORTAL_REMEMBER_KEY, JSON.stringify(record));
		} catch {
			// Storage unavailable (private mode); this sign-in still works, it just is not kept.
		}
	}

	function forgetThisDevice() {
		try {
			localStorage.removeItem(PORTAL_REMEMBER_KEY);
		} catch {
			// Storage unavailable.
		}
	}

	/** The remembered sign-in, or `null` — an expired or malformed record is forgotten. */
	function readThisDevice() {
		try {
			const raw = localStorage.getItem(PORTAL_REMEMBER_KEY);
			if (!raw) return null;
			const remembered = readRememberedPortalCredential(JSON.parse(raw));
			if (!remembered) forgetThisDevice();
			return remembered;
		} catch {
			forgetThisDevice();
			return null;
		}
	}

	function enterDashboard(credential: PortalCredential & { portal_id: string }) {
		session = credential;
		persistSession(credential);
		void goto(resolve(portalPath(credential.portal_id)));
	}

	const resolveAccess = useResolvePortalAccessMutation();
	const roleCardToken = useRoleCardTokenMutation();
	const queryClient = useQueryClient();

	/**
	 * Phone login has no raw token to put in the QR. Ask the server to inspect this
	 * volunteer's own document instead: an existing hash becomes a hash-backed role-card
	 * payload, while a profile without one gets a token minted there. Neither path needs a
	 * job or an application.
	 */
	$effect(() => {
		const credential = session;
		if (!credential?.phone || !credential.portal_id) return;
		const lookupKey = `${credential.phone}:${credential.portal_id}`;
		if (roleCardLookupKey === lookupKey || roleCardLoading) return;
		roleCardLookupKey = lookupKey;
		roleCardLoading = true;
		void roleCardToken
			.mutateAsync({ phone: credential.phone, portal_id: credential.portal_id })
			.then((result) => {
				roleCardPayload = result.token;
			})
			.catch(() => {
				roleCardPayload = '';
			})
			.finally(() => {
				roleCardLoading = false;
			});
	});

	/**
	 * @param options.remember   keep this sign-in on the device ("จดจำเครื่องนี้")
	 * @param options.remembered this credential came from a remembered device — if the
	 *   server no longer knows it (token revoked / reissued), forget the device
	 */
	async function resolveAndEnter(
		credential: PortalCredential,
		options: { remember?: boolean; remembered?: boolean } = {}
	) {
		isLoggingIn = true;
		loginError = '';
		try {
			const profile = await resolveAccess.mutateAsync(credential);
			if (!profile?.portal_id) {
				if (options.remembered) {
					forgetThisDevice();
					loginError = t.rememberedForgotten;
				} else if (credential.token) {
					loginError = t.tokenNotFound;
				} else {
					loginError = t.phoneNotFound;
				}
				toast.error(loginError);
				return;
			}
			if (options.remember) rememberThisDevice({ ...credential, portal_id: profile.portal_id });
			toast.success(t.loginSuccess);
			enterDashboard({ ...credential, portal_id: profile.portal_id });
		} catch (error) {
			// A failure right after a scan used to show only as small text under the form,
			// which read as "the scan did nothing" (#625) — say it in a toast as well.
			loginError = error instanceof Error ? localized(error.message) : t.verifyFailed;
			toast.error(t.loginFailed(loginError));
		} finally {
			isLoggingIn = false;
		}
	}

	/**
	 * Sign in from a remembered device ("จดจำเครื่องนี้", #625), re-checking the token
	 * with the server — it may have been revoked or reissued since. The screen stays in
	 * its restoring state meanwhile. `false` when nothing valid is remembered.
	 */
	function enterRememberedDevice(): boolean {
		const remembered = readThisDevice();
		if (!remembered) return false;
		restoring = true;
		void resolveAndEnter(remembered, { remembered: true }).finally(() => {
			restoring = false;
			if (!session && mode !== 'entry') void goto(resolve('/volunteers/portal'));
		});
		return true;
	}

	/**
	 * Restore a short-lived session, the token handed over after a new booking, or a
	 * remembered device — in that order.
	 */
	onMount(() => {
		if (session) {
			restoring = false;
			if (mode === 'entry' && session.portal_id) void goto(resolve(portalPath(session.portal_id)));
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
			if (enterRememberedDevice()) return;
			restoring = false;
			if (mode !== 'entry') void goto(resolve('/volunteers/portal'));
			return;
		}
		try {
			const rawStored: unknown = JSON.parse(stored);
			const parsed = portalCredentialSchema.safeParse(rawStored);
			if (parsed.success && parsed.data.portal_id && !isStoredPortalSessionExpired(rawStored)) {
				if (mode !== 'entry' && portalId !== parsed.data.portal_id) {
					clearPortalSession();
					void goto(resolve('/volunteers/portal'));
					restoring = false;
					return;
				}
				session = parsed.data;
				if (mode === 'entry') void goto(resolve(portalPath(parsed.data.portal_id)));
			} else {
				// Covers a malformed record and an expired token session alike: both land the
				// volunteer back on the sign-in screen rather than a stale dashboard — unless the
				// device is remembered, which signs straight back in.
				clearPortalSession();
				if (enterRememberedDevice()) return;
				if (mode !== 'entry') void goto(resolve('/volunteers/portal'));
			}
		} catch {
			clearPortalSession();
			if (enterRememberedDevice()) return;
			if (mode !== 'entry') void goto(resolve('/volunteers/portal'));
		}
		restoring = false;
	});

	const scheduleQuery = useVolunteerSchedule(() => session);
	const ticketsQuery = useVolunteerTickets(() => session);
	// Per-shift ticket buttons (#973): token sessions only, a phone session never loads these.
	const applicationsQuery = useVolunteerApplications(() => session);
	const cancelTicket = useCancelTicketMutation();
	let pendingCancel = $state<{ activity: PortalActivity; applicationId: string } | null>(null);

	function ticketActionsFor(activity: PortalActivity) {
		return portalTicketActions(activity, applicationsQuery.data ?? []);
	}

	async function confirmCancelApplication() {
		const target = pendingCancel;
		const token = session?.token;
		if (!target || !token) return;
		try {
			await cancelTicket.mutateAsync({ token, applicationId: target.applicationId });
			toast.success('ยกเลิกกะนี้แล้ว');
			pendingCancel = null;
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'ยกเลิกไม่สำเร็จ');
		}
	}
	/**
	 * Only for the count on the "งานอาสาสมัครที่เปิดรับ" tab button. The board itself fetches
	 * with the same key, so this costs no extra request — and the badge counts jobs that
	 * can actually be applied to, not, as it once did, the volunteer's own tickets.
	 */
	const openingsQuery = useVolunteerJobs(
		() => ({}),
		() => session !== null
	);
	const openingsCount = $derived(
		(openingsQuery.data ?? []).filter((job) => isJobApplicable(job)).length
	);
	const profileQuery = useVolunteerProfile(() => session);
	const accessStatusQuery = useVolunteerAccessStatus(() => session);
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
				})}${t.clockSuffix}`;
	}

	function shiftDateFormatted(activity: PortalActivity): string {
		if (activity.startTs) {
			const start = parsePortalTimestamp(activity.startTs);
			if (!Number.isNaN(start.getTime())) {
				return start.toLocaleDateString('th-TH', {
					weekday: 'short',
					day: 'numeric',
					month: 'short',
					year: 'numeric',
					timeZone: PORTAL_TIME_ZONE
				});
			}
		}
		if (activity.date) {
			const d = new Date(activity.date + 'T00:00:00Z');
			if (!Number.isNaN(d.getTime())) {
				return d.toLocaleDateString('th-TH', {
					weekday: 'short',
					day: 'numeric',
					month: 'short',
					year: 'numeric',
					timeZone: 'UTC'
				});
			}
			return activity.date;
		}
		return 'ยังไม่ระบุวัน';
	}

	function shiftTimeFormatted(activity: PortalActivity): string {
		if (!activity.startTs) return '';
		const start = parsePortalTimestamp(activity.startTs);
		if (Number.isNaN(start.getTime())) return '';
		const opts = { hour: '2-digit', minute: '2-digit', timeZone: PORTAL_TIME_ZONE } as const;
		const from = start.toLocaleTimeString('th-TH', opts);
		const end = activity.endTs ? parsePortalTimestamp(activity.endTs) : null;
		const to =
			end && !Number.isNaN(end.getTime())
				? ` – ${end.toLocaleTimeString('th-TH', opts)} น.`
				: ' น.';
		return `${from}${to}`;
	}

	function timeRange(activity: PortalActivity): string {
		if (!activity.startTs) return activity.date || t.noDate;
		const start = parsePortalTimestamp(activity.startTs);
		if (Number.isNaN(start.getTime())) return activity.date || t.noDate;
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
		const activities = mergePortalActivities(shifts, tickets, langState.current);
		const first = activities[0];
		// A token session never holds the raw number — the API returns it masked, which
		// is also what may be shown on a screen held up at a gate (AC-VOL-03).
		const shownPhone = profile.phone_masked;
		return {
			id: profile.portal_id,
			volunteerCode: profile.volunteer_code,
			name: named || profile.nickname || t.defaultName,
			avatar: (named || profile.nickname || t.defaultAvatar).slice(0, 2),
			phone: shownPhone,
			shelterName: first?.location ?? '',
			shelterCode: first?.shelterCode ?? '',
			verified: profile.identity_verified,
			statusText: activities.some((s) => s.status === 'checked_in')
				? t.statusOnDuty
				: activities.length
					? t.statusReady
					: t.statusAwaiting,
			statusType: activities.some((s) => s.status === 'checked_in') ? 'active' : 'pending',
			roleType: profile.personnel_type || t.defaultRole,
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
	const scheduleStatusOptions = $derived(
		(
			[
				'all',
				'booking',
				'dispatched',
				'assigned',
				'standby',
				'checked_in',
				'completed',
				'no_show'
			] as const
		).map((value) => ({ value, label: t.filterOptions[value] }))
	);

	function setFilterStatus(value: string | undefined) {
		filterStatus = value && value !== 'all' ? value : '';
	}
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
		if (activity.status === 'booking') return t.activityStatus.booking;
		if (activity.dispatchStatus === 'dispatched') return t.activityStatus.dispatched;
		return (t.activityStatus as Record<string, string>)[activity.status] ?? activity.status;
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
			Boolean(session?.token) &&
			Boolean(activity.assignmentId) &&
			activity.dispatchStatus !== 'dispatched' &&
			['assigned', 'standby'].includes(activity.status) &&
			!ticketActionsFor(activity)
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
				action === 'check_in' ? t.checkedIn : action === 'check_out' ? t.checkedOut : t.withdrawn
			);
		} catch (error) {
			toast.error(error instanceof Error ? localized(error.message) : t.actionFailed);
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
	function closePassModal() {
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
	 * Normalised through `ticketTokenFromScan`, which only ever recognizes a
	 * `TKT-VOL-` tracking token now.
	 */
	function handleScanToken(scanned: string) {
		const token = ticketTokenFromScan(scanned);
		if (!token) {
			loginError = t.scanNotTicket;
			toast.error(loginError);
			return;
		}
		if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(100);
		inputToken = token;
		void submitToken(token);
	}
	let qrDataUrl = $state<string>('');
	let qrGeneration = 0;

	// The staff scanner checks this payload against `volunteer.tracking_token_hash`.
	// Token-login sessions already carry a raw token; phone-login sessions get a payload
	// from the volunteer document through the role-card endpoint above.
	const qrPayload = $derived(session?.token ?? roleCardPayload);
	const hasScannableToken = $derived(Boolean(qrPayload));
	$effect(() => {
		const payload = qrPayload;
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
			loginError = t.phoneRequired;
			return;
		}

		const parsed = ticketFindSchema.safeParse({ phone: trimmed });
		if (!parsed.success) {
			loginError = localized(parsed.error.issues[0]?.message ?? t.phoneInvalid);
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
			loginError = t.tokenRequired;
			return;
		}
		const token = normalizeTicketToken(value);
		if (!token) {
			loginError = t.tokenFormat;
			return;
		}
		await resolveAndEnter({ token }, { remember: rememberDevice });
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
			dispatchErrors[assignmentId] = localized(parsed.error.issues[0]?.message ?? t.codeRequired);
			return;
		}
		dispatchErrors[assignmentId] = '';
		answering = assignmentId;
		try {
			await respond.mutateAsync({ assignment_id: assignmentId, code: parsed.data, action });
			toast.success(action === 'accepted' ? t.offerAccepted : t.offerDeclined);
			dispatchCodes[assignmentId] = '';
		} catch (err) {
			const message = err instanceof Error ? localized(err.message) : t.respondFailed;
			dispatchErrors[assignmentId] = message;
			toast.error(message);
		} finally {
			answering = null;
		}
	}

	function handleLogout() {
		const wasRemembered = readThisDevice() !== null;
		forgetThisDevice();
		session = null;
		roleCardPayload = '';
		roleCardLookupKey = '';
		clearPortalSession();
		dispatchCodes = {};
		dispatchErrors = {};
		inputPhone = '';
		inputToken = '';
		loginError = '';
		queryClient.removeQueries({ queryKey: volunteerPortalKeys.all });
		toast.info(wasRemembered ? t.loggedOutForgotten : t.loggedOut);
		void goto(resolve('/volunteers/portal'));
	}

	function downloadRoleCardQr() {
		if (!qrDataUrl || !currentVolunteer) {
			toast.info(t.qrNotReady);
			return;
		}
		const link = document.createElement('a');
		link.href = qrDataUrl;
		link.download = `volunteer-role-card-${currentVolunteer.volunteerCode}.png`;
		link.click();
		toast.success(t.qrDownloaded);
	}

	$effect(() => {
		if (
			mode !== 'entry' &&
			session &&
			!restoring &&
			!profileQuery.isPending &&
			(profileQuery.isError || profileQuery.data === null)
		) {
			// The server no longer knows this credential (revoked / reissued token): a
			// remembered device must not keep trying it. A transient error keeps it.
			if (profileQuery.data === null) forgetThisDevice();
			session = null;
			clearPortalSession();
			void goto(resolve('/volunteers/portal'));
		}
	});
</script>

<div class="mx-auto w-full max-w-6xl space-y-8">
	<!-- TOP BRAND HEADER -->
	<header class="space-y-3 text-center">
		<h1 class="text-3xl font-extrabold tracking-tight text-foreground md:text-4xl">
			{currentVolunteer ? t.headingSchedule : t.headingSignIn}
		</h1>
		{#if !currentVolunteer}
			<p class="mx-auto max-w-xl text-sm font-medium text-muted-foreground">
				{t.signInIntro}
			</p>
		{/if}
	</header>

	{#if mode !== 'entry' && session && (restoring || !currentVolunteer)}
		<div
			class="mx-auto max-w-2xl rounded-3xl border border-border bg-card p-10 text-center shadow-sm"
		>
			<p class="text-sm font-bold text-foreground">{t.restoringTitle}</p>
			<p class="mt-2 text-xs text-muted-foreground">{t.restoringBody}</p>
		</div>
	{:else if !currentVolunteer}
		<!-- ── NOT SIGNED IN VIEW ───────────────────────────────────────────── -->
		<div class="mx-auto max-w-2xl space-y-6">
			<!-- MAIN LOGIN CARD -->
			<div class="rounded-3xl border border-border bg-card p-6 shadow-sm md:p-8">
				<!-- TAB SWITCHER -->
				<div class="mb-6 flex flex-col gap-1.5 rounded-2xl bg-muted/40 p-1.5 sm:flex-row">
					<button
						type="button"
						onclick={() => (loginTab = 'phone')}
						class="flex min-h-11 w-full min-w-0 flex-1 items-center justify-center gap-2 rounded-xl px-3 py-3 text-center text-xs leading-snug font-bold transition-all sm:w-auto sm:px-4 md:text-sm {loginTab ===
						'phone'
							? 'bg-primary text-primary-foreground shadow-md'
							: 'text-muted-foreground hover:text-foreground'}"
					>
						<Phone class="size-4" />
						<span>{t.tabPhone}</span>
					</button>

					<button
						type="button"
						onclick={() => (loginTab = 'qr')}
						class="flex min-h-11 w-full min-w-0 flex-1 items-center justify-center gap-2 rounded-xl px-3 py-3 text-center text-xs leading-snug font-bold transition-all sm:w-auto sm:px-4 md:text-sm {loginTab ===
						'qr'
							? 'bg-primary text-primary-foreground shadow-md'
							: 'text-muted-foreground hover:text-foreground'}"
					>
						<QrCode class="size-4" />
						<span>{t.tabQr}</span>
					</button>
				</div>

				{#if loginTab === 'phone'}
					<!-- TAB 1: PHONE LOGIN -->
					<form onsubmit={handlePhoneLogin} class="space-y-4">
						<div class="space-y-1.5">
							<label for="volunteer-phone-input" class="text-xs font-bold text-foreground">
								{t.phoneLabel} <span class="text-destructive">*</span>
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
									placeholder={t.phonePlaceholder}
									class="w-full rounded-xl border border-border bg-muted/20 py-3.5 pr-4 pl-10 text-xs font-medium text-foreground outline-hidden transition-all focus:border-primary focus:bg-card focus:ring-1 focus:ring-primary md:text-sm"
								/>
							</div>
							<p class="text-2xs text-muted-foreground">
								{t.phoneHint}
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
							<span>{isLoggingIn ? t.submitChecking : t.submitNow}</span>
						</button>
					</form>
				{:else}
					<!-- TAB 2: QR & TOKEN LOGIN -->
					<div class="space-y-6">
						<!-- Before the scanner: a scan signs in at once, so this must be ticked first. -->
						<div class="flex items-start gap-3 rounded-xl border border-border bg-muted/20 p-3">
							<Checkbox
								id="volunteer-remember-device"
								bind:checked={rememberDevice}
								class="mt-0.5"
							/>
							<div class="space-y-0.5">
								<Label
									for="volunteer-remember-device"
									class="text-sm font-semibold text-foreground"
								>
									{t.rememberTitle}
								</Label>
								<p class="text-xs text-muted-foreground">
									{t.rememberBody}
								</p>
							</div>
						</div>

						<form onsubmit={handleTokenLogin} class="space-y-2">
							<label for="volunteer-token-input" class="text-xs font-bold text-foreground">
								{t.tokenLabel}
							</label>
							<!-- Stacked on a phone: side by side, the button overflowed the card at 390px. -->
							<div class="flex flex-col gap-2 sm:flex-row">
								<input
									id="volunteer-token-input"
									type="text"
									bind:value={inputToken}
									placeholder={t.tokenPlaceholder}
									class="min-h-11 min-w-0 flex-1 rounded-xl border border-border bg-muted/20 px-3.5 py-3 text-xs font-medium text-foreground outline-hidden transition-all focus:border-primary focus:bg-card focus:ring-1 focus:ring-primary md:text-sm"
								/>
								<button
									type="submit"
									disabled={isLoggingIn}
									class="flex min-h-11 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-primary px-5 py-3 text-xs font-bold whitespace-nowrap text-primary-foreground shadow-sm hover:opacity-95 disabled:cursor-wait disabled:opacity-60"
								>
									<Rocket class="size-3.5" />
									<span>{t.tokenSubmit}</span>
								</button>
							</div>
						</form>

						<div class="relative flex items-center justify-center">
							<div class="w-full border-t border-border"></div>
							<span class="absolute bg-card px-3 text-2xs font-bold text-muted-foreground"
								>{t.or}</span
							>
						</div>

						<!-- QR SCANNER SECTION -->
						<div class="space-y-4 text-center">
							<p class="text-xs font-bold text-foreground">{t.scanTitle}</p>
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

		<!-- QR ROLE CARD — first thing on the page on a phone and on desktop (#1045): staff scan it
		     at check-in and at the distribution point, so it must not sit under the shift list.
		     Stacked and centred on a phone; QR left of the details from `sm`. -->
		<div class="rounded-3xl border border-border bg-card p-4 shadow-sm sm:p-6">
			<div class="flex flex-col items-center gap-4 sm:flex-row sm:items-start sm:gap-6">
				<div class="shrink-0 text-center">
					{#if qrDataUrl}
						<img
							src={qrDataUrl}
							alt={t.qrAlt(currentVolunteer.volunteerCode)}
							class="mx-auto size-44 rounded-xl border border-border bg-white p-2 shadow-xs sm:size-40"
						/>
					{:else if roleCardLoading}
						<div
							class="mx-auto flex size-44 items-center justify-center rounded-xl border border-border bg-white text-muted-foreground sm:size-40"
						>
							<QrCode class="size-20 animate-pulse" />
						</div>
					{:else if !hasScannableToken}
						<div
							class="mx-auto flex size-44 flex-col items-center justify-center gap-1.5 rounded-xl border border-border bg-white p-3 text-center text-muted-foreground sm:size-40"
						>
							<QrCode class="size-10" />
							<p class="text-2xs leading-tight">{t.noQrShort}</p>
						</div>
					{/if}
				</div>

				<div class="flex w-full min-w-0 flex-1 flex-col gap-3 text-center sm:text-left">
					<div>
						<h4 class="text-sm font-bold text-foreground">{t.roleCardTitle}</h4>
						<p class="mt-1 text-base font-black text-foreground">{currentVolunteer.name}</p>
						<p class="text-xs font-semibold text-muted-foreground">
							{t.volunteerCode(currentVolunteer.volunteerCode)}
						</p>
					</div>
					<div class="flex flex-wrap justify-center gap-1 sm:justify-start">
						<span
							class="rounded px-1.5 py-0.5 text-2xs font-bold {currentVolunteer.verified
								? 'bg-emerald-50 text-emerald-700'
								: 'bg-amber-50 text-amber-800'}"
						>
							{currentVolunteer.verified ? t.verifiedBadge : t.unverifiedBadge}
						</span>
						<span
							class="rounded px-1.5 py-0.5 text-2xs font-bold {currentVolunteer.statusType ===
							'active'
								? 'bg-emerald-50 text-emerald-700'
								: 'bg-muted text-muted-foreground'}"
						>
							{currentVolunteer.statusType === 'active' ? t.onDutyBadge : t.offDutyBadge}
						</span>
					</div>
					<p class="text-2xs text-muted-foreground">
						{t.benefitsNote}
					</p>
					{#if !hasScannableToken}
						<p class="text-2xs text-muted-foreground">
							{t.needTokenForQr}
						</p>
					{/if}
					<div class="flex flex-wrap justify-center gap-2 sm:justify-start">
						<Button
							type="button"
							variant="outline"
							size="sm"
							class="min-h-11 grow gap-1.5 px-3 text-xs whitespace-nowrap sm:grow-0"
							onclick={downloadRoleCardQr}
							disabled={!qrDataUrl}
						>
							<Download class="size-4" />
							{t.downloadQr}
						</Button>
						<Button
							type="button"
							variant="outline"
							size="sm"
							class="min-h-11 grow gap-1.5 px-3 text-xs whitespace-nowrap sm:grow-0"
							onclick={() => (isPassModalOpen = true)}
						>
							<Maximize2 class="size-4" />
							{t.expandCard}
						</Button>
					</div>
				</div>
			</div>
		</div>

		<!-- TOP PROFILE HEADER CARD — stacked on a phone (actions as a full-width row), side
		     by side from `sm` with the actions top-right; it used to stay stacked up to `lg`,
		     leaving the actions stranded under a half-empty card on a tablet. -->
		<div
			class="flex flex-col gap-4 rounded-3xl border border-border bg-card p-4 shadow-sm sm:flex-row sm:items-start sm:justify-between sm:gap-6 sm:p-6"
		>
			<!-- Left: Avatar + Details — one centred column on a phone (a large avatar above
			     the details), side by side, left-aligned and more compact from `sm`. -->
			<div
				class="flex min-w-0 flex-col items-center gap-3 text-center sm:flex-row sm:items-start sm:gap-4 sm:text-left"
			>
				<div
					class="flex size-20 shrink-0 items-center justify-center rounded-3xl bg-primary text-3xl font-black text-primary-foreground shadow-md sm:size-14 sm:rounded-2xl sm:text-xl"
				>
					{currentVolunteer.avatar}
				</div>
				<div class="min-w-0 space-y-2 sm:space-y-1.5">
					<div class="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
						<h2 class="w-full text-2xl font-black text-foreground sm:w-auto sm:text-lg md:text-xl">
							{currentVolunteer.name}
						</h2>
						<span
							class="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-bold sm:text-2xs {currentVolunteer.verified
								? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
								: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300'}"
						>
							<CircleCheck class="size-3.5 sm:size-3" />
							{currentVolunteer.verified ? t.verified : t.unverified}
						</span>
						<span
							class="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-bold sm:text-2xs {currentVolunteer.statusType ===
							'active'
								? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
								: 'border-border bg-muted text-muted-foreground'}"
						>
							{currentVolunteer.statusText}
						</span>
					</div>

					<p
						class="flex flex-wrap items-start justify-center gap-x-3 gap-y-1 text-sm text-muted-foreground sm:justify-start sm:text-xs"
					>
						<!-- Icon inline with the text: it stays beside the first word whether the line is
						     centred (phone) or left-aligned, and a long shelter name wraps under it. -->
						<span class="min-w-0">
							<MapPin
								class="mr-1 inline size-4 -translate-y-px align-middle text-primary sm:size-3.5"
							/>{t.affiliation}
							{currentVolunteer.shelterName}
						</span>
						<span class="whitespace-nowrap">📞 {currentVolunteer.phone}</span>
					</p>

					<div class="pt-1">
						<span
							class="inline-flex items-center gap-1 rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-0.5 text-xs font-bold text-sky-800 sm:text-2xs dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-300"
						>
							{currentVolunteer.roleType}
						</span>
					</div>
				</div>
			</div>

			<!-- Right: Actions -->
			<div class="flex w-full shrink-0 items-center gap-2 sm:w-auto">
				<button
					type="button"
					onclick={() => (profileDialogOpen = true)}
					class="min-h-11 flex-1 rounded-xl border border-border bg-card px-4 py-2 text-sm font-bold whitespace-nowrap text-foreground shadow-xs transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none sm:flex-none"
				>
					{t.editProfile}
				</button>

				<button
					type="button"
					onclick={handleLogout}
					title={t.logoutTitle}
					aria-label={t.logoutTitle}
					class="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-border bg-card text-muted-foreground shadow-xs transition-colors hover:border-destructive hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none"
				>
					<LogOut class="size-4" />
				</button>
			</div>
		</div>

		<!-- PRIMARY TABS -->
		<!-- Two equal halves on a phone; at 320px the second tab used to run off-screen. -->
		<div class="flex border-b border-border">
			<div
				class="grid w-full grid-cols-2 gap-1 rounded-t-2xl border-x border-t border-border/60 bg-muted/20 p-1 sm:inline-flex sm:w-auto"
			>
				<button
					type="button"
					onclick={() => void goto(resolve(portalPath(currentVolunteer.id, 'dashboard')))}
					class="flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-xs font-bold whitespace-nowrap transition-all sm:gap-2 sm:px-5 {dashboardTab ===
					'schedule'
						? 'bg-card text-foreground shadow-sm'
						: 'text-muted-foreground hover:text-foreground'}"
				>
					<ClipboardList class="size-4" />
					<span>{t.tabSchedule}</span>
					<span
						class="rounded-full bg-primary/10 px-2 py-0.5 text-3xs font-black text-primary dark:bg-primary/30"
					>
						{currentVolunteer.scheduleCount}
					</span>
				</button>

				<button
					type="button"
					onclick={() => void goto(resolve(portalPath(currentVolunteer.id, 'openings')))}
					class="flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-xs font-bold whitespace-nowrap transition-all sm:gap-2 sm:px-5 {dashboardTab ===
					'openings'
						? 'bg-card text-foreground shadow-sm'
						: 'text-muted-foreground hover:text-foreground'}"
				>
					<Rocket class="size-4" />
					<span
						>{t.tabOpenings}{#if t.tabOpeningsSuffix}<span class="ml-1 hidden sm:inline"
								>{t.tabOpeningsSuffix}</span
							>{/if}</span
					>
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
							<h3 class="text-sm font-bold text-foreground md:text-base">
								{t.listTitle}
							</h3>
							<p class="mt-1 text-2xs text-muted-foreground">{t.listHint}</p>
						</div>
						<span class="rounded-full bg-primary/10 px-2.5 py-1 text-2xs font-bold text-primary">
							{t.itemCount(visibleActivities.length)}
						</span>
					</div>

					<div class="rounded-2xl border border-border bg-card p-4 shadow-sm">
						<div class="mb-3 flex items-center gap-2 text-xs font-bold text-foreground">
							<Filter class="size-4 text-primary" />
							{t.filterTitle}
						</div>
						<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
							<label class="space-y-1 text-2xs font-semibold text-muted-foreground">
								<span>{t.fromDate}</span>
								<DatePicker
									id="portal-filter-from-date"
									bind:value={filterFromDate}
									placeholder={t.fromDatePlaceholder}
								/>
							</label>
							<label class="space-y-1 text-2xs font-semibold text-muted-foreground">
								<span>{t.toDate}</span>
								<DatePicker
									id="portal-filter-to-date"
									bind:value={filterToDate}
									placeholder={t.toDatePlaceholder}
								/>
							</label>
							<label class="space-y-1 text-2xs font-semibold text-muted-foreground">
								<span>{t.fromTime}</span>
								<TimePicker
									id="portal-filter-from-time"
									bind:value={filterFromTime}
									placeholder={t.fromTimePlaceholder}
								/>
							</label>
							<label class="space-y-1 text-2xs font-semibold text-muted-foreground">
								<span>{t.toTime}</span>
								<TimePicker
									id="portal-filter-to-time"
									bind:value={filterToTime}
									placeholder={t.toTimePlaceholder}
								/>
							</label>
							<label class="space-y-1 text-2xs font-semibold text-muted-foreground">
								<span>{t.statusFilter}</span>
								<Select.Root
									type="single"
									value={filterStatus || 'all'}
									onValueChange={setFilterStatus}
								>
									<Select.Trigger
										class="!h-11 w-full min-w-0 rounded-lg bg-background text-xs !font-normal"
									>
										<span class="truncate">
											{scheduleStatusOptions.find(
												(option) => option.value === (filterStatus || 'all')
											)?.label ?? t.filterOptions.all}
										</span>
									</Select.Trigger>
									<Select.Content>
										{#each scheduleStatusOptions as option (option.value)}
											<Select.Item value={option.value} label={option.label} />
										{/each}
									</Select.Content>
								</Select.Root>
							</label>
							<label class="space-y-1 text-2xs font-semibold text-muted-foreground">
								<span>{t.jobName}</span>
								<Input
									type="search"
									bind:value={filterJobTitle}
									placeholder={t.jobSearchPlaceholder}
									aria-label={t.jobSearchAria}
									class="h-9 w-full rounded-lg bg-background text-xs font-normal placeholder:font-normal"
								/>
							</label>
						</div>
						{#if filterFromDate || filterToDate || filterFromTime || filterToTime || filterStatus || filterJobTitle}
							<button
								type="button"
								onclick={clearScheduleFilters}
								class="mt-3 text-2xs font-bold text-primary hover:underline"
							>
								{t.clearFilters}
							</button>
						{/if}
					</div>

					{#if currentVolunteer.activities.length === 0}
						<div
							class="rounded-3xl border border-dashed border-border bg-card p-10 text-center text-muted-foreground"
						>
							<ClipboardList class="mx-auto mb-3 size-10 text-muted-foreground/60" />
							<p class="text-sm font-bold text-foreground">{t.emptyTitle}</p>
							<p class="mt-1 text-xs">{t.emptyBody}</p>
							<button
								type="button"
								onclick={() => void goto(resolve(portalPath(currentVolunteer.id, 'openings')))}
								class="mt-4 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-white shadow-sm hover:opacity-95"
							>
								{t.viewOpenings}
							</button>
						</div>
					{:else if visibleActivities.length === 0}
						<div
							class="rounded-3xl border border-dashed border-border bg-card p-10 text-center text-muted-foreground"
						>
							<Filter class="mx-auto mb-3 size-10 text-muted-foreground/60" />
							<p class="text-sm font-bold text-foreground">{t.noMatchTitle}</p>
							<p class="mt-1 text-xs">{t.noMatchBody}</p>
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
											{#if !activity.assignmentId}
												<span
													class="rounded-md bg-sky-50 px-2 py-0.5 text-2xs font-bold text-sky-700 dark:bg-sky-950/60 dark:text-sky-300"
												>
													{activity.shiftPeriod || t.defaultShift}
												</span>
											{/if}
											<span
												class="rounded-md px-2 py-0.5 text-2xs font-bold {activityStatusClass(
													activity
												)}"
											>
												{activityStatusLabel(activity)}
											</span>
										</div>

										<h4 class="text-base font-bold text-foreground sm:text-lg">{activity.title}</h4>
										{#if activity.description}
											<p class="text-xs leading-relaxed text-muted-foreground">
												{activity.description}
											</p>
										{/if}

										<!-- Highlighted Date & Time Box -->
										<div class="mt-2.5 flex flex-wrap items-center gap-2">
											<div
												class="inline-flex items-center gap-1.5 rounded-xl border border-blue-200/90 bg-blue-50/80 px-3 py-1.5 text-xs font-semibold text-[#0A2647] shadow-2xs sm:text-sm"
											>
												<Calendar class="size-4 text-[#0A2647]" />
												<span class="font-bold">{shiftDateFormatted(activity)}</span>
												{#if shiftTimeFormatted(activity)}
													<span class="text-blue-300">•</span>
													<Clock class="size-4 text-[#0A2647]" />
													<span class="font-bold text-slate-900 tabular-nums"
														>{shiftTimeFormatted(activity)}</span
													>
												{/if}
											</div>

											<div
												class="inline-flex items-center gap-1.5 rounded-xl border border-slate-200/80 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700"
											>
												<MapPin class="size-3.5 text-primary" />
												<span>{activity.location}</span>
											</div>
										</div>

										<!-- Checkin info -->
										<div
											class="flex flex-wrap items-center gap-3 pt-1 text-2xs text-muted-foreground"
										>
											{#if activity.checkinAt}
												<span class="flex items-center gap-1 font-medium text-emerald-700">
													<Clock class="size-3" />
													{t.checkInAt}
													{clockText(activity.checkinAt)}
												</span>
											{/if}
											{#if activity.checkoutAt}
												<span class="flex items-center gap-1 font-medium text-muted-foreground">
													<Clock class="size-3" />
													{t.checkOutAt}
													{clockText(activity.checkoutAt)}
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
													{t.offerText}
												</p>
												<input
													type="text"
													bind:value={dispatchCodes[activity.assignmentId]}
													placeholder={t.offerPlaceholder}
													aria-label={t.offerAria}
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
														{t.accept}
													</button>
													<button
														type="button"
														disabled={answering === activity.assignmentId}
														onclick={() => answerDispatch(activity, 'declined')}
														class="flex flex-1 cursor-pointer items-center justify-center gap-1 rounded-lg border border-border px-3 py-2 text-2xs font-bold text-muted-foreground transition-colors hover:border-destructive hover:text-destructive disabled:opacity-60"
													>
														<X class="size-3.5" />
														{t.decline}
													</button>
												</div>
											</div>
										{/if}
									</div>
									{#if ticketActionsFor(activity) || canCheckIn(activity) || canCheckOut(activity) || canWithdraw(activity)}
										{@const actions = ticketActionsFor(activity)}
										<div class="flex w-full flex-col gap-2 md:w-56">
											{#if actions}
												<a
													href={resolve(
														`/volunteer/ticket/${encodeURIComponent(session?.token ?? '')}?application=${encodeURIComponent(actions.applicationId)}`
													)}
													data-testid="open-ticket"
													class="flex items-center justify-center gap-2 rounded-xl border border-primary/30 px-4 py-2.5 text-xs font-bold text-primary hover:bg-primary/5"
												>
													<Ticket class="size-4" /> เปิดตั๋ว
												</a>
												{#if actions.canCancel}
													<button
														type="button"
														data-testid="cancel-application"
														onclick={() =>
															(pendingCancel = { activity, applicationId: actions.applicationId })}
														class="rounded-xl border border-destructive/30 px-4 py-2.5 text-xs font-bold text-destructive hover:bg-destructive/5"
													>
														ยกเลิก
													</button>
												{/if}
											{/if}
											{#if canCheckIn(activity)}
												<button
													type="button"
													disabled={actingAssignment !== null}
													onclick={() => runScheduleAction(activity, 'check_in')}
													class="flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60"
												>
													<LogIn class="size-4" />
													{t.checkInButton}
												</button>
											{/if}
											{#if canCheckOut(activity)}
												<button
													type="button"
													disabled={actingAssignment !== null}
													onclick={() => runScheduleAction(activity, 'check_out')}
													class="flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-bold text-white shadow-sm hover:opacity-95 disabled:opacity-60"
												>
													<LogOut class="size-4" />
													{t.checkOutButton}
												</button>
											{/if}
											{#if canWithdraw(activity)}
												<button
													type="button"
													disabled={actingAssignment !== null}
													onclick={() => openWithdrawModal(activity)}
													class="rounded-xl border border-destructive/30 px-4 py-2.5 text-xs font-bold text-destructive hover:bg-destructive/5 disabled:opacity-60"
												>
													{t.withdrawButton}
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
					<!-- WIDGET 0: สิทธิ์ใช้งานระบบ (CR-221 FR-26) -->
					<AccessStatusCard
						rows={accessStatusQuery.data ?? []}
						loading={accessStatusQuery.isPending}
						error={accessStatusQuery.isError}
					/>

					<!-- WIDGET 1: กติกาการเข้ากะ -->
					<div class="rounded-3xl border border-border bg-card p-6 shadow-sm">
						<h4 class="flex items-center gap-2 text-sm font-bold text-foreground">
							<span>📢</span>
							{t.rulesTitle}
						</h4>
						<ul class="mt-3.5 space-y-2.5 text-xs leading-relaxed text-muted-foreground">
							<li class="flex items-start gap-2">
								<span class="text-primary">•</span>
								<span>{t.rule1}</span>
							</li>
							<li class="flex items-start gap-2">
								<span class="text-primary">•</span>
								<span>{t.rule2}</span>
							</li>
							<li class="flex items-start gap-2">
								<span class="text-primary">•</span>
								<span>{t.rule3}</span>
							</li>
							<li class="flex items-start gap-2">
								<span class="text-primary">•</span>
								<span>{t.rule4}</span>
							</li>
						</ul>
					</div>

					<Dialog.Root
						open={pendingCancel !== null}
						onOpenChange={(open) => !open && !cancelTicket.isPending && (pendingCancel = null)}
					>
						<Dialog.Content class="sm:max-w-md">
							<Dialog.Header>
								<Dialog.Title class="flex items-center gap-2">
									<CircleAlert class="size-5 text-destructive" />
									ยืนยันการยกเลิกกะ
								</Dialog.Title>
								<Dialog.Description>
									ใบสมัครของกะนี้จะถูกยกเลิก และที่นั่งที่จองไว้จะคืนให้คนอื่น
									กะอื่นของคุณไม่เปลี่ยน
								</Dialog.Description>
							</Dialog.Header>
							{#if pendingCancel}
								<div class="rounded-2xl border border-border bg-muted/30 p-4">
									<p class="text-sm font-bold text-foreground">{pendingCancel.activity.title}</p>
									<p class="mt-1 text-xs text-muted-foreground">
										{timeRange(pendingCancel.activity)}
									</p>
								</div>
							{/if}
							<Dialog.Footer class="gap-2">
								<Button
									variant="outline"
									onclick={() => (pendingCancel = null)}
									disabled={cancelTicket.isPending}
								>
									กลับไป
								</Button>
								<Button
									variant="destructive"
									data-testid="confirm-cancel-application"
									onclick={confirmCancelApplication}
									disabled={cancelTicket.isPending}
								>
									ยืนยันยกเลิก
								</Button>
							</Dialog.Footer>
						</Dialog.Content>
					</Dialog.Root>

					<Dialog.Root
						open={withdrawModalOpen}
						onOpenChange={(open) => !open && closeWithdrawModal()}
					>
						<Dialog.Content class="sm:max-w-md">
							<Dialog.Header>
								<Dialog.Title class="flex items-center gap-2">
									<CircleAlert class="size-5 text-destructive" />
									{t.withdrawTitle}
								</Dialog.Title>
								<Dialog.Description>
									{t.withdrawBody}
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
									{t.withdrawBack}
								</Button>
								<Button
									variant="destructive"
									onclick={confirmWithdrawal}
									disabled={actingAssignment !== null || pendingWithdrawal === null}
								>
									{t.withdrawConfirm}
								</Button>
							</Dialog.Footer>
						</Dialog.Content>
					</Dialog.Root>
				</div>
			</div>
		{:else}
			<!-- ── TAB 2: JOB OPENINGS (งานจิตอาสา) ─────────────────────── -->
			<!--
				The same public board `/volunteers/jobs` renders, mounted here so a signed-in
				volunteer can pick up another shift without leaving the portal. It carries its
				own search, filters and no-auth application form, and TanStack dedupes the
				fetch with the `openingsQuery` above rather than asking twice.
			-->
			<JobBoard
				applicantProfile={profileQuery.data}
				applicantCredential={session}
				existingActivities={currentVolunteer?.activities ?? []}
			/>
		{/if}
	{/if}
</div>

<!-- ── MODAL: DIGITAL PASS VIEW ───────────────────────────────────────────── -->
{#if isPassModalOpen && currentVolunteer}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
		<div
			class="w-full max-w-sm rounded-3xl border border-border bg-card px-4 py-2 text-center shadow-2xl"
		>
			<div class="flex justify-end">
				<button
					type="button"
					onclick={closePassModal}
					aria-label={t.passCloseAria}
					class="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none"
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
						alt={t.passQrAlt}
						class="mx-auto size-48 rounded-2xl border-2 border-primary/20 bg-white p-2 shadow-md"
					/>
				{:else if roleCardLoading}
					<div
						class="mx-auto flex size-48 items-center justify-center rounded-2xl border-2 border-dashed border-border bg-muted/20 text-muted-foreground"
					>
						<QrCode class="size-10 animate-pulse" />
					</div>
				{:else if !hasScannableToken}
					<div
						class="mx-auto flex size-48 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border bg-muted/20 p-4 text-center text-muted-foreground"
					>
						<QrCode class="size-10" />
						<p class="text-xs leading-snug">
							{t.noQrLong}
						</p>
					</div>
				{/if}

				<div class="flex justify-center gap-1.5 pt-1">
					<span
						class="rounded-md px-2 py-0.5 text-2xs font-bold {currentVolunteer.verified
							? 'bg-emerald-50 text-emerald-700'
							: 'bg-amber-50 text-amber-800'}"
					>
						{currentVolunteer.verified ? t.verifiedBadge : t.unverifiedBadge}
					</span>
					<span
						class="rounded-md px-2 py-0.5 text-2xs font-bold {currentVolunteer.statusType ===
						'active'
							? 'bg-emerald-50 text-emerald-700'
							: 'bg-muted text-muted-foreground'}"
					>
						{currentVolunteer.statusType === 'active' ? t.onDutyBadge : t.offDutyBadge}
					</span>
				</div>

				<p class="text-2xs text-muted-foreground">
					{t.passShowToStaff}
				</p>

				<button
					type="button"
					onclick={closePassModal}
					class="mt-2 w-full rounded-xl bg-primary py-3 text-xs font-bold text-white shadow hover:opacity-95"
				>
					{t.passClose}
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
