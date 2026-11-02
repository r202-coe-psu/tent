<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import Building2 from '@lucide/svelte/icons/building-2';
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import User from '@lucide/svelte/icons/user';
	import Clock from '@lucide/svelte/icons/clock';
	import Tag from '@lucide/svelte/icons/tag';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import Check from '@lucide/svelte/icons/check';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import X from '@lucide/svelte/icons/x';
	import { env } from '$env/dynamic/public';
	import { isCaptchaKeyConfigured } from '$lib/features/public-register';
	import { languageStore } from '$lib/stores/language.svelte';
	import { jobsI18n } from '$lib/features/volunteers/i18n/jobs.i18n';
	import { normalizeThaiPhone } from '$lib/db/model';
	import { isVolunteerMobile } from '$lib/utils/volunteer-phone';
	import {
		ApplyFailedError,
		apiErrorCopy,
		applyToJob,
		fetchVolunteerSkills,
		preflightApplication,
		resolvePortalAccess,
		type ApplyResult,
		type ShiftApplyResult
	} from '$lib/features/volunteer-portal/data/volunteer-api';
	import {
		findSkillOption,
		localizedSkillLabel
	} from '$lib/features/volunteer-portal/domain/skill-label';
	import { PORTAL_SESSION_KEY } from '$lib/features/volunteer-portal/domain/volunteer';
	import {
		formatShiftDate,
		groupShiftsByDate,
		seatsLeft,
		visibleDateCount
	} from '../domain/shift-picker';
	import type {
		PortalCredential,
		VolunteerProfile,
		VolunteerSkillOption
	} from '$lib/features/volunteer-portal/domain/volunteer';

	export interface ShiftDetail {
		id: string;
		date: string;
		time: string;
		start_time?: string;
		end_time?: string;
		quota: number;
		confirmed: number;
		conflict?: {
			title: string;
			time: string;
		};
	}

	export interface QuickApplyJob {
		id: string;
		title: string;
		shelter: string;
		shelter_code?: string;
		shifts?: ShiftDetail[];
		selectedShift?: ShiftDetail;
		skills_required?: string[];
	}

	let {
		job,
		isOpen = $bindable(false),
		onSubmit,
		applicantProfile = null,
		applicantCredential = null,
		showExistingProfileConfirmation = true
	} = $props<{
		job: QuickApplyJob | null;
		isOpen: boolean;
		applicantProfile?: VolunteerProfile | null;
		applicantCredential?: PortalCredential | null;
		/** Keep the existing-profile confirmation on the public application flow only. */
		showExistingProfileConfirmation?: boolean;
		onSubmit?: (data: {
			firstName?: string;
			lastName?: string;
			fullName: string;
			phone: string;
			email: string;
			skills: string[];
			trackingToken?: string;
		}) => void;
	}>();

	const t = $derived(jobsI18n[languageStore.current]);

	const isPortalApplicant = $derived(Boolean(applicantProfile || applicantCredential));

	function renumberSectionTitle(title: string, number: number): string {
		return title.replace(/^\d+\.\s*/, `${number}. `);
	}

	const shiftSectionTitle = $derived(
		renumberSectionTitle(t.applyStep2Title, isPortalApplicant ? 1 : 2)
	);
	const skillsSectionTitle = $derived(
		renumberSectionTitle(t.applyStep3Title, isPortalApplicant ? 2 : 3)
	);

	// Master Data is the only source of skills; there are no fallback labels.
	let masterSkills = $state<VolunteerSkillOption[]>([]);
	let isLoadingSkills = $state(false);
	// Plain flag, not state: the effect below must not re-run when a load comes back empty.
	let skillsRequested = false;

	async function loadPublicSkills() {
		isLoadingSkills = true;
		try {
			masterSkills = await fetchVolunteerSkills();
		} catch {
			masterSkills = [];
			// Let the next open try again.
			skillsRequested = false;
		} finally {
			isLoadingSkills = false;
		}
	}

	$effect(() => {
		if (isOpen && !skillsRequested) {
			skillsRequested = true;
			loadPublicSkills();
		}
	});

	function isControlledSkill(skill: VolunteerSkillOption): boolean {
		return skill.category?.toLowerCase() === 'controlled';
	}

	let selectedShiftIds = $state<string[]>([]);

	/** `YYYY-MM-DD` for a shift date that may arrive as `DD/MM/YYYY`. */
	function isoShiftDate(date: string): string {
		const ddmmyyyy = date.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
		return ddmmyyyy ? `${ddmmyyyy[3]}-${ddmmyyyy[2]}-${ddmmyyyy[1]}` : date;
	}

	// The picked shifts in date-then-time order — the order the server applies them in, so of
	// two overlapping picks the earlier one is kept (#716). A job with no shift list still has
	// the one shift the board opened the form with.
	const pickedShifts = $derived.by<ShiftDetail[]>(() => {
		if (!job) return [];
		if (!job.shifts || job.shifts.length === 0) return job.selectedShift ? [job.selectedShift] : [];
		const order = (shift: ShiftDetail) =>
			`${isoShiftDate(shift.date)} ${shift.start_time ?? shift.time}`;
		return job.shifts
			.filter((shift: ShiftDetail) => selectedShiftIds.includes(shift.id))
			.sort((a: ShiftDetail, b: ShiftDetail) => order(a).localeCompare(order(b)));
	});
	/** The first picked shift — what the header and the single-shift checks read. */
	const activeShift = $derived<ShiftDetail | null>(pickedShifts[0] ?? null);

	function toggleShift(id: string) {
		selectedShiftIds = selectedShiftIds.includes(id)
			? selectedShiftIds.filter((value) => value !== id)
			: [...selectedShiftIds, id];
	}

	/** This job's shifts grouped by date, for the agenda picker (earliest first). */
	const shiftDateGroups = $derived(groupShiftsByDate<ShiftDetail>(job?.shifts ?? []));
	let showAllDates = $state(false);
	const visibleDateGroups = $derived(
		showAllDates
			? shiftDateGroups
			: shiftDateGroups.slice(0, visibleDateCount(shiftDateGroups, activeShift?.date))
	);
	const hiddenDateCount = $derived(shiftDateGroups.length - visibleDateGroups.length);

	const dateLocale = $derived(languageStore.current === 'en' ? 'en-GB' : 'th-TH');
	function weekdayLabel(date: string): string {
		return formatShiftDate(date, dateLocale, { weekday: 'short' });
	}
	function dayMonthLabel(date: string): string {
		return formatShiftDate(date, dateLocale, { day: 'numeric', month: 'short' });
	}

	// Start from the shift whose "สมัครกะนี้" opened the form; more can be added from here.
	$effect(() => {
		if (job?.selectedShift?.id) {
			selectedShiftIds = [job.selectedShift.id];
		} else if (job?.shifts?.[0]?.id) {
			selectedShiftIds = [job.shifts[0].id];
		} else {
			selectedShiftIds = [];
		}
	});

	let formData = $state({
		firstName: '',
		lastName: '',
		nickname: '',
		phone: '',
		email: '',
		skills: [] as string[],
		consentPdpa: false
	});

	$effect(() => {
		if (!isOpen || !applicantProfile) return;
		formData.firstName = applicantProfile.first_name;
		formData.lastName = applicantProfile.last_name;
		formData.nickname = applicantProfile.nickname ?? '';
		// Not `phone_masked`: it is never a usable number. A phone credential is sent as is
		// (`cleanApplicantPhone`), and a QR-token sign-in has to type the full number — a
		// prefilled mask there passed the empty check and went out as its leftover digits.
		formData.phone = '';
		formData.email = applicantProfile.email ?? '';
		formData.skills = applicantProfile.skills.map(canonicalSkillId);
	});

	let isSubmitting = $state(false);
	let errorMessage = $state<string | null>(null);
	let confirmationOpen = $state(false);
	let preflightResult = $state<{
		match: 'matched_one';
		existing_profile: {
			volunteer_code: string;
			display_name: string;
			identity_status: string;
			existing_skills: string[];
			new_skills: string[];
			new_controlled_skills: string[];
		};
		message: string;
	} | null>(null);

	$effect(() => {
		if (!isOpen) {
			confirmationOpen = false;
			preflightResult = null;
			applyOutcome = null;
		}
	});
	const siteKey = env.PUBLIC_RECAPTCHA_SITE_KEY || '';
	const captchaEnabled = isCaptchaKeyConfigured(siteKey);

	function showSubmitError(message: string) {
		errorMessage = message;
		toast.error(message);
	}

	async function captchaToken(): Promise<string | null> {
		if (!captchaEnabled) return '';
		if (!window.grecaptcha?.execute) return null;
		try {
			return await window.grecaptcha.execute(siteKey, { action: 'volunteer_apply' });
		} catch {
			return null;
		}
	}

	function toggleSkill(skillLabelOrCode: string) {
		const code = canonicalSkillId(skillLabelOrCode);
		if (formData.skills.includes(code)) {
			formData.skills = formData.skills.filter((s) => s !== code);
		} else {
			formData.skills = [...formData.skills, code];
		}
	}

	/** Compare job/applicant skills by Master Data code, with legacy labels supported. */
	function canonicalSkillId(value: string): string {
		return findSkillOption(value ?? '', masterSkills)?.code ?? value ?? '';
	}

	function isSuggestedForJob(skillCode: string): boolean {
		const target = canonicalSkillId(skillCode);
		return (
			job?.skills_required?.some((required: string) => canonicalSkillId(required) === target) ??
			false
		);
	}

	function shiftPayload(shift: ShiftDetail) {
		let startTime = shift.start_time ?? '08:00';
		let endTime = shift.end_time ?? '12:00';
		if (!shift.start_time && shift.time) {
			const match = shift.time.match(/(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/);
			if (match) {
				startTime = match[1];
				endTime = match[2];
			}
		}
		return {
			shift_id: shift.id || undefined,
			shift_date: isoShiftDate(shift.date),
			start_time: startTime,
			end_time: endTime
		};
	}

	/** "12 ต.ค. 08:00–12:00" for a shift the server answered about. */
	function shiftResultLabel(shiftIdValue: string | null): string {
		const shift = job?.shifts?.find((s: ShiftDetail) => s.id === shiftIdValue) ?? activeShift;
		if (!shift) return shiftIdValue ?? '';
		const time =
			shift.start_time && shift.end_time ? `${shift.start_time}–${shift.end_time}` : shift.time;
		return `${dayMonthLabel(isoShiftDate(shift.date))} ${time}`;
	}

	function shiftFailureReason(result: ShiftApplyResult): string {
		return result.ok ? '' : (apiErrorCopy(result.error) ?? t.errApplyGeneric);
	}

	/**
	 * Per-shift outcome of the last submit, shown before leaving the form whenever a shift
	 * did not pass (#716). `result` is null when none passed — nothing was saved.
	 */
	let applyOutcome = $state<{
		result: ApplyResult | null;
		applicantPhone: string;
		saved: ShiftApplyResult[];
		failed: ShiftApplyResult[];
	} | null>(null);

	function cleanApplicantPhone(): string {
		const raw =
			applicantCredential && 'phone' in applicantCredential
				? applicantCredential.phone
				: formData.phone;
		return normalizeThaiPhone(raw);
	}

	async function submitApplication() {
		if (!job) {
			showSubmitError(t.errNoJobSelected);
			return;
		}
		if (pickedShifts.length === 0) {
			showSubmitError(t.errNoShiftPicked);
			return;
		}
		if (pickedShifts.some((shift) => shift.conflict)) {
			showSubmitError('เวลาของกะนี้ชนกับกะที่คุณจองไว้แล้ว');
			return;
		}
		isSubmitting = true;
		try {
			const recaptchaToken = await captchaToken();
			if (recaptchaToken === null) {
				showSubmitError(t.errRecaptchaFailed);
				return;
			}
			const firstName = formData.firstName.trim();
			const lastName = formData.lastName.trim();
			const targetJobId = job.id.startsWith('job:') ? job.id : `job:${job.id}`;
			const result = await applyToJob(targetJobId, {
				shelter_code: job.shelter_code || undefined,
				first_name: firstName,
				last_name: lastName,
				phone: cleanApplicantPhone(),
				email: isPortalApplicant ? '' : formData.email.trim(),
				skills: formData.skills,
				shifts: pickedShifts.map(shiftPayload),
				...(recaptchaToken ? { captchaToken: recaptchaToken } : {})
			});
			const applicantPhone = cleanApplicantPhone();
			const failed = (result.results ?? []).filter((r) => !r.ok);
			if (failed.length > 0) {
				// Some shifts were saved and some were not: say which before leaving the form.
				applyOutcome = {
					result,
					applicantPhone,
					saved: (result.results ?? []).filter((r) => r.ok),
					failed
				};
				confirmationOpen = false;
				preflightResult = null;
				return;
			}
			await finishApplication(result, applicantPhone);
		} catch (err: unknown) {
			if (err instanceof ApplyFailedError) {
				// No shift passed and nothing was saved; the form stays for another pick.
				applyOutcome = { result: null, applicantPhone: '', saved: [], failed: err.results };
				confirmationOpen = false;
				preflightResult = null;
				return;
			}
			const msg = err instanceof Error ? err.message : t.errApplyGeneric;
			showSubmitError(msg);
		} finally {
			isSubmitting = false;
		}
	}

	/**
	 * Close the form. With some shifts already saved it carries on to the pass / portal
	 * instead — a first application's pass token comes back only once, in that response, so
	 * leaving here would strand the applicant without their pass.
	 */
	function requestClose() {
		const saved = applyOutcome?.result;
		if (saved && applyOutcome) {
			void finishApplication(saved, applyOutcome.applicantPhone);
			return;
		}
		isOpen = false;
	}

	/** After a submit that saved at least one shift: reset the form and go to the pass / portal. */
	async function finishApplication(result: ApplyResult, applicantPhone: string) {
		const firstName = formData.firstName.trim();
		const lastName = formData.lastName.trim();
		const fullName = `${firstName} ${lastName}`.trim();
		const trackingToken = result.tracking_token;
		applyOutcome = null;
		toast.success(t.toastApplySuccess);
		try {
			onSubmit?.({
				firstName,
				lastName,
				fullName,
				phone: normalizeThaiPhone(formData.phone),
				email: formData.email,
				skills: formData.skills,
				trackingToken
			});
			confirmationOpen = false;
			preflightResult = null;
			isOpen = false;
			formData = {
				firstName: '',
				lastName: '',
				nickname: '',
				phone: '',
				email: '',
				skills: [],
				consentPdpa: false
			};

			if (result.volunteer_token) {
				// First application ever for this phone number — the permanent per-volunteer
				// digital-pass token was just minted, so go straight to the pass.
				const token = encodeURIComponent(result.volunteer_token);
				// `resolve()` only prefixes `base`, so the query rides along unchanged.
				if (isPortalApplicant) await goto(resolve(`/volunteer/ticket/${token}?from=portal`));
				else await goto(resolve(`/volunteer/ticket/${token}`));
			} else if (isPortalApplicant) {
				if (applicantCredential?.portal_id) {
					await goto(
						resolve(
							`/volunteers/portal/volunteer/${encodeURIComponent(applicantCredential.portal_id)}/dashboard`
						)
					);
				}
			} else {
				try {
					const profile = await resolvePortalAccess({ phone: applicantPhone });
					if (profile?.portal_id) {
						try {
							sessionStorage.setItem(
								PORTAL_SESSION_KEY,
								JSON.stringify({ phone: applicantPhone, portal_id: profile.portal_id })
							);
						} catch {
							// Private mode, or storage disabled — the portal opens signed out and
							// the volunteer can sign in again with the number they just typed.
						}
					}
				} catch {
					// Resolve failed (network hiccup, phone not found, …) — same fallback: land
					// on the entry screen, they can sign in by hand.
				}
				await goto(resolve('/volunteers/portal'));
			}
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : t.errApplyGeneric;
			showSubmitError(msg);
		} finally {
			isSubmitting = false;
		}
	}

	async function handleSubmit(e: Event) {
		e.preventDefault();
		if (!formData.consentPdpa) {
			showSubmitError(t.errPdpaRequired);
			// The checkbox sits at the end of a long form, under the sticky submit bar until the
			// form is scrolled to the bottom — bring it to the applicant.
			const consent = document.getElementById('applyConsentPdpa');
			consent?.scrollIntoView({ block: 'center', behavior: 'smooth' });
			consent?.focus({ preventScroll: true });
			return;
		}
		if (!job) {
			showSubmitError(t.errNoJobSelected);
			return;
		}
		if (pickedShifts.length === 0) {
			showSubmitError(t.errNoShiftPicked);
			return;
		}
		if (pickedShifts.some((shift) => shift.conflict)) {
			showSubmitError('เวลาของกะนี้ชนกับกะที่คุณจองไว้แล้ว กรุณาเลือกกะอื่นที่ไม่ทับซ้อนกัน');
			return;
		}
		if (!isPortalApplicant && !formData.firstName.trim()) {
			showSubmitError(t.errFirstName);
			return;
		}
		if (!isPortalApplicant && !formData.lastName.trim()) {
			showSubmitError(t.errLastName);
			return;
		}
		if (!isVolunteerMobile(cleanApplicantPhone())) {
			const needsOriginalPhone =
				isPortalApplicant && applicantCredential && 'token' in applicantCredential;
			showSubmitError(
				needsOriginalPhone
					? 'กรุณากรอกเบอร์โทรศัพท์ที่ใช้สมัครเดิมเพื่อสมัครงานอาสาสมัครจาก portal'
					: t.errPhone
			);
			return;
		}
		errorMessage = null;
		isSubmitting = true;
		try {
			// Throws with the copy for the server's error code (job closed, shift full, …).
			const preflight = await preflightApplication({
				job_id: job.id.startsWith('job:') ? job.id : `job:${job.id}`,
				shelter_code: job.shelter_code || undefined,
				first_name: formData.firstName.trim(),
				last_name: formData.lastName.trim(),
				phone: cleanApplicantPhone(),
				email: isPortalApplicant ? '' : formData.email.trim(),
				skills: formData.skills,
				// One shift is checked here; several are each judged at apply time (#716).
				...(pickedShifts.length === 1 ? shiftPayload(pickedShifts[0]) : {})
			});

			if (preflight.match === 'ambiguous_match') {
				showSubmitError(preflight.message);
				return;
			}
			if (preflight.match === 'matched_one') {
				if (showExistingProfileConfirmation && preflight.existing_profile) {
					preflightResult = {
						match: 'matched_one',
						existing_profile: preflight.existing_profile,
						message: preflight.message
					};
					confirmationOpen = true;
				} else {
					// A signed-in portal volunteer has already identified this profile.
					// Keep the re-application confirmation for the public flow only.
					isSubmitting = false;
					await submitApplication();
				}
				return;
			}
			isSubmitting = false;
			await submitApplication();
		} catch (err) {
			showSubmitError(err instanceof Error ? err.message : 'ตรวจสอบข้อมูลก่อนสมัครไม่สำเร็จ');
		} finally {
			isSubmitting = false;
		}
	}

	/**
	 * Keep the page behind still while the modal is open. This is a hand-built modal (not
	 * the shadcn Dialog), so nothing locked the page: wheeling over the backdrop, or past
	 * the end of the modal's own scroll, moved the job board behind it. The gutter stays
	 * reserved so hiding the scrollbar does not shift the page sideways; both styles are
	 * put back when the modal closes.
	 */
	function lockPageScroll() {
		const root = document.documentElement;
		const previous = { overflow: root.style.overflow, gutter: root.style.scrollbarGutter };
		root.style.scrollbarGutter = 'stable';
		root.style.overflow = 'hidden';
		return () => {
			root.style.overflow = previous.overflow;
			root.style.scrollbarGutter = previous.gutter;
		};
	}
</script>

<svelte:head>
	{#if captchaEnabled}
		<script src="https://www.google.com/recaptcha/api.js?render={siteKey}" async defer></script>
	{/if}
</svelte:head>

{#if isOpen && job}
	<div
		{@attach lockPageScroll}
		class="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
	>
		<!-- Backdrop -->
		<div
			class="absolute inset-0 bg-background/80 backdrop-blur-sm"
			onclick={requestClose}
			onkeydown={(e) => e.key === 'Escape' && requestClose()}
			role="button"
			tabindex="0"
			aria-label="Close modal"
		></div>

		<!-- Modal -->
		<div
			class="relative z-10 flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-2xl"
		>
			<div class="overflow-y-auto overscroll-contain">
				<!-- Header Section -->
				<div class="relative bg-primary-dark px-6 py-8 text-primary-foreground">
					<button
						type="button"
						onclick={requestClose}
						class="absolute top-4 right-4 cursor-pointer rounded-full p-2 text-white/80 hover:bg-white/10 hover:text-white"
					>
						<X class="h-5 w-5" />
					</button>

					<h2 class="mb-3 text-2xl font-bold">{job.title}</h2>
					<div class="flex flex-wrap items-center gap-4 text-xs text-white/80">
						<span class="flex items-center gap-1.5">
							<Building2 class="h-4 w-4 shrink-0" />
							{job.shelter}
						</span>
						{#if pickedShifts.length > 1}
							<span class="flex items-center gap-1.5">
								<CalendarDays class="h-4 w-4 shrink-0" />
								{pickedShifts.length}
								{t.applyShiftsPicked}
							</span>
						{:else if activeShift}
							<span class="flex items-center gap-1.5">
								<CalendarDays class="h-4 w-4 shrink-0" />
								{t.shiftDateLabel}
								{activeShift.date}
							</span>
						{/if}
					</div>
				</div>

				<form onsubmit={handleSubmit} novalidate class="px-6 py-6">
					{#if errorMessage}
						<div
							class="mb-6 flex items-start gap-2.5 rounded-xl border border-danger/30 bg-danger/10 p-3.5 text-xs text-danger"
						>
							<AlertCircle class="mt-0.5 h-4 w-4 shrink-0" />
							<span>{errorMessage}</span>
						</div>
					{/if}

					{#if confirmationOpen && preflightResult}
						<div
							class="absolute inset-0 z-20 flex items-center justify-center bg-background/85 p-4 backdrop-blur-sm"
						>
							<div
								class="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl"
								onclick={(event) => event.stopPropagation()}
								onkeydown={(event) => event.stopPropagation()}
								role="dialog"
								aria-modal="true"
								tabindex="-1"
							>
								<h3 class="text-lg font-bold text-foreground">เบอร์โทรนี้เคยสมัครไว้แล้ว</h3>
								<p class="mt-2 text-sm leading-relaxed text-muted-foreground">
									ระบบจะอัปเดต Volunteer profile เดิม และสร้างใบสมัครงานใหม่ให้คุณ
									ข้อมูลการสมัครงานเดิมจะไม่ถูกลบ
								</p>
								<div class="mt-4 space-y-3 rounded-xl bg-muted/30 p-4 text-sm">
									<div class="flex items-center justify-between gap-3">
										<span class="text-muted-foreground">โปรไฟล์</span>
										<span class="font-semibold text-foreground"
											>{preflightResult.existing_profile.display_name}</span
										>
									</div>
									<div class="flex items-center justify-between gap-3">
										<span class="text-muted-foreground">Volunteer code</span>
										<span class="font-semibold text-foreground"
											>{preflightResult.existing_profile.volunteer_code || '—'}</span
										>
									</div>
									<div>
										<p class="text-xs text-muted-foreground">ทักษะเดิม</p>
										<p class="mt-1 font-medium text-foreground">
											{preflightResult.existing_profile.existing_skills.join(', ') || 'ยังไม่มี'}
										</p>
									</div>
									{#if preflightResult.existing_profile.new_skills.length > 0}
										<div>
											<p class="text-xs text-muted-foreground">ทักษะใหม่ที่จะเพิ่ม</p>
											<p class="mt-1 font-medium text-foreground">
												{preflightResult.existing_profile.new_skills.join(', ')}
											</p>
										</div>
									{/if}
								</div>
								{#if preflightResult.existing_profile.new_controlled_skills.length > 0}
									<div
										class="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900"
									>
										ทักษะควบคุมใหม่จะรอตรวจสอบก่อนใช้งาน
										เจ้าหน้าที่ต้องรับรองก่อนจึงจะใช้ทักษะนี้กับงานได้
									</div>
								{/if}
								<!-- Stacked on a phone so the long confirm label never breaks over 3 lines. -->
								<div class="mt-6 flex flex-col-reverse gap-3 sm:flex-row">
									<button
										type="button"
										onclick={() => {
											confirmationOpen = false;
											preflightResult = null;
										}}
										class="min-h-11 rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm font-bold text-foreground hover:bg-muted sm:flex-1"
									>
										ยกเลิก
									</button>
									<button
										type="button"
										disabled={isSubmitting}
										onclick={submitApplication}
										class="min-h-11 rounded-xl bg-primary px-4 py-3 text-sm font-bold text-primary-foreground hover:bg-primary-strong disabled:opacity-70 sm:flex-[2]"
									>
										{isSubmitting ? 'กำลังบันทึก...' : 'ยืนยันอัปเดตโปรไฟล์และสมัครงาน'}
									</button>
								</div>
							</div>
						</div>
					{/if}

					{#if applyOutcome}
						{@const outcome = applyOutcome}
						<!-- Per-shift result (#716): which shifts were saved, and why the others were not. -->
						<div
							class="absolute inset-0 z-20 flex items-center justify-center bg-background/85 p-4 backdrop-blur-sm"
						>
							<div
								class="max-h-full w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-2xl"
								role="alertdialog"
								aria-modal="true"
								aria-labelledby="apply-outcome-title"
								tabindex="-1"
							>
								<h3 id="apply-outcome-title" class="text-lg font-bold text-foreground">
									{outcome.saved.length > 0 ? t.applyOutcomePartialTitle : t.applyOutcomeNoneTitle}
								</h3>
								{#if outcome.saved.length === 0}
									<p class="mt-2 text-sm leading-relaxed text-muted-foreground">
										{t.applyOutcomeNoneBody}
									</p>
								{/if}
								{#if outcome.saved.length > 0}
									<p class="mt-4 text-sm font-bold text-foreground">
										{t.applyOutcomeSaved}
										{outcome.saved.length}
										{t.shiftsUnit}
									</p>
									<ul class="mt-2 space-y-1.5">
										{#each outcome.saved as result, index (`${result.shift_id}-${index}`)}
											<li class="flex items-start gap-2 text-sm text-foreground">
												<CheckCircle2 class="mt-0.5 h-4 w-4 shrink-0 text-success" />
												<span class="tabular-nums">{shiftResultLabel(result.shift_id)}</span>
											</li>
										{/each}
									</ul>
								{/if}
								<p class="mt-4 text-sm font-bold text-foreground">
									{t.applyOutcomeFailed}
									{outcome.failed.length}
									{t.shiftsUnit}
								</p>
								<ul class="mt-2 space-y-2">
									{#each outcome.failed as result, index (`${result.shift_id}-${index}`)}
										<li class="flex items-start gap-2 text-sm">
											<AlertCircle class="mt-0.5 h-4 w-4 shrink-0 text-danger" />
											<span class="min-w-0">
												<span class="block font-medium text-foreground tabular-nums"
													>{shiftResultLabel(result.shift_id)}</span
												>
												<span class="block text-xs text-muted-foreground"
													>{shiftFailureReason(result)}</span
												>
											</span>
										</li>
									{/each}
								</ul>
								<div class="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
									{#if outcome.result}
										{@const saved = outcome.result}
										<button
											type="button"
											disabled={isSubmitting}
											onclick={async () => {
												isSubmitting = true;
												try {
													await finishApplication(saved, outcome.applicantPhone);
												} finally {
													isSubmitting = false;
												}
											}}
											class="min-h-11 rounded-xl bg-primary px-6 py-3 text-sm font-bold text-primary-foreground hover:bg-primary-strong disabled:opacity-70"
										>
											{t.applyOutcomeContinue}
										</button>
									{:else}
										<button
											type="button"
											onclick={() => {
												// Drop the shifts that failed so the next submit does not repeat them.
												const failedIds = new Set(outcome.failed.map((result) => result.shift_id));
												selectedShiftIds = selectedShiftIds.filter((id) => !failedIds.has(id));
												applyOutcome = null;
											}}
											class="min-h-11 rounded-xl bg-primary px-6 py-3 text-sm font-bold text-primary-foreground hover:bg-primary-strong"
										>
											{t.applyOutcomePickAgain}
										</button>
									{/if}
								</div>
							</div>
						</div>
					{/if}

					{#if isPortalApplicant && applicantCredential && 'token' in applicantCredential}
						<div
							class="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-900"
						>
							<p class="font-bold">คุณเข้าสู่ระบบด้วย QR Code ตั๋วอาสาสมัคร</p>
							<p class="mt-1 leading-relaxed">
								เพื่อสมัครงานอาสาสมัครใหม่ กรุณากรอกเบอร์โทรศัพท์ที่ใช้สมัครเดิม
								ระบบจะใช้เบอร์นี้เชื่อมใบสมัครกับโปรไฟล์ Volunteer ของคุณ
							</p>
							<label for="portalApplyPhone" class="mt-3 block font-bold">
								เบอร์โทรศัพท์ที่ใช้สมัครเดิม <span class="text-danger">*</span>
							</label>
							<input
								id="portalApplyPhone"
								type="tel"
								required
								bind:value={formData.phone}
								inputmode="tel"
								maxlength={16}
								placeholder="0812345678"
								class="mt-1.5 w-full rounded-xl border border-amber-300 bg-white px-4 py-2.5 text-sm outline-hidden focus:border-primary focus:ring-1 focus:ring-primary"
							/>
						</div>
					{/if}

					<div class="space-y-8">
						<!-- Personal details are collected only on the public Job Board. -->
						{#if !isPortalApplicant}
							<section>
								<h3
									class="mb-4 flex flex-wrap items-center gap-2 text-sm font-bold text-foreground"
								>
									<User class="h-4 w-4 text-muted-foreground" />
									{t.applyStep1Title}
								</h3>
								<div class="space-y-4">
									<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
										<div>
											<label for="firstName" class="mb-1.5 block text-xs font-bold text-foreground">
												{t.applyFirstName} <span class="text-danger">*</span>
											</label>
											<input
												id="firstName"
												type="text"
												required
												bind:value={formData.firstName}
												readonly={isPortalApplicant}
												aria-readonly={isPortalApplicant}
												placeholder="เช่น เก่งกล้า"
												class="w-full rounded-xl border border-border bg-card px-4 py-2.5 text-sm outline-hidden transition-all focus:border-primary focus:ring-1 focus:ring-primary"
											/>
										</div>
										<div>
											<label for="lastName" class="mb-1.5 block text-xs font-bold text-foreground">
												{t.applyLastName} <span class="text-danger">*</span>
											</label>
											<input
												id="lastName"
												type="text"
												required
												bind:value={formData.lastName}
												readonly={isPortalApplicant}
												aria-readonly={isPortalApplicant}
												placeholder="เช่น งานอาสา"
												class="w-full rounded-xl border border-border bg-card px-4 py-2.5 text-sm outline-hidden transition-all focus:border-primary focus:ring-1 focus:ring-primary"
											/>
										</div>
									</div>
									<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
										<div>
											<label for="nickname" class="mb-1.5 block text-xs font-bold text-foreground">
												{t.applyNickname}
												<span class="font-normal text-muted-foreground">{t.applyOptional}</span>
											</label>
											<input
												id="nickname"
												type="text"
												bind:value={formData.nickname}
												readonly={isPortalApplicant}
												aria-readonly={isPortalApplicant}
												placeholder="เช่น กล้า, พิมพ์"
												class="w-full rounded-xl border border-border bg-card px-4 py-2.5 text-sm outline-hidden transition-all focus:border-primary focus:ring-1 focus:ring-primary"
											/>
										</div>
										<div>
											<label for="phone" class="mb-1.5 block text-xs font-bold text-foreground">
												{t.applyPhone} <span class="text-danger">*</span>
											</label>
											<input
												id="phone"
												type="tel"
												required
												bind:value={formData.phone}
												readonly={isPortalApplicant}
												aria-readonly={isPortalApplicant}
												inputmode="tel"
												maxlength={16}
												placeholder="0812345678"
												class="w-full rounded-xl border border-border bg-card px-4 py-2.5 text-sm outline-hidden transition-all focus:border-primary focus:ring-1 focus:ring-primary"
											/>
											<p class="mt-1 text-3xs text-muted-foreground">
												{t.applyPhoneLimitHint}
											</p>
										</div>
									</div>
									<div>
										<label for="email" class="mb-1.5 block text-xs font-bold text-foreground">
											{t.applyEmail}
											<span class="font-normal text-muted-foreground">{t.applyOptional}</span>
										</label>
										<input
											id="email"
											type="email"
											bind:value={formData.email}
											readonly={isPortalApplicant}
											aria-readonly={isPortalApplicant}
											placeholder="volunteer@example.com"
											class="w-full rounded-xl border border-border bg-card px-4 py-2.5 text-sm outline-hidden transition-all focus:border-primary focus:ring-1 focus:ring-primary"
										/>
									</div>
								</div>
							</section>
						{/if}

						<!-- Shift selection; numbering is adjusted when the personal section is hidden. -->
						<section>
							<div class="mb-4 flex items-center justify-between">
								<h3 class="flex items-center gap-2 text-sm font-bold text-foreground">
									<Clock class="h-4 w-4 text-muted-foreground" />
									{shiftSectionTitle}
								</h3>
								{#if job.shifts && job.shifts.length > 1}
									<span class="text-xs text-muted-foreground"
										>{job.shifts.length} {t.applyShiftsAvailable}</span
									>
								{/if}
							</div>
							{#if job.shifts && job.shifts.length > 1}
								<p class="-mt-2 mb-3 text-xs text-muted-foreground">{t.applyPickShiftsHint}</p>
							{/if}

							<!-- Shift picker as an agenda: one row per date, its times beside it. Every
							     date stays on screen (no sideways scroll hiding dates) and a time is
							     never separated from its date; a long job shows its first week plus a
							     button that says how many dates remain. -->
							<div>
								{#if job.shifts && job.shifts.length > 0}
									<div class="space-y-2" role="group" aria-label={t.applyPickShift}>
										{#each visibleDateGroups as group (group.date)}
											<div
												data-shift-date={group.date}
												class="flex flex-col gap-2 rounded-xl border px-3 py-2.5 min-[420px]:flex-row min-[420px]:items-center {pickedShifts.some(
													(picked) => picked.date === group.date
												)
													? 'border-primary/40 bg-primary/5'
													: 'border-border'}"
											>
												<p
													class="flex shrink-0 items-baseline gap-1.5 min-[420px]:w-20 min-[420px]:flex-col min-[420px]:gap-0 {group.hasSeat
														? 'text-foreground'
														: 'text-muted-foreground'}"
												>
													<span class="text-sm font-bold whitespace-nowrap tabular-nums">
														{dayMonthLabel(group.date)}
													</span>
													<span class="text-xs">{weekdayLabel(group.date)}</span>
												</p>
												<!-- Below 400px one full-width chip per time (time left, seats right) so nothing
												     is cut off; two columns from 400px; a free-flowing row from 420px. -->
												<div
													class="grid flex-1 grid-cols-1 gap-2 min-[400px]:grid-cols-2 min-[420px]:flex min-[420px]:flex-wrap"
												>
													{#each group.shifts as shift (shift.id)}
														{@const isSelected = selectedShiftIds.includes(shift.id)}
														{@const remaining = seatsLeft(shift)}
														{@const isFull = remaining === 0}
														{@const isBlocked = Boolean(shift.conflict)}
														{@const timeLabel =
															shift.start_time && shift.end_time
																? `${shift.start_time}–${shift.end_time}`
																: shift.time}
														{@const seatLabel = isFull
															? t.shiftFull
															: `${t.applyShiftNeedMore}: ${remaining} ${t.peopleUnit}`}
														{@const seatShort = isFull
															? t.shiftFull
															: isBlocked
																? t.applyShiftConflict
																: `${t.applySeatsLeftPrefix} ${remaining} ${t.applySeatsLeftSuffix}`.trim()}
														<!-- A shift that clashes with one this volunteer already holds cannot be
														     picked; the label names the clash (portal only — the board knows no
														     bookings for an anonymous applicant). -->
														<button
															type="button"
															disabled={isFull || isBlocked}
															aria-pressed={isSelected}
															aria-label="{dayMonthLabel(group.date)} {timeLabel} — {isBlocked &&
															shift.conflict
																? `${t.applyShiftConflict}: ${shift.conflict.title}`
																: seatLabel}"
															onclick={() => toggleShift(shift.id)}
															class="relative flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg border-2 px-2.5 py-1.5 text-left transition-all focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none {isSelected
																? 'border-primary bg-primary/10 text-foreground shadow-sm'
																: isFull || isBlocked
																	? 'cursor-not-allowed border-border/60 bg-muted/30 text-muted-foreground'
																	: 'border-border bg-card hover:border-primary/40'}"
														>
															{#if isSelected}
																<!-- A corner badge, so the tick never takes width from the time. -->
																<span
																	class="absolute -top-2 -right-2 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground ring-2 ring-card"
																>
																	<Check class="size-3" />
																</span>
															{/if}
															<span
																class="flex flex-1 items-center justify-between gap-2 leading-tight min-[400px]:flex-col min-[400px]:items-start min-[400px]:justify-start min-[400px]:gap-0"
															>
																<span class="text-sm font-bold whitespace-nowrap tabular-nums"
																	>{timeLabel}</span
																>
																<span
																	class="text-xs font-semibold whitespace-nowrap {isBlocked
																		? 'text-warning-foreground'
																		: isFull
																			? 'text-muted-foreground'
																			: remaining <= 2
																				? 'text-warning-foreground'
																				: 'text-success'}">{seatShort}</span
																>
															</span>
														</button>
													{/each}
												</div>
											</div>
										{/each}
										{#if hiddenDateCount > 0}
											<button
												type="button"
												onclick={() => (showAllDates = true)}
												class="min-h-11 w-full rounded-xl border border-dashed border-border px-4 py-2 text-sm font-bold text-primary transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none"
											>
												{t.applyMoreDatesPrefix}
												{hiddenDateCount}
												{t.applyMoreDatesSuffix}
											</button>
										{/if}
									</div>
								{:else if activeShift}
									<div
										class="relative rounded-2xl border-2 border-primary/20 bg-card p-4 shadow-sm"
									>
										<div class="flex items-center justify-between">
											<span class="text-xs font-bold text-foreground"
												>{t.applyDatePrefix} {activeShift.date}</span
											>
											<span class="rounded-full bg-primary p-0.5 text-primary-foreground">
												<Check class="h-3 w-3" />
											</span>
										</div>
										<p class="mt-1 text-sm font-black text-primary">
											{activeShift.time ||
												`${activeShift.start_time} - ${activeShift.end_time}`}{t.timeSuffix}
										</p>
										<p class="mt-2 text-2xs text-muted-foreground">
											{t.applyQuotaLabel}: {activeShift.quota}
											{t.peopleUnit} ({t.confirmedCount}
											{activeShift.confirmed}
											{t.peopleUnit})
										</p>
									</div>
								{/if}
							</div>
						</section>

						<!-- Skills from Master Data (CR-099). -->
						<section>
							<div class="mb-3 flex items-center justify-between">
								<div>
									<h3 class="flex items-center gap-2 text-sm font-bold text-foreground">
										<Tag class="h-4 w-4 text-muted-foreground" />
										{skillsSectionTitle}
									</h3>
									<p class="mt-0.5 text-2xs text-muted-foreground">
										{t.applyStep3Subtitle}
									</p>
								</div>
								<span class="text-xs font-bold text-primary">
									{t.applySkillsSelected}
									{formData.skills.length}
									{t.skillsUnit}
								</span>
							</div>

							{#if job?.skills_required && job.skills_required.length > 0}
								<div
									class="mb-3.5 flex items-center gap-2 rounded-xl border border-domain-volunteer-border bg-domain-volunteer-subtle p-3 text-xs font-medium text-domain-volunteer-text"
								>
									<Tag class="h-4 w-4 shrink-0 text-domain-volunteer" />
									<span>{t.applySkillsSuggestion}</span>
								</div>
							{/if}

							{#if isLoadingSkills}
								<div class="flex items-center gap-2 py-4 text-xs text-muted-foreground">
									<Loader2 class="h-4 w-4 animate-spin text-primary" />
									<span>{t.applyLoadingSkills}</span>
								</div>
							{:else}
								<div class="flex flex-wrap gap-2.5">
									{#each masterSkills as skill (skill.code)}
										{@const isSelected = formData.skills.includes(skill.code)}
										{@const isControlled = isControlledSkill(skill)}
										{@const isSuggested = isSuggestedForJob(skill.code)}
										<button
											type="button"
											onclick={() => toggleSkill(skill.code)}
											class="flex cursor-pointer items-center gap-2 rounded-2xl border px-4 py-2.5 text-xs font-bold transition-all {isSelected
												? 'border-domain-volunteer-strong bg-domain-volunteer-strong text-white shadow-sm ring-2 ring-domain-volunteer-border'
												: isSuggested
													? 'border-domain-volunteer-border bg-domain-volunteer-subtle text-domain-volunteer-text hover:bg-domain-volunteer-border/40'
													: 'border-border bg-card text-foreground hover:bg-muted'}"
										>
											{#if isSelected}
												<CheckCircle2 class="h-3.5 w-3.5" />
											{:else if isControlled}
												<ShieldAlert class="h-3.5 w-3.5 text-warning-foreground" />
											{:else}
												<Sparkles class="h-3.5 w-3.5 text-domain-volunteer" />
											{/if}

											<span>{localizedSkillLabel(skill, languageStore.current)}</span>

											{#if isControlled}
												<span
													class="rounded-full px-1.5 py-0.5 text-3xs font-black {isSelected
														? 'bg-white/20 text-white'
														: 'bg-warning/20 text-warning-foreground'}"
												>
													{t.applyControlledSkillBadge}
												</span>
											{/if}

											{#if isSuggested && !isSelected}
												<span
													class="rounded-full bg-primary/20 px-1.5 py-0.5 text-3xs font-bold text-primary"
												>
													{t.applyMatchesJobBadge}
												</span>
											{/if}
										</button>
									{/each}
								</div>
							{/if}
						</section>
					</div>

					<!-- Footer / Consent -->
					<div class="mt-8 space-y-5">
						<div class="rounded-2xl border border-border bg-muted/20 p-4">
							<label class="flex cursor-pointer items-start gap-3">
								<input
									type="checkbox"
									required
									id="applyConsentPdpa"
									bind:checked={formData.consentPdpa}
									class="mt-0.5 h-4 w-4 shrink-0 rounded border-border text-primary focus:ring-primary"
								/>
								<div>
									<p class="text-xs leading-relaxed text-muted-foreground">
										<strong class="text-foreground">{t.applyPdpaTitle}</strong>
										{t.applyPdpaText}
									</p>
								</div>
							</label>
							<div
								class="mt-4 flex items-center justify-between border-t border-border/50 pt-3 text-2xs text-muted-foreground"
							>
								<div class="flex items-center gap-1.5">
									<ShieldAlert class="h-3 w-3" />
									{t.applyProtectedFooter}
								</div>
							</div>
						</div>
					</div>

					<!-- Sticky to the bottom of the modal, so submit is in reach without scrolling
					     past every shift and skill. A direct child of the form on purpose: a sticky
					     element only sticks within its parent. `-mx-6 -mb-6` spans the form's padding, so the
					     bar is flush with the modal's edges. Stacked on a phone (#626 follow-up):
					     side by side at 320–375px the submit label broke over three lines. -->
					<div
						class="sticky bottom-0 z-10 -mx-6 mt-5 -mb-6 flex flex-col-reverse gap-2 border-t border-border bg-card/95 px-6 py-3 backdrop-blur sm:flex-row sm:gap-3"
					>
						<button
							type="button"
							onclick={requestClose}
							class="min-h-11 cursor-pointer rounded-2xl border border-border bg-muted/30 px-4 py-2.5 text-sm font-bold text-foreground transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none sm:flex-1 sm:py-3"
						>
							{t.applyCancelButton}
						</button>
						<button
							type="submit"
							disabled={isSubmitting}
							class="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground shadow-sm transition-all hover:bg-primary-strong focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-70 sm:flex-[2] sm:py-3"
						>
							{isSubmitting ? t.applySubmitting : t.applySubmitButton}
							{#if !isSubmitting}
								<ArrowRight class="h-4 w-4" />
							{/if}
						</button>
					</div>
				</form>
			</div>
		</div>
	</div>
{/if}
