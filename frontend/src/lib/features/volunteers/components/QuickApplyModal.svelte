<script lang="ts">
	import { goto } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import Lock from '@lucide/svelte/icons/lock';
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
	import { SKILL_MASTER } from '../domain/skill-master';

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
		shifts?: ShiftDetail[];
		selectedShift?: ShiftDetail;
		skills_required?: string[];
	}

	let {
		job,
		isOpen = $bindable(false),
		onSubmit
	} = $props<{
		job: QuickApplyJob | null;
		isOpen: boolean;
		onSubmit?: (data: {
			fullName: string;
			phone: string;
			email: string;
			skills: string[];
			trackingToken?: string;
		}) => void;
	}>();

	interface SkillOption {
		id: string;
		key: string;
		label: string;
		category: 'operational' | 'controlled';
		controlled: boolean;
		description: string;
		icon: string;
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
							description: i.description ?? '',
							icon: i.category === 'controlled' ? '🩺' : '✨'
						})
					);
					return;
				}
			}
		} catch {
			// Fallback to static skills if endpoint unreachable
		} finally {
			isLoadingSkills = false;
		}

		// Fallback to SKILL_MASTER
		masterSkills = SKILL_MASTER.map((s) => ({
			id: s.key,
			key: s.key,
			label: s.label,
			category: s.controlled ? ('controlled' as const) : ('operational' as const),
			controlled: s.controlled,
			description: s.description,
			icon: s.icon
		}));
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
		fullName: '',
		nickname: '',
		phone: '',
		lineId: '',
		email: '',
		skills: [] as string[],
		consentPdpa: false
	});

	let isSubmitting = $state(false);
	let errorMessage = $state<string | null>(null);

	function toggleSkill(skillLabelOrCode: string) {
		if (formData.skills.includes(skillLabelOrCode)) {
			formData.skills = formData.skills.filter((s) => s !== skillLabelOrCode);
		} else {
			formData.skills = [...formData.skills, skillLabelOrCode];
		}
	}

	async function handleSubmit(e: Event) {
		e.preventDefault();
		if (!formData.consentPdpa) {
			errorMessage = 'กรุณายอมรับเงื่อนไข PDPA ก่อนดำเนินการต่อ';
			return;
		}
		if (!job || !activeShift) {
			errorMessage = 'ไม่พบข้อมูลงานหรือกะเวลาที่เลือก';
			return;
		}

		errorMessage = null;
		isSubmitting = true;

		try {
			const parts = formData.fullName.trim().split(/\s+/);
			const firstName = parts[0] || 'จิตอาสา';
			const lastName = parts.slice(1).join(' ') || '-';

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

			const cleanPhone = formData.phone.replace(/[-\s]/g, '').trim();

			// Call public application API endpoint (NO-AUTH FLOW + UNIQUE PHONE CHECK)
			const res = await fetch('/api/public/v1/volunteer/apply', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					job_id: job.id.startsWith('job:') ? job.id : `job:${job.id}`,
					applicant: {
						first_name: firstName,
						last_name: lastName,
						phone: cleanPhone,
						email: formData.email.trim() || null,
						skills: formData.skills
					},
					selected_shift: {
						date: shiftDate,
						start_time: startTime,
						end_time: endTime
					}
				})
			});

			const data = await res.json();

			if (!res.ok || !data.success) {
				if (res.status === 409 || data.error === 'DUPLICATE_PHONE') {
					const dupMsg =
						data.message ||
						'เบอร์โทรศัพท์นี้ได้ทำการสมัครงานนี้ไว้แล้ว ไม่สามารถใช้เบอร์เดิมสมัครซ้ำได้';
					errorMessage = dupMsg;
					toast.error(dupMsg);
					return;
				}
				throw new Error(data.message || 'เกิดข้อผิดพลาดในการส่งใบสมัคร');
			}

			toast.success('ส่งใบสมัครสำเร็จ! คุณจะได้รับตั๋วดิจิทัล (QR Code) ทันที');

			onSubmit?.({
				fullName: formData.fullName,
				phone: formData.phone,
				email: formData.email,
				skills: formData.skills,
				trackingToken: data.tracking_token
			});

			isOpen = false;

			// Reset form
			const tokenToOpen = data.tracking_token;
			formData = {
				fullName: '',
				nickname: '',
				phone: '',
				lineId: '',
				email: '',
				skills: [],
				consentPdpa: false
			};

			if (tokenToOpen) {
				await goto(`/volunteers/ticket/${tokenToOpen}`);
			}
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการส่งใบสมัคร';
			errorMessage = msg;
			toast.error(msg);
		} finally {
			isSubmitting = false;
		}
	}
</script>

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

					<div
						class="mb-4 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-xs font-medium"
					>
						<span>ระบบสมัครงานจิตอาสาภาคประชาชน (NO-AUTH FLOW)</span>
						<span class="flex items-center gap-1 border-l border-white/30 pl-2">
							<Lock class="h-3 w-3" /> ปลอดภัย ไม่ต้องใช้รหัสผ่าน
						</span>
					</div>
					<h2 class="mb-3 text-2xl font-bold">{job.title}</h2>
					<div class="flex flex-wrap items-center gap-4 text-xs text-white/80">
						<span class="flex items-center gap-1.5">
							<Building2 class="h-4 w-4 shrink-0" />
							{job.shelter}
						</span>
						{#if activeShift}
							<span class="flex items-center gap-1.5">
								<CalendarDays class="h-4 w-4 shrink-0" />
								กะวันที่ {activeShift.date}
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

					<div class="space-y-8">
						<!-- Section 1: ข้อมูลผู้สมัคร -->
						<section>
							<h3 class="mb-4 flex items-center gap-2 text-sm font-bold text-foreground">
								<User class="h-4 w-4 text-muted-foreground" />
								1. ข้อมูลประจำตัวอาสาสมัคร
							</h3>
							<div class="space-y-4">
								<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
									<div>
										<label for="fullName" class="mb-1.5 block text-xs font-bold text-foreground">
											ชื่อ - นามสกุล <span class="text-danger">*</span>
										</label>
										<input
											id="fullName"
											type="text"
											required
											bind:value={formData.fullName}
											placeholder="เช่น นายเก่งกล้า งานอาสา"
											class="w-full rounded-xl border border-border bg-card px-4 py-2.5 text-sm outline-hidden transition-all focus:border-primary focus:ring-1 focus:ring-primary"
										/>
									</div>
									<div>
										<label for="nickname" class="mb-1.5 block text-xs font-bold text-foreground">
											ชื่อเล่น
										</label>
										<input
											id="nickname"
											type="text"
											bind:value={formData.nickname}
											placeholder="เช่น กล้า, พิมพ์"
											class="w-full rounded-xl border border-border bg-card px-4 py-2.5 text-sm outline-hidden transition-all focus:border-primary focus:ring-1 focus:ring-primary"
										/>
									</div>
								</div>
								<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
									<div>
										<label for="phone" class="mb-1.5 block text-xs font-bold text-foreground">
											เบอร์โทรศัพท์มือถือ <span class="text-danger">*</span>
										</label>
										<input
											id="phone"
											type="tel"
											required
											bind:value={formData.phone}
											oninput={(e) => {
												formData.phone = e.currentTarget.value.replace(/[-\s]/g, '');
											}}
											placeholder="0812345678"
											class="w-full rounded-xl border border-border bg-card px-4 py-2.5 text-sm outline-hidden transition-all focus:border-primary focus:ring-1 focus:ring-primary"
										/>
										<p class="mt-1 text-3xs text-muted-foreground">
											1 เบอร์ต่อ 1 สิทธิ์การสมัครงานนี้
										</p>
									</div>
									<div>
										<label for="lineId" class="mb-1.5 block text-xs font-bold text-foreground">
											Line ID <span class="font-normal text-muted-foreground">(ไม่บังคับ)</span>
										</label>
										<input
											id="lineId"
											type="text"
											bind:value={formData.lineId}
											placeholder="เช่น kenglkla_vol"
											class="w-full rounded-xl border border-border bg-card px-4 py-2.5 text-sm outline-hidden transition-all focus:border-primary focus:ring-1 focus:ring-primary"
										/>
									</div>
									<div>
										<label for="email" class="mb-1.5 block text-xs font-bold text-foreground">
											อีเมล <span class="font-normal text-muted-foreground">(ไม่บังคับ)</span>
										</label>
										<input
											id="email"
											type="email"
											bind:value={formData.email}
											placeholder="volunteer@example.com"
											class="w-full rounded-xl border border-border bg-card px-4 py-2.5 text-sm outline-hidden transition-all focus:border-primary focus:ring-1 focus:ring-primary"
										/>
									</div>
								</div>
							</div>
						</section>

						<!-- Section 2: เลือกรอบกะเวลาปฏิบัติงานจาก Data จริง -->
						<section>
							<div class="mb-4 flex items-center justify-between">
								<h3 class="flex items-center gap-2 text-sm font-bold text-foreground">
									<Clock class="h-4 w-4 text-muted-foreground" />
									2. เลือกรอบกะเวลาปฏิบัติงาน (Shifts)
								</h3>
								{#if job.shifts && job.shifts.length > 1}
									<span class="text-xs text-muted-foreground"
										>มี {job.shifts.length} กะให้เลือก</span
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
													วันที่ {shift.date}
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
												<span class="text-success">รับแล้ว: {shift.confirmed} คน</span>
												<span
													class={remaining <= 2
														? 'text-warning-foreground'
														: 'text-muted-foreground'}
												>
													{isFull ? 'กะเต็มแล้ว' : `ยังขาดอีก: ${remaining} คน`}
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
												>วันที่ {activeShift.date}</span
											>
											<span class="rounded-full bg-primary p-0.5 text-primary-foreground">
												<Check class="h-3 w-3" />
											</span>
										</div>
										<p class="mt-1 text-sm font-black text-primary">
											{activeShift.time || `${activeShift.start_time} - ${activeShift.end_time} น.`}
										</p>
										<p class="mt-2 text-2xs text-muted-foreground">
											โควตา: {activeShift.quota} คน (ยืนยันแล้ว {activeShift.confirmed} คน)
										</p>
									</div>
								{/if}
							</div>
						</section>

						<!-- Section 3: ทักษะจาก Master Data (CR-099) -->
						<section>
							<div class="mb-3 flex items-center justify-between">
								<div>
									<h3 class="flex items-center gap-2 text-sm font-bold text-foreground">
										<Tag class="h-4 w-4 text-muted-foreground" />
										3. ทักษะความสามารถ (ดึงจาก Master Data)
									</h3>
									<p class="mt-0.5 text-2xs text-muted-foreground">
										เลือกทักษะที่คุณมีความพร้อมหรือความชำนาญ (สามารถเลือกได้มากกว่า 1 ข้อ)
									</p>
								</div>
								<span class="text-xs font-bold text-primary">
									เลือกแล้ว {formData.skills.length} ทักษะ
								</span>
							</div>

							{#if isLoadingSkills}
								<div class="flex items-center gap-2 py-4 text-xs text-muted-foreground">
									<Loader2 class="h-4 w-4 animate-spin text-primary" />
									<span>กำลังโหลดรายการทักษะมาตรฐาน...</span>
								</div>
							{:else}
								<div class="flex flex-wrap gap-2.5">
									{#each masterSkills as skill (skill.id)}
										{@const isSelected =
											formData.skills.includes(skill.label) || formData.skills.includes(skill.id)}
										{@const isControlled = skill.controlled}
										{@const isRequiredByJob =
											job.skills_required?.includes(skill.label) ||
											job.skills_required?.includes(skill.id)}
										<button
											type="button"
											onclick={() => toggleSkill(skill.label)}
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
													ทักษะควบคุม
												</span>
											{/if}

											{#if isRequiredByJob && !isSelected}
												<span
													class="rounded-full bg-primary/20 px-1.5 py-0.5 text-3xs font-bold text-primary"
												>
													ตรงกับงานนี้
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
										<strong class="text-foreground">ความยินยอม PDPA:</strong> ข้าพเจ้ายินยอมให้ศูนย์พักพิงและระบบจัดสรรจิตอาสาเก็บรวบรวมและประมวลผลข้อมูลส่วนบุคคลข้างต้น
										เพื่อการประสานงานและจัดสรรงานจิตอาสาตาม พ.ร.บ. คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562
									</p>
								</div>
							</label>
							<div
								class="mt-4 flex items-center justify-between border-t border-border/50 pt-3 text-2xs text-muted-foreground"
							>
								<div class="flex items-center gap-1.5">
									<ShieldAlert class="h-3 w-3" /> Protected by Smart Shelter System & reCAPTCHA
								</div>
							</div>
						</div>

						<div class="flex gap-3">
							<button
								type="button"
								onclick={() => (isOpen = false)}
								class="flex-1 cursor-pointer rounded-2xl border border-border bg-muted/30 py-3.5 text-sm font-bold text-foreground transition-colors hover:bg-muted"
							>
								ยกเลิก
							</button>
							<button
								type="submit"
								disabled={isSubmitting || !formData.consentPdpa}
								class="flex flex-[2] cursor-pointer items-center justify-center gap-2 rounded-2xl bg-primary py-3.5 text-sm font-bold text-primary-foreground shadow-sm transition-all hover:bg-primary-strong disabled:cursor-not-allowed disabled:opacity-70"
							>
								{isSubmitting ? 'กำลังส่งข้อมูล...' : 'ยืนยันการสมัครและรับตั๋วดิจิทัล'}
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
