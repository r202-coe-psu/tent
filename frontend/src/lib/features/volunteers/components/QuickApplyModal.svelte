<script lang="ts">
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import Lock from '@lucide/svelte/icons/lock';
	import Building2 from '@lucide/svelte/icons/building-2';
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import User from '@lucide/svelte/icons/user';
	import Clock from '@lucide/svelte/icons/clock';
	import Tag from '@lucide/svelte/icons/tag';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';

	export interface QuickApplyFormData {
		fullName: string;
		nickname: string;
		phone: string;
		lineId: string;
		email: string;
		skills: string[];
		consentPdpa: boolean;
	}

	let {
		job,
		isOpen = $bindable(false),
		onSubmit
	} = $props<{
		job: {
			id: string;
			title: string;
			shelter: string;
			selectedShift?: { date: string; time: string; quota: number; confirmed: number };
		} | null;
		isOpen: boolean;
		onSubmit: (data: QuickApplyFormData) => void;
	}>();

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

	// Pre-defined skills based on mockup
	const availableSkills = [
		{ id: 'cooking', icon: '🍳', label: 'ครัว / ทำอาหาร / บรรจุกล่อง' },
		{ id: 'logistics', icon: '📦', label: 'ยกของ / ขนย้ายสิ่งของ' },
		{ id: 'medical', icon: '🩺', label: 'พยาบาล / ปฐมพยาบาล' },
		{ id: 'data_entry', icon: '💻', label: 'คีย์ข้อมูล / ธุรการ' },
		{ id: 'screening', icon: '📋', label: 'คัดกรอง / ประชาสัมพันธ์' },
		{ id: 'driver', icon: '🚗', label: 'ขับรถ / ขนส่งผู้ประสบภัย' },
		{ id: 'technician', icon: '🔧', label: 'ช่าง / ซ่อมบำรุง / ไฟฟ้า' }
	];

	async function handleSubmit(e: Event) {
		e.preventDefault();
		if (!formData.consentPdpa) {
			alert('กรุณายอมรับเงื่อนไข PDPA ก่อนดำเนินการต่อ');
			return;
		}

		isSubmitting = true;

		// Simulate API call delay
		await new Promise((r) => setTimeout(r, 800));

		onSubmit(formData);
		isSubmitting = false;
		isOpen = false;

		// Reset form
		formData = {
			fullName: '',
			nickname: '',
			phone: '',
			lineId: '',
			email: '',
			skills: [],
			consentPdpa: false
		};
	}

	function toggleSkill(skillId: string) {
		if (formData.skills.includes(skillId)) {
			formData.skills = formData.skills.filter((s) => s !== skillId);
		} else {
			formData.skills = [...formData.skills, skillId];
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
			class="relative z-10 flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-2xl"
		>
			<div class="overflow-y-auto">
				<!-- Header Section (Brand Primary) -->
				<div class="bg-primary-dark px-6 py-8 text-primary-foreground">
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
						<span class="flex items-center gap-1.5">
							<CalendarDays class="h-4 w-4 shrink-0" />
							กะวันที่ {job.selectedShift?.date || '13 มิ.ย. 2569'}
						</span>
					</div>
				</div>

				<form onsubmit={handleSubmit} class="px-6 py-6">
					<div class="space-y-8">
						<!-- Section 1 -->
						<section>
							<h3 class="mb-4 flex items-center gap-2 text-sm font-bold text-foreground">
								<User class="h-4 w-4 text-muted-foreground" />
								1. ข้อมูลประจำตัวอาสาสมัคร
							</h3>
							<div class="space-y-4">
								<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
									<div>
										<label for="fullName" class="mb-1.5 block text-xs font-bold text-foreground"
											>ชื่อ - นามสกุล <span class="text-danger">*</span></label
										>
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
										<label for="nickname" class="mb-1.5 block text-xs font-bold text-foreground"
											>ชื่อเล่น</label
										>
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
										<label for="phone" class="mb-1.5 block text-xs font-bold text-foreground"
											>เบอร์โทรศัพท์มือถือ <span class="text-danger">*</span></label
										>
										<input
											id="phone"
											type="tel"
											required
											bind:value={formData.phone}
											placeholder="08x-xxx-xxxx"
											class="w-full rounded-xl border border-border bg-card px-4 py-2.5 text-sm outline-hidden transition-all focus:border-primary focus:ring-1 focus:ring-primary"
										/>
									</div>
									<div>
										<label for="lineId" class="mb-1.5 block text-xs font-bold text-foreground"
											>Line ID <span class="font-normal text-muted-foreground">(ไม่บังคับ)</span
											></label
										>
										<input
											id="lineId"
											type="text"
											bind:value={formData.lineId}
											placeholder="เช่น kenglkla_vol"
											class="w-full rounded-xl border border-border bg-card px-4 py-2.5 text-sm outline-hidden transition-all focus:border-primary focus:ring-1 focus:ring-primary"
										/>
									</div>
									<div>
										<label for="email" class="mb-1.5 block text-xs font-bold text-foreground"
											>อีเมล <span class="font-normal text-muted-foreground">(ไม่บังคับ)</span
											></label
										>
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

						<!-- Section 2 -->
						<section>
							<h3 class="mb-4 flex items-center gap-2 text-sm font-bold text-foreground">
								<Clock class="h-4 w-4 text-muted-foreground" />
								2. เลือกรอบกะเวลาปฏิบัติงาน
							</h3>
							<!-- Selected Shift Card -->
							<div
								class="relative w-48 cursor-default rounded-xl border-2 border-primary/20 bg-card p-4 shadow-sm"
							>
								<div
									class="absolute top-3 right-3 flex h-4 w-4 items-center justify-center rounded-full border border-border bg-primary"
								>
									<CheckCircle2 class="h-3 w-3 text-white" />
								</div>
								<h4 class="text-sm font-bold">กะที่เลือก</h4>
								<p class="mt-1 text-xs font-bold text-primary">
									{job.selectedShift?.time || '08:00 - 12:00 น.'}
								</p>
								<div class="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted">
									<div
										class="h-full bg-success transition-all duration-500 ease-out"
										style="width: {job.selectedShift
											? (job.selectedShift.confirmed / job.selectedShift.quota) * 100
											: 0}%"
									></div>
								</div>
								<div class="mt-3 space-y-1.5 text-2xs font-bold">
									<div class="flex items-center gap-1.5 text-success">
										<span class="h-1.5 w-1.5 rounded-full bg-success"></span> ตอบรับแล้ว: {job
											.selectedShift?.confirmed || 0}
									</div>
									<div class="flex items-center gap-1.5 text-warning-foreground">
										<span class="h-1.5 w-1.5 rounded-full bg-warning"></span> เสนอแล้ว: 0
									</div>
									<div class="flex items-center gap-1.5 text-muted-foreground">
										<span class="h-1.5 w-1.5 rounded-full bg-muted-foreground/40"></span> ยังขาดอีก: {job.selectedShift
											? Math.max(0, job.selectedShift.quota - job.selectedShift.confirmed)
											: 10}
									</div>
								</div>
								<p class="mt-2 text-right text-2xs font-medium text-muted-foreground">
									(เป้า {job.selectedShift?.quota || 10} คน)
								</p>
							</div>
						</section>

						<!-- Section 3 -->
						<section>
							<div class="mb-4 flex items-center justify-between">
								<h3 class="flex items-center gap-2 text-sm font-bold text-foreground">
									<Tag class="h-4 w-4 text-muted-foreground" />
									3. ทักษะความสามารถ (เลือกได้มากกว่า 1 ข้อ)
								</h3>
								<span class="text-xs text-muted-foreground"
									>เลือกแล้ว {formData.skills.length} ทักษะ</span
								>
							</div>

							<div class="flex flex-wrap gap-2.5">
								{#each availableSkills as skill (skill.id)}
									{@const isSelected = formData.skills.includes(skill.id)}
									<button
										type="button"
										onclick={() => toggleSkill(skill.id)}
										class="flex cursor-pointer items-center gap-2 rounded-full border px-4 py-2 text-xs font-bold transition-all {isSelected
											? 'border-primary bg-primary text-primary-foreground shadow-sm'
											: 'border-border bg-card text-foreground hover:bg-muted'}"
									>
										{#if isSelected}
											<CheckCircle2 class="h-3.5 w-3.5" />
										{:else}
											<span class="text-base leading-none">{skill.icon}</span>
										{/if}
										{skill.label}
									</button>
								{/each}
							</div>
						</section>
					</div>

					<!-- Footer / Consent -->
					<div class="mt-8 space-y-5">
						<div class="rounded-xl border border-border bg-muted/10 p-4">
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
									<ShieldAlert class="h-3 w-3" /> Protected by reCAPTCHA v3
								</div>
							</div>
						</div>

						<div class="flex gap-3">
							<button
								type="button"
								onclick={() => (isOpen = false)}
								class="flex-1 cursor-pointer rounded-xl border border-border bg-muted/30 py-3.5 text-sm font-bold text-foreground transition-colors hover:bg-muted"
							>
								ยกเลิก
							</button>
							<button
								type="submit"
								disabled={isSubmitting || !formData.consentPdpa}
								class="flex flex-[2] cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary py-3.5 text-sm font-bold text-primary-foreground shadow-sm transition-all hover:bg-primary-strong disabled:cursor-not-allowed disabled:opacity-70"
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
