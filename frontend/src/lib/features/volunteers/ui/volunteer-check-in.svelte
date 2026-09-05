<script lang="ts">
	/**
	 * "จุดเช็คอินอาสาสมัครหน้างาน (On-Site Check-In)" — `/onsite/volunteer-check-in`.
	 *
	 * The real build of the screen `roster-scan-bar.svelte` deliberately stubs
	 * out (owner instruction 2026-08-29 scoped camera/hardware scanning out of
	 * the roster tab itself; see that file's header comment). The roster tab's
	 * "เปิดหน้าจอเช็คอินหน้างาน" button links out to this screen instead.
	 * Mirrors `people/ui/scan-check-in-out-page.svelte`'s camera +
	 * manual-code pattern (html5-qrcode), adapted to volunteers. This file is
	 * the orchestrator (state, queries, mutations, matching/duty-window logic)
	 * — the scan input, search box, result panel and recent feed are each
	 * their own `volunteer-*.svelte` component, composed here.
	 *
	 *   - A scanned/typed code is normalized by `extractScanCode` (../domain/scan-code.ts)
	 *     before matching, since the one QR volunteers actually carry — the public
	 *     digital pass (`volunteer-portal/ui/digital-pass.svelte`) — encodes a full
	 *     ticket URL (`.../volunteer/ticket/TKT-VOL-xxx`), not a bare code; this
	 *     strips it down to the trailing path segment first. The normalized code
	 *     is first tried against the already-loaded `useVolunteers()` list (same
	 *     "fetch once, filter client-side" convention
	 *     `people-tab.svelte`/`roster-attendance-tab.svelte` use for this
	 *     feature) — by `_id`, `volunteer_code` (the "V-xxx" badge every profile
	 *     carries), or an exact full 10-digit phone match (not last-4, so two
	 *     volunteers sharing a last-4 never collide on a scan/type match — the
	 *     "ค้นหาด่วน" fallback still lists every partial name/phone match).
	 *     `volunteer` itself never carries a matchable plaintext ticket token
	 *     (schema.md §2.8 has no such field; `tracking_token`/`tracking_token_hash`
	 *     live on `job_application`, §2.18, generated + hashed once at apply time
	 *     and never copied back) — a digital-pass scan that misses the local list
	 *     falls through to `findJobApplicationByToken`, which hashes the code and
	 *     queries `job_application` by `tracking_token_hash` (or legacy plaintext
	 *     `tracking_token`), then resolves the volunteer via its `volunteer_id`.
	 *   - The matched volunteer's TODAY `shift_assignment` (from
	 *     `useTodayAttendance()`) drives check-in/out, reusing `roster-row.svelte`'s
	 *     identity-verification gate verbatim (FR-VOL-11 "ต้องตรวจบัตร ปชช.
	 *     ก่อนเข้ากะ") so the two screens never disagree on when a fresh
	 *     check-in is allowed.
	 *   - "Early" is a NEW, on-site-check-in-only advisory (not a write-access gate —
	 *     that's `duty-window.ts`'s Time-Bound Write Access, a different
	 *     concern): scanning before `duty_window.start_ts - DEFAULT_GRACE_MINUTES`
	 *     still checks in via the same `useCheckIn` `method: 'qr'` call, just
	 *     with a distinct warning + button label so staff consciously confirm
	 *     an early arrival instead of it looking like a normal on-time scan.
	 */
	import { toast } from 'svelte-sonner';
	import { useQueryClient } from '@tanstack/svelte-query';
	import { resolve } from '$app/paths';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ScanLine from '@lucide/svelte/icons/scan-line';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import WalkInRegistrationDialog from './walk-in-registration-dialog.svelte';
	import VolunteerScannerCard from './volunteer-scanner-card.svelte';
	import VolunteerSearchFallback from './volunteer-search-fallback.svelte';
	import VolunteerResultCard from './volunteer-result-card.svelte';
	import VolunteerRecentFeed, { type FeedEvent } from './volunteer-recent-feed.svelte';
	import {
		useCheckIn,
		useCheckOut,
		useHubMetrics,
		useTodayAttendance,
		useVolunteers,
		useJobs,
		findJobApplicationByToken
	} from '../application/queries';
	import { DEFAULT_GRACE_MINUTES } from '../domain/duty-window';
	import { extractScanCode } from '../domain/scan-code';
	import type { Volunteer } from '../domain/volunteer.schema';
	import type { ShiftAssignment } from '../domain/shift-assignment.schema';

	const queryClient = useQueryClient();
	const checkIn = useCheckIn(queryClient);
	const checkOut = useCheckOut(queryClient);
	const hubMetrics = useHubMetrics();
	const attendanceQuery = useTodayAttendance();
	const volunteersQuery = useVolunteers();
	const jobsQuery = useJobs();

	const volunteers = $derived(volunteersQuery.data ?? []);
	const todayAssignments = $derived(attendanceQuery.data ?? []);
	const volunteersById = $derived.by(() => new Map(volunteers.map((v) => [v._id, v])));
	const jobsById = $derived.by(() => new Map(jobsQuery.data?.map((j) => [j._id, j]) ?? []));

	// Live clock, refreshed every 30s — enough to keep the "early by Xh Ym" copy
	// current without re-rendering the whole screen every second.
	let nowMs = $state(Date.now());
	$effect(() => {
		const timer = setInterval(() => {
			nowMs = Date.now();
		}, 30_000);
		return () => clearInterval(timer);
	});

	let isProcessing = $state(false);
	let matchedVolunteer = $state<Volunteer | null>(null);
	let notFoundCode = $state<string | null>(null);
	let showWalkIn = $state(false);

	function fullName(v: Volunteer): string {
		return `${v.first_name} ${v.last_name}`.trim();
	}

	function findVolunteerByCode(clean: string): Volunteer | undefined {
		if (!clean) return undefined;
		const idLookup = clean.startsWith('volunteer:') ? clean : `volunteer:${clean}`;
		const lower = clean.toLowerCase();
		return (
			volunteers.find((v) => v._id === idLookup) ??
			volunteers.find((v) => v.volunteer_code.toLowerCase() === lower) ??
			(/^\d{10}$/.test(clean)
				? volunteers.find((v) => (v.phone ?? '').replace(/\D/g, '') === clean)
				: undefined)
		);
	}

	function selectVolunteer(v: Volunteer) {
		matchedVolunteer = v;
		notFoundCode = null;
	}

	function reportNotFound(code: string) {
		matchedVolunteer = null;
		notFoundCode = code;
		toast.error(`ไม่พบรหัส "${code}" — โปรดตรวจสอบอีกครั้งหรือค้นหาด้วยชื่อ/เบอร์โทร`);
	}

	async function handleScanSubmit(code: string) {
		isProcessing = true;
		try {
			const clean = extractScanCode(code);
			if (!clean) {
				reportNotFound(code);
				return;
			}

			const localMatch = findVolunteerByCode(clean);
			if (localMatch) {
				selectVolunteer(localMatch);
				toast.success(`พบข้อมูล ${fullName(localMatch)}`);
				return;
			}

			// Not a volunteer_code/_id/phone match — the scan may be a public
			// digital-pass ticket QR. Its token only exists on `job_application`
			// (tracking_token/tracking_token_hash), never as a matchable plaintext
			// field on `volunteer` itself, so resolve it via the application's
			// volunteer_id before giving up.
			const application = await findJobApplicationByToken(clean).catch(() => null);
			const viaTicket = application?.volunteer_id
				? volunteersById.get(application.volunteer_id)
				: undefined;

			if (!viaTicket) {
				reportNotFound(code);
				return;
			}
			selectVolunteer(viaTicket);
			toast.success(`พบข้อมูล ${fullName(viaTicket)}`);
		} finally {
			isProcessing = false;
		}
	}

	function clearScreen() {
		matchedVolunteer = null;
		notFoundCode = null;
	}

	// ---------------------------------------------------------------------------
	// Today's assignment resolution + early-check-in advisory
	// ---------------------------------------------------------------------------

	const currentAssignment = $derived.by<ShiftAssignment | undefined>(() => {
		if (!matchedVolunteer) return undefined;
		const mine = todayAssignments.filter((a) => a.volunteer_id === matchedVolunteer!._id);
		return (
			mine.find((a) => a.status === 'checked_in') ??
			[...mine]
				.filter((a) => a.status === 'assigned' || a.status === 'standby')
				.sort((a, b) => a.duty_window.start_ts.localeCompare(b.duty_window.start_ts))[0] ??
			mine.find((a) => a.status === 'completed') ??
			mine[0]
		);
	});

	const currentJob = $derived(
		currentAssignment ? jobsById.get(currentAssignment.job_id) : undefined
	);

	const notYetOnShift = $derived(
		currentAssignment?.status === 'assigned' || currentAssignment?.status === 'standby'
	);
	const blockedByIdentity = $derived(
		!!matchedVolunteer && !matchedVolunteer.identity_verified && notYetOnShift
	);

	const isEarly = $derived.by(() => {
		if (!currentAssignment || !notYetOnShift) return false;
		const startMs = new Date(currentAssignment.duty_window.start_ts).getTime();
		return nowMs < startMs - DEFAULT_GRACE_MINUTES * 60_000;
	});

	const earlyByLabel = $derived.by(() => {
		if (!currentAssignment) return '';
		const diffMs = new Date(currentAssignment.duty_window.start_ts).getTime() - nowMs;
		const totalMinutes = Math.max(0, Math.round(diffMs / 60_000));
		const hours = Math.floor(totalMinutes / 60);
		const minutes = totalMinutes % 60;
		return hours > 0 ? `${hours} ชม. ${minutes} นาที` : `${minutes} นาที`;
	});

	async function confirmCheckIn() {
		if (!currentAssignment || !matchedVolunteer) return;
		try {
			await checkIn.mutateAsync({ id: currentAssignment._id });
			toast.success(`เช็คอินเข้างาน ${fullName(matchedVolunteer)} แล้ว`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'เช็คอินไม่สำเร็จ');
		}
	}

	async function confirmCheckOut() {
		if (!currentAssignment || !matchedVolunteer) return;
		try {
			await checkOut.mutateAsync(currentAssignment._id);
			toast.success(`เช็คเอาต์ออกงาน ${fullName(matchedVolunteer)} แล้ว`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'เช็คเอาต์ไม่สำเร็จ');
		}
	}

	// ---------------------------------------------------------------------------
	// Recent check-in / check-out live feed.
	// ---------------------------------------------------------------------------

	const recentEvents = $derived.by<FeedEvent[]>(() => {
		const events: FeedEvent[] = [];
		for (const a of todayAssignments) {
			const v = volunteersById.get(a.volunteer_id);
			if (!v) continue;
			if (a.check_in_at)
				events.push({
					key: `${a._id}-in`,
					volunteer: v,
					assignment: a,
					kind: 'in',
					at: a.check_in_at
				});
			if (a.check_out_at)
				events.push({
					key: `${a._id}-out`,
					volunteer: v,
					assignment: a,
					kind: 'out',
					at: a.check_out_at
				});
		}
		return events.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8);
	});
</script>

<div class="mx-auto max-w-6xl px-4 py-8">
	<!-- Header -->
	<div class="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
		<div class="flex items-center gap-4">
			<Button
				variant="secondary"
				size="icon"
				href={resolve('/onsite')}
				class="h-10 w-10 shrink-0 rounded-full"
				title="กลับ"
			>
				<ArrowLeft class="size-5" />
			</Button>
			<div>
				<h1 class="flex items-center gap-2 text-xl font-bold text-foreground md:text-2xl">
					<ScanLine class="size-5 text-primary md:size-6" />
					จุดเช็คอินอาสาสมัครหน้างาน
					<span class="text-sm font-semibold text-muted-foreground">(On-Site Check-In)</span>
				</h1>
				<p class="mt-0.5 text-xs font-semibold text-muted-foreground">
					สแกน QR หรือค้นหาเพื่อเช็คอิน/เช็คเอาต์อาสาสมัครเข้า-ออกกะ
				</p>
			</div>
		</div>
		<div class="flex items-center gap-2">
			<Badge
				variant="outline"
				class="h-9 gap-1.5 rounded-xl border-emerald-300 bg-emerald-50 px-3 text-xs font-bold text-emerald-700"
			>
				<span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
				ปฏิบัติงานจริง: {hubMetrics.data?.checkedInNow ?? 0} คน
			</Badge>
			<Button class="h-9 gap-1.5 rounded-xl text-xs font-bold" onclick={() => (showWalkIn = true)}>
				<UserPlus class="size-3.5" />
				ลงทะเบียน Walk-in ด่วน
			</Button>
		</div>
	</div>

	<div class="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
		<!-- Left column: scanner + search fallback -->
		<div class="space-y-4">
			<VolunteerScannerCard {isProcessing} onsubmit={handleScanSubmit} />
			<VolunteerSearchFallback {volunteers} onselect={selectVolunteer} />
		</div>

		<!-- Right column: scan result / placeholder + recent feed -->
		<div class="space-y-4">
			<VolunteerResultCard
				volunteer={matchedVolunteer}
				{notFoundCode}
				assignment={currentAssignment}
				job={currentJob}
				{blockedByIdentity}
				{notYetOnShift}
				{isEarly}
				{earlyByLabel}
				checkInPending={checkIn.isPending}
				checkOutPending={checkOut.isPending}
				oncheckin={confirmCheckIn}
				oncheckout={confirmCheckOut}
				onclear={clearScreen}
			/>
			<VolunteerRecentFeed events={recentEvents} {jobsById} isPending={attendanceQuery.isPending} />
		</div>
	</div>
</div>

<WalkInRegistrationDialog bind:open={showWalkIn} />
