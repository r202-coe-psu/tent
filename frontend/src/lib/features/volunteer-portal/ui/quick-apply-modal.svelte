<script lang="ts">
	/**
	 * "จองภารกิจ" — the No-Auth booking form (CR-092 FR-VOL-02 / AC-VOL-02).
	 *
	 * The spec calls this an application (`job_application`) and it still is one on the
	 * wire; what the volunteer does on this screen is book a place, which is why the copy
	 * says จอง. A job flagged `requires_review` is genuinely a request rather than a
	 * booking — it holds no seat until a manager approves — so those buttons say
	 * "ยื่นขอจอง" instead of promising something the server will not do.
	 *
	 * Writes for real through `POST /api/public/v1/volunteer/jobs/{id}/apply`. The BFF
	 * throttles on IP *and* phone and verifies reCAPTCHA v3; the token is minted here with
	 * the same helper `public-register/ui/booking-form.svelte` uses, including the
	 * `window.__captchaToken` E2E hook (not a bypass — the server still verifies whatever
	 * it receives).
	 *
	 * On success the volunteer lands on their own ตารางทำงาน, signed in with the tracking
	 * token the response carries — the booking they just made is only useful to them from
	 * there, and that token is the only route back to their pass (a later lookup by phone
	 * hands out a read-only view token instead). The handoff goes through `sessionStorage`
	 * rather than the URL so the token stays out of history and out of any referrer.
	 *
	 * The fields are exactly `volunteerApplySchema` — first/last name are separate because
	 * the API stores them separately, and the PDPA consent box is a client-side gate, not
	 * a stored field (there is nowhere in `job_application` to put it).
	 */
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import Building2 from '@lucide/svelte/icons/building-2';
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import Clock from '@lucide/svelte/icons/clock';
	import Lock from '@lucide/svelte/icons/lock';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import Tag from '@lucide/svelte/icons/tag';
	import User from '@lucide/svelte/icons/user';
	import { toast } from 'svelte-sonner';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { env } from '$env/dynamic/public';
	import { isCaptchaKeyConfigured } from '$lib/features/public-register';
	import { useApplyToJobMutation } from '../application/queries';
	import {
		PORTAL_TOKEN_HANDOFF_KEY,
		volunteerApplySchema,
		type PublicJob,
		type VolunteerSkillOption
	} from '../domain/volunteer';
	import { skillLabels } from '../domain/skill-label';

	let {
		job,
		open = $bindable(false),
		/** Master Data skill list, so CR-100 codes render as their Thai label. */
		skillOptions = []
	}: {
		job: PublicJob | null;
		open?: boolean;
		skillOptions?: readonly VolunteerSkillOption[];
	} = $props();

	/**
	 * The chips show labels but `skills` keeps the job's own stored values
	 * (master codes from CR-100) — that is what the application must carry, so
	 * the back office and the controlled-skill gate see the same value the job
	 * asked for.
	 */
	const requiredSkills = $derived(skillLabels(job?.skills_required ?? [], skillOptions));

	const siteKey = env.PUBLIC_RECAPTCHA_SITE_KEY || '';
	const captchaEnabled = isCaptchaKeyConfigured(siteKey);

	const apply = useApplyToJobMutation();
	const controlled = $derived(job?.requires_review ?? false);

	let firstName = $state('');
	let lastName = $state('');
	let phone = $state('');
	let nationalId = $state('');
	let email = $state('');
	let shiftDate = $state('');
	let skills = $state<string[]>([]);
	let consentPdpa = $state(false);
	let formError = $state('');

	// Nothing typed survives a different job being opened — the skills list below is the
	// job's own required skills, so carrying them over would tick boxes that do not exist.
	$effect(() => {
		if (!open) {
			firstName = '';
			lastName = '';
			phone = '';
			nationalId = '';
			email = '';
			shiftDate = '';
			skills = [];
			consentPdpa = false;
			formError = '';
		}
	});

	function toggleSkill(skill: string) {
		skills = skills.includes(skill) ? skills.filter((s) => s !== skill) : [...skills, skill];
	}

	/** Resolve a reCAPTCHA token. `''` = not configured here, `null` = it failed. */
	async function captchaToken(): Promise<string | null> {
		const injected = window.__captchaToken || '';
		if (injected) return injected;
		if (!captchaEnabled) return '';
		if (window.grecaptcha) {
			try {
				return await window.grecaptcha.execute(siteKey, { action: 'volunteer_apply' });
			} catch {
				return null;
			}
		}
		return null;
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!job) return;
		formError = '';

		if (!consentPdpa) {
			formError = 'กรุณายอมรับเงื่อนไข PDPA ก่อนจองภารกิจ';
			return;
		}

		const parsed = volunteerApplySchema.safeParse({
			first_name: firstName,
			last_name: lastName,
			phone,
			national_id: nationalId,
			email,
			skills,
			shift_date: shiftDate
		});
		if (!parsed.success) {
			formError = parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง';
			return;
		}

		const token = await captchaToken();
		if (token === null) {
			formError = 'ไม่สามารถยืนยัน reCAPTCHA ได้ กรุณาลองใหม่อีกครั้ง';
			return;
		}

		try {
			const result = await apply.mutateAsync({
				jobId: job.job_id,
				input: { ...parsed.data, ...(token ? { captchaToken: token } : {}) }
			});
			open = false;
			toast.success(
				result.status === 'confirmed'
					? 'จองภารกิจสำเร็จ! ตั๋วดิจิทัลของคุณพร้อมใช้งานแล้ว'
					: 'ส่งคำขอจองแล้ว — รอเจ้าหน้าที่ตรวจคุณสมบัติ'
			);
			try {
				sessionStorage.setItem(PORTAL_TOKEN_HANDOFF_KEY, result.tracking_token);
			} catch {
				// Private mode, or storage disabled. The portal then opens signed out and
				// the volunteer signs in with the number they just typed — worth landing
				// them there anyway rather than failing a booking that already succeeded.
			}
			await goto(resolve('/volunteers/portal'));
		} catch (err) {
			formError = err instanceof Error ? err.message : 'จองภารกิจไม่สำเร็จ';
			toast.error(formError);
		}
	}
</script>

<svelte:head>
	{#if captchaEnabled}
		<script src="https://www.google.com/recaptcha/api.js?render={siteKey}" async defer></script>
	{/if}
</svelte:head>

{#if open && job}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
		<div
			class="absolute inset-0 bg-background/80 backdrop-blur-sm"
			onclick={() => (open = false)}
			onkeydown={(e) => e.key === 'Escape' && (open = false)}
			role="button"
			tabindex="0"
			aria-label="ปิดหน้าต่างจองภารกิจ"
		></div>

		<div
			class="relative z-10 flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-2xl"
		>
			<div class="overflow-y-auto">
				<div class="bg-primary-dark px-6 py-8 text-primary-foreground">
					<div
						class="mb-4 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-xs font-medium"
					>
						<span>ระบบจองภารกิจจิตอาสาภาคประชาชน (NO-AUTH FLOW)</span>
						<span class="flex items-center gap-1 border-l border-white/30 pl-2">
							<Lock class="h-3 w-3" /> ไม่ต้องใช้รหัสผ่าน ไม่ต้องรอ SMS
						</span>
					</div>
					<h2 class="mb-3 text-2xl font-bold">{job.title}</h2>
					<div class="flex flex-wrap items-center gap-4 text-xs text-white/80">
						<span class="flex items-center gap-1.5">
							<Building2 class="h-4 w-4 shrink-0" />
							{job.shelter_name || job.shelter_code}
						</span>
						<span class="flex items-center gap-1.5">
							<Clock class="h-4 w-4 shrink-0" />
							{job.shift_template.start_time && job.shift_template.end_time
								? `${job.shift_template.start_time} - ${job.shift_template.end_time} น.`
								: 'ยังไม่กำหนดเวลา'}
						</span>
						<span class="flex items-center gap-1.5">
							<CheckCircle2 class="h-4 w-4 shrink-0" />
							ว่าง {job.slots_remaining} ที่
						</span>
					</div>
				</div>

				<form onsubmit={submit} class="px-6 py-6">
					<div class="space-y-8">
						<section>
							<h3 class="mb-4 flex items-center gap-2 text-sm font-bold text-foreground">
								<User class="h-4 w-4 text-muted-foreground" />
								1. ข้อมูลประจำตัวอาสาสมัคร
							</h3>
							<div class="space-y-4">
								<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
									<div>
										<label for="apply-first-name" class="mb-1.5 block text-xs font-bold">
											ชื่อ <span class="text-danger">*</span>
										</label>
										<input
											id="apply-first-name"
											type="text"
											required
											bind:value={firstName}
											placeholder="เช่น เก่งกล้า"
											class="w-full rounded-xl border border-border bg-card px-4 py-2.5 text-sm outline-hidden focus:border-primary focus:ring-1 focus:ring-primary"
										/>
									</div>
									<div>
										<label for="apply-last-name" class="mb-1.5 block text-xs font-bold">
											นามสกุล <span class="text-danger">*</span>
										</label>
										<input
											id="apply-last-name"
											type="text"
											required
											bind:value={lastName}
											placeholder="เช่น งานอาสา"
											class="w-full rounded-xl border border-border bg-card px-4 py-2.5 text-sm outline-hidden focus:border-primary focus:ring-1 focus:ring-primary"
										/>
									</div>
								</div>
								<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
									<div>
										<label for="apply-phone" class="mb-1.5 block text-xs font-bold">
											เบอร์โทรศัพท์มือถือ <span class="text-danger">*</span>
										</label>
										<input
											id="apply-phone"
											type="tel"
											required
											inputmode="tel"
											bind:value={phone}
											placeholder="08x-xxx-xxxx"
											class="w-full rounded-xl border border-border bg-card px-4 py-2.5 text-sm outline-hidden focus:border-primary focus:ring-1 focus:ring-primary"
										/>
										<p class="mt-1 text-3xs text-muted-foreground">
											ใช้เบอร์นี้เข้าพอร์ทัลและค้นหาตั๋วของคุณภายหลัง
										</p>
									</div>
									<div>
										<label for="apply-national-id" class="mb-1.5 block text-xs font-bold">
											เลขบัตรประชาชน
											<span class="font-normal text-muted-foreground">(ไม่บังคับ)</span>
										</label>
										<input
											id="apply-national-id"
											type="text"
											inputmode="numeric"
											bind:value={nationalId}
											placeholder="13 หลัก"
											class="w-full rounded-xl border border-border bg-card px-4 py-2.5 text-sm outline-hidden focus:border-primary focus:ring-1 focus:ring-primary"
										/>
									</div>
									<div>
										<label for="apply-email" class="mb-1.5 block text-xs font-bold">
											อีเมล <span class="font-normal text-muted-foreground">(ไม่บังคับ)</span>
										</label>
										<input
											id="apply-email"
											type="email"
											bind:value={email}
											placeholder="volunteer@example.com"
											class="w-full rounded-xl border border-border bg-card px-4 py-2.5 text-sm outline-hidden focus:border-primary focus:ring-1 focus:ring-primary"
										/>
									</div>
								</div>
							</div>
						</section>

						<section>
							<h3 class="mb-4 flex items-center gap-2 text-sm font-bold text-foreground">
								<CalendarDays class="h-4 w-4 text-muted-foreground" />
								2. วันที่สะดวกปฏิบัติงาน
								<span class="font-normal text-muted-foreground">(ไม่บังคับ)</span>
							</h3>
							{#if job.shift_template.days.length > 0}
								<select
									bind:value={shiftDate}
									aria-label="วันที่สะดวกปฏิบัติงาน"
									class="w-full rounded-xl border border-border bg-card px-4 py-2.5 text-sm outline-hidden focus:border-primary focus:ring-1 focus:ring-primary sm:w-72"
								>
									<option value="">ให้เจ้าหน้าที่จัดกะให้</option>
									{#each job.shift_template.days as day (day)}
										<option value={day}>{day}</option>
									{/each}
								</select>
							{:else}
								<input
									type="date"
									bind:value={shiftDate}
									aria-label="วันที่สะดวกปฏิบัติงาน"
									class="w-full rounded-xl border border-border bg-card px-4 py-2.5 text-sm outline-hidden focus:border-primary focus:ring-1 focus:ring-primary sm:w-72"
								/>
							{/if}
						</section>

						<section>
							<div class="mb-4 flex items-center justify-between">
								<h3 class="flex items-center gap-2 text-sm font-bold text-foreground">
									<Tag class="h-4 w-4 text-muted-foreground" />
									3. ทักษะที่ภารกิจนี้ต้องการ
								</h3>
								<span class="text-xs text-muted-foreground">เลือกแล้ว {skills.length} ทักษะ</span>
							</div>

							{#if requiredSkills.length > 0}
								<div class="flex flex-wrap gap-2.5">
									{#each requiredSkills as skill (skill.value)}
										{@const selected = skills.includes(skill.value)}
										<button
											type="button"
											onclick={() => toggleSkill(skill.value)}
											class="flex cursor-pointer items-center gap-2 rounded-full border px-4 py-2 text-xs font-bold transition-all {selected
												? 'border-primary bg-primary text-primary-foreground shadow-sm'
												: 'border-border bg-card text-foreground hover:bg-muted'}"
										>
											{#if selected}
												<CheckCircle2 class="h-3.5 w-3.5" />
											{/if}
											{skill.label}
										</button>
									{/each}
								</div>
							{:else}
								<p class="text-xs text-muted-foreground">
									ภารกิจนี้ไม่ได้กำหนดทักษะเฉพาะ — สมัครได้เลย
								</p>
							{/if}
						</section>
					</div>

					<div class="mt-8 space-y-5">
						<div class="rounded-xl border border-border bg-muted/10 p-4">
							<label class="flex cursor-pointer items-start gap-3">
								<input
									type="checkbox"
									required
									bind:checked={consentPdpa}
									class="mt-0.5 h-4 w-4 shrink-0 rounded border-border text-primary focus:ring-primary"
								/>
								<p class="text-xs leading-relaxed text-muted-foreground">
									<strong class="text-foreground">ความยินยอม PDPA:</strong>
									ข้าพเจ้ายินยอมให้ศูนย์พักพิงและระบบจัดสรรจิตอาสาเก็บรวบรวมและประมวลผลข้อมูลส่วนบุคคลข้างต้น
									เพื่อการประสานงานและจัดสรรงานจิตอาสาตาม พ.ร.บ. คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562
								</p>
							</label>
							{#if captchaEnabled}
								<div
									class="mt-4 flex items-center gap-1.5 border-t border-border/50 pt-3 text-2xs text-muted-foreground"
								>
									<ShieldAlert class="h-3 w-3" /> Protected by reCAPTCHA v3
								</div>
							{/if}
						</div>

						{#if formError}
							<p class="text-sm font-medium text-destructive" role="alert">{formError}</p>
						{/if}

						<div class="flex gap-3">
							<button
								type="button"
								onclick={() => (open = false)}
								class="flex-1 cursor-pointer rounded-xl border border-border bg-muted/30 py-3.5 text-sm font-bold transition-colors hover:bg-muted"
							>
								ยกเลิก
							</button>
							<button
								type="submit"
								disabled={apply.isPending || !consentPdpa}
								class="flex flex-[2] cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary py-3.5 text-sm font-bold text-primary-foreground shadow-sm transition-all hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-70"
							>
								{apply.isPending
									? 'กำลังส่งข้อมูล...'
									: controlled
										? 'ยื่นขอจองและรับตั๋วดิจิทัล'
										: 'ยืนยันการจองและรับตั๋วดิจิทัล'}
								{#if !apply.isPending}
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
