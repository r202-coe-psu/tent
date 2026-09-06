<script lang="ts">
	import { goto } from '$app/navigation';
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
	import { jobsI18n } from '../i18n/jobs.i18n';
	import type {
		PortalCredential,
		VolunteerProfile
	} from '$lib/features/volunteer-portal/domain/volunteer';

	export interface ShiftDetail {
		id: string;
		date: string;
		time: string;
		start_time?: string;
		end_time?: string;
		quota: number;
		confirmed: number;
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
		applicantCredential = null
	} = $props<{
		job: QuickApplyJob | null;
		isOpen: boolean;
		applicantProfile?: VolunteerProfile | null;
		applicantCredential?: PortalCredential | null;
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

	const isPortalApplicant = $derived(Boolean(applicantProfile));

	function renumberSectionTitle(title: string, number: number): string {
		return title.replace(/^\d+\.\s*/, `${number}. `);
	}

	const shiftSectionTitle = $derived(
		renumberSectionTitle(t.applyStep2Title, isPortalApplicant ? 1 : 2)
	);
	const skillsSectionTitle = $derived(
		renumberSectionTitle(t.applyStep3Title, isPortalApplicant ? 2 : 3)
	);

	interface SkillOption {
		id: string;
		key: string;
		label: string;
		category: 'operational' | 'controlled';
		controlled: boolean;
		description: string;
	}

	let masterSkills = $state<SkillOption[]>([]);
	let isLoadingSkills = $state(false);

	// Fetch skills from public master data endpoint (NO AUTH REQUIRED)
	async function loadPublicSkills() {
		try {
			isLoadingSkills = true;
			const res = await fetch('/api/public/v1/config/volunteer-skills');
			if (res.ok) {
				const data = await res.json();
				if (Array.isArray(data.volunteerSkills) && data.volunteerSkills.length > 0) {
					masterSkills = data.volunteerSkills.map(
						(i: { code: string; label: string; category?: string; description?: string }) => ({
							id: i.code,
							key: i.code,
							label: i.label,
							category: (i.category ?? 'operational') as 'operational' | 'controlled',
							controlled: i.category === 'controlled' || i.category === 'CONTROLLED',
							description: i.description ?? ''
						})
					);
					return;
				}
			}
		} catch {
			// Master Data is authoritative; do not expose implementation codes as labels.
		} finally {
			isLoadingSkills = false;
		}

		masterSkills = [];
	}

	$effect(() => {
		if (isOpen && masterSkills.length === 0) {
			loadPublicSkills();
		}
	});

	let selectedShiftId = $state<string>('');

	// Active shift selected by volunteer
	let activeShift = $derived.by<ShiftDetail | null>(() => {
		if (!job) return null;
		if (selectedShiftId && job.shifts && job.shifts.length > 0) {
			const found = job.shifts.find((s: ShiftDetail) => s.id === selectedShiftId);
			if (found) return found;
		}
		return job.selectedShift ?? job.shifts?.[0] ?? null;
	});

	$effect(() => {
		if (job?.selectedShift?.id) {
			selectedShiftId = job.selectedShift.id;
		} else if (job?.shifts?.[0]?.id) {
			selectedShiftId = job.shifts[0].id;
		}
	});

	let formData = $state({
		firstName: '',
		lastName: '',
		nickname: '',
		phone: '',
		lineId: '',
		email: '',
		skills: [] as string[],
		consentPdpa: false
	});

	$effect(() => {
		if (!isOpen || !applicantProfile) return;
		formData.firstName = applicantProfile.first_name;
		formData.lastName = applicantProfile.last_name;
		formData.nickname = applicantProfile.nickname ?? '';
		formData.phone = applicantProfile.phone_masked;
		formData.email = applicantProfile.email ?? '';
		formData.skills = applicantProfile.skills.map(canonicalSkillId);
	});

	let isSubmitting = $state(false);
	let errorMessage = $state<string | null>(null);
	const siteKey = env.PUBLIC_RECAPTCHA_SITE_KEY || '';
	const captchaEnabled = isCaptchaKeyConfigured(siteKey);

	async function captchaToken(): Promise<string | null> {
		if (!captchaEnabled) return '';
		if (!window.grecaptcha) return null;
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
		const normalized = value.trim().toLowerCase();
		return (
			masterSkills.find(
				(skill) =>
					skill.id === value ||
					skill.key === value ||
					skill.label.trim().toLowerCase() === normalized
			)?.id ?? value
		);
	}

	function skillMatchesJob(skillCode: string): boolean {
		const target = canonicalSkillId(skillCode);
		return (
			job?.skills_required?.some((required: string) => canonicalSkillId(required) === target) ??
			false
		);
	}

	async function handleSubmit(e: Event) {
		e.preventDefault();
		if (!formData.consentPdpa) {
			errorMessage = t.errPdpaRequired;
			return;
		}
		if (!job || !activeShift) {
			errorMessage = t.errNoJobSelected;
			return;
		}
		if (
			isPortalApplicant &&
			applicantCredential &&
			'token' in applicantCredential &&
			!formData.phone.trim()
		) {
			errorMessage = 'กรุณากรอกเบอร์โทรศัพท์ที่ใช้สมัครเดิมเพื่อสมัครภารกิจจาก portal';
			return;
		}

		errorMessage = null;
		isSubmitting = true;

		try {
			const recaptchaToken = await captchaToken();
			if (recaptchaToken === null) {
				errorMessage = t.errRecaptchaFailed;
				return;
			}
			const firstName = formData.firstName.trim();
			const lastName = formData.lastName.trim();
			const fullName = `${firstName} ${lastName}`.trim();

			// Parse times from activeShift
			let startTime = activeShift.start_time ?? '08:00';
			let endTime = activeShift.end_time ?? '12:00';
			if (!activeShift.start_time && activeShift.time) {
				const match = activeShift.time.match(/(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/);
				if (match) {
					startTime = match[1];
					endTime = match[2];
				}
			}

			// Format shift date
			let shiftDate = activeShift.date;
			const ddmmyyyy = shiftDate.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
			if (ddmmyyyy) {
				shiftDate = `${ddmmyyyy[3]}-${ddmmyyyy[2]}-${ddmmyyyy[1]}`;
			}

			const rawApplicantPhone =
				applicantCredential && 'phone' in applicantCredential
					? applicantCredential.phone
					: formData.phone;
			const cleanPhone = rawApplicantPhone.replace(/[-\s]/g, '').trim();
			const targetJobId = job.id.startsWith('job:') ? job.id : `job:${job.id}`;

			// Direct CouchDB Apply via SvelteKit Server BFF (No FastAPI dependency)
			const couchRes = await fetch('/api/public/v1/volunteer/apply', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					job_id: targetJobId,
					shelter_code: job.shelter_code || undefined,
					applicant: {
						first_name: firstName,
						last_name: lastName,
						phone: cleanPhone,
						email: isPortalApplicant ? null : formData.email.trim() || null,
						skills: formData.skills
					},
					selected_shift: activeShift
						? {
								shift_id: activeShift.id || undefined,
								date: shiftDate,
								start_time: startTime,
								end_time: endTime
							}
						: undefined,
					recaptcha_token: recaptchaToken || undefined
				})
			});

			const couchData = await couchRes.json().catch(() => null);

			if (!couchRes.ok || !couchData?.success) {
				const errorMsg =
					couchData?.message ||
					(couchRes.status === 409
						? t.errDuplicatePhoneOrShift
						: couchRes.status === 429
							? t.errRateLimited
							: t.errApplyGeneric);
				errorMessage = errorMsg;
				toast.error(errorMsg);
				return;
			}

			const trackingToken = couchData.tracking_token;

			toast.success(t.toastApplySuccess);

			onSubmit?.({
				firstName,
				lastName,
				fullName,
				phone: formData.phone,
				email: formData.email,
				skills: formData.skills,
				trackingToken
			});

			isOpen = false;

			// Reset form
			formData = {
				firstName: '',
				lastName: '',
				nickname: '',
				phone: '',
				lineId: '',
				email: '',
				skills: [],
				consentPdpa: false
			};

			if (trackingToken) {
				await goto(`/volunteer/ticket/${encodeURIComponent(trackingToken)}`);
			}
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : t.errApplyGeneric;
			errorMessage = msg;
			toast.error(msg);
		} finally {
			isSubmitting = false;
		}
	}
</script>

<svelte:head>
	{#if captchaEnabled}
		<script src="https://www.google.com/recaptcha/api.js?render={siteKey}" async defer></script>
	{/if}
</svelte:head>

{#if isOpen && job}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
		<!-- Backdrop -->
		<div
			class="absolute inset-0 bg-background/80 backdrop-blur-sm"
			onclick={() => (isOpen = false)}
			onkeydown={(e) => e.key === 'Escape' && (isOpen = false)}
			role="button"
			tabindex="0"
			aria-label="Close modal"
		></div>

		<!-- Modal -->
		<div
			class="relative z-10 flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-2xl"
		>
			<div class="overflow-y-auto">
				<!-- Header Section -->
				<div class="relative bg-primary-dark px-6 py-8 text-primary-foreground">
					<button
						type="button"
						onclick={() => (isOpen = false)}
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
						{#if activeShift}
							<span class="flex items-center gap-1.5">
								<CalendarDays class="h-4 w-4 shrink-0" />
								{t.shiftDateLabel}
								{activeShift.date}
							</span>
						{/if}
					</div>
				</div>

				<form onsubmit={handleSubmit} class="px-6 py-6">
					{#if errorMessage}
						<div
							class="mb-6 flex items-start gap-2.5 rounded-xl border border-danger/30 bg-danger/10 p-3.5 text-xs text-danger"
						>
							<AlertCircle class="mt-0.5 h-4 w-4 shrink-0" />
							<span>{errorMessage}</span>
						</div>
					{/if}

					{#if isPortalApplicant && applicantCredential && 'token' in applicantCredential}
						<div
							class="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-900"
						>
							<p class="font-bold">คุณเข้าสู่ระบบด้วย QR Code ตั๋วอาสาสมัคร</p>
							<p class="mt-1 leading-relaxed">
								เพื่อสมัครภารกิจใหม่ กรุณากรอกเบอร์โทรศัพท์ที่ใช้สมัครเดิม
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
								oninput={(e) => {
									formData.phone = e.currentTarget.value.replace(/[-\s]/g, '');
								}}
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
												oninput={(e) => {
													formData.phone = e.currentTarget.value.replace(/[-\s]/g, '');
												}}
												placeholder="0812345678"
												class="w-full rounded-xl border border-border bg-card px-4 py-2.5 text-sm outline-hidden transition-all focus:border-primary focus:ring-1 focus:ring-primary"
											/>
											<p class="mt-1 text-3xs text-muted-foreground">
												{t.applyPhoneLimitHint}
											</p>
										</div>
									</div>
									<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
										<div>
											<label for="lineId" class="mb-1.5 block text-xs font-bold text-foreground">
												{t.applyLineId}
												<span class="font-normal text-muted-foreground">{t.applyOptional}</span>
											</label>
											<input
												id="lineId"
												type="text"
												bind:value={formData.lineId}
												readonly={isPortalApplicant}
												aria-readonly={isPortalApplicant}
												placeholder="เช่น kenglkla_vol"
												class="w-full rounded-xl border border-border bg-card px-4 py-2.5 text-sm outline-hidden transition-all focus:border-primary focus:ring-1 focus:ring-primary"
											/>
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

							<!-- Shift Cards Grid -->
							<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
								{#if job.shifts && job.shifts.length > 0}
									{#each job.shifts as shift (shift.id)}
										{@const isSelected = activeShift?.id === shift.id}
										{@const remaining = Math.max(0, shift.quota - shift.confirmed)}
										{@const isFull = remaining === 0}
										<button
											type="button"
											disabled={isFull}
											onclick={() => (selectedShiftId = shift.id)}
											class="relative flex cursor-pointer flex-col rounded-2xl border-2 p-4 text-left transition-all {isSelected
												? 'border-primary bg-primary/5 shadow-sm'
												: isFull
													? 'cursor-not-allowed border-border/60 bg-muted/20 opacity-60'
													: 'border-border bg-card hover:border-primary/40 hover:bg-muted/30'}"
										>
											<div class="mb-1 flex items-center justify-between">
												<span class="text-xs font-bold text-foreground">
													{t.applyDatePrefix}
													{shift.date}
												</span>
												{#if isSelected}
													<span class="rounded-full bg-primary p-0.5 text-primary-foreground">
														<Check class="h-3 w-3" />
													</span>
												{/if}
											</div>
											<p class="text-sm font-black text-primary">
												{shift.time || `${shift.start_time} - ${shift.end_time} น.`}
											</p>

											<div class="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
												<div
													class="h-full bg-success transition-all"
													style="width: {shift.quota > 0
														? (shift.confirmed / shift.quota) * 100
														: 0}%"
												></div>
											</div>

											<div class="mt-2 flex items-center justify-between text-2xs font-bold">
												<span class="text-success"
													>{t.applyShiftReceived}: {shift.confirmed} {t.peopleUnit}</span
												>
												<span
													class={remaining <= 2
														? 'text-warning-foreground'
														: 'text-muted-foreground'}
												>
													{isFull
														? t.shiftFull
														: `${t.applyShiftNeedMore}: ${remaining} ${t.peopleUnit}`}
												</span>
											</div>
										</button>
									{/each}
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
											{activeShift.time || `${activeShift.start_time} - ${activeShift.end_time} น.`}
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

							{#if isLoadingSkills}
								<div class="flex items-center gap-2 py-4 text-xs text-muted-foreground">
									<Loader2 class="h-4 w-4 animate-spin text-primary" />
									<span>{t.applyLoadingSkills}</span>
								</div>
							{:else}
								<div class="flex flex-wrap gap-2.5">
									{#each masterSkills as skill (skill.id)}
										{@const isSelected = formData.skills.includes(skill.id)}
										{@const isControlled = skill.controlled}
										{@const isRequiredByJob = skillMatchesJob(skill.id)}
										<button
											type="button"
											onclick={() => toggleSkill(skill.key || skill.id || skill.label)}
											class="flex cursor-pointer items-center gap-2 rounded-2xl border px-4 py-2.5 text-xs font-bold transition-all {isSelected
												? 'border-primary bg-primary text-primary-foreground shadow-sm ring-2 ring-primary/20'
												: isRequiredByJob
													? 'border-primary/50 bg-primary/5 text-foreground hover:bg-primary/10'
													: 'border-border bg-card text-foreground hover:bg-muted'}"
										>
											{#if isSelected}
												<CheckCircle2 class="h-3.5 w-3.5" />
											{:else if isControlled}
												<ShieldAlert class="h-3.5 w-3.5 text-warning-foreground" />
											{:else}
												<Sparkles class="h-3.5 w-3.5 text-success" />
											{/if}

											<span>{skill.label}</span>

											{#if isControlled}
												<span
													class="rounded-full px-1.5 py-0.5 text-3xs font-black {isSelected
														? 'bg-white/20 text-white'
														: 'bg-warning/20 text-warning-foreground'}"
												>
													{t.applyControlledSkillBadge}
												</span>
											{/if}

											{#if isRequiredByJob && !isSelected}
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

						<div class="flex gap-3">
							<button
								type="button"
								onclick={() => (isOpen = false)}
								class="flex-1 cursor-pointer rounded-2xl border border-border bg-muted/30 py-3.5 text-sm font-bold text-foreground transition-colors hover:bg-muted"
							>
								{t.applyCancelButton}
							</button>
							<button
								type="submit"
								disabled={isSubmitting || !formData.consentPdpa}
								class="flex flex-[2] cursor-pointer items-center justify-center gap-2 rounded-2xl bg-primary py-3.5 text-sm font-bold text-primary-foreground shadow-sm transition-all hover:bg-primary-strong disabled:cursor-not-allowed disabled:opacity-70"
							>
								{isSubmitting ? t.applySubmitting : t.applySubmitButton}
								{#if !isSubmitting}
									<ArrowRight class="h-4 w-4" />
								{/if}
							</button>
						</div>
					</div>
				</form>
			</div>
		</div>
	</div>
{/if}
