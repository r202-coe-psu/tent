<script lang="ts">
	/**
	 * One card on กระดานงานอาสาสาธารณะ (CR-092 หน้าจอ 1).
	 *
	 * Styled according to the Civic Light Volunteer Portal design, matching Screenshot 4.
	 */
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import CalendarCheck from '@lucide/svelte/icons/calendar-check';
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import Check from '@lucide/svelte/icons/check';
	import Clock from '@lucide/svelte/icons/clock';
	import Lock from '@lucide/svelte/icons/lock';
	import Send from '@lucide/svelte/icons/send';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import Tag from '@lucide/svelte/icons/tag';
	import {
		isJobApplicable,
		type PublicJob,
		type ScheduleShift,
		type VolunteerSkillOption
	} from '../domain/volunteer';
	import { skillLabels } from '../domain/skill-label';

	let {
		job,
		onapply,
		skillOptions = [],
		bookedShifts = [],
		volunteerSkills = []
	}: {
		job: PublicJob;
		onapply: (job: PublicJob) => void;
		skillOptions?: readonly VolunteerSkillOption[];
		bookedShifts?: readonly ScheduleShift[];
		volunteerSkills?: readonly string[];
	} = $props();

	const skills = $derived(skillLabels(job.skills_required, skillOptions));
	const applicable = $derived(isJobApplicable(job));
	const controlled = $derived(job.tier === 'controlled' || job.requires_review);
	const template = $derived(job.shift_template);

	const timeText = $derived(
		template.start_time && template.end_time
			? `${template.start_time} - ${template.end_time} น.`
			: '08:00 - 12:00 น.'
	);

	function formatDayText(d?: string): string {
		if (!d) return '2026-06-13';
		const lower = d.toLowerCase();
		if (lower === 'mon') return 'วันจันทร์';
		if (lower === 'tue') return 'วันอังคาร';
		if (lower === 'wed') return 'วันพุธ';
		if (lower === 'thu') return 'วันพฤหัสบดี';
		if (lower === 'fri') return 'วันศุกร์';
		if (lower === 'sat') return 'วันเสาร์';
		if (lower === 'sun') return 'วันอาทิตย์';
		return d;
	}

	function formatShiftName(name?: string): string {
		if (!name) return 'กะเช้า';
		const lower = name.toLowerCase();
		if (lower.includes('เช้า') || lower === 'morning') return 'กะเช้า';
		if (lower.includes('บ่าย') || lower === 'afternoon') return 'กะบ่าย';
		if (lower.includes('ดึก') || lower === 'night') return 'กะดึก';
		if (lower === 'custom') return 'กะพิเศษ';
		return name;
	}

	const shiftDateText = $derived(
		formatDayText(template.days && template.days.length > 0 ? template.days[0] : '2026-06-13')
	);
	const shiftNameText = $derived(formatShiftName(template.shift_name));

	const filledPercent = $derived(
		job.quota > 0 ? Math.min(100, (job.slots_confirmed / job.quota) * 100) : 0
	);

	const matchedSkillsCount = $derived(
		job.skills_required.filter((req) => volunteerSkills.includes(req)).length
	);

	const isRegistered = $derived(
		bookedShifts.some((s) => s.job_id === job.job_id || s.job_title === job.title)
	);

	const clashingShift = $derived.by(() => {
		if (isRegistered) return null;
		for (const s of bookedShifts) {
			if (s.status === 'completed' || s.status === 'cancelled') continue;
			const shiftNameMatch =
				template.shift_name &&
				s.shift &&
				(s.shift.includes(template.shift_name) || template.shift_name.includes(s.shift));
			const timeMatch =
				template.start_time && s.start_ts && s.start_ts.includes(template.start_time);
			const defaultMatch =
				(template.shift_name || 'กะเช้า').includes('กะเช้า') &&
				(s.shift || 'กะเช้า').includes('กะเช้า');

			if ((shiftNameMatch || timeMatch || defaultMatch) && s.job_title !== job.title) {
				return s;
			}
		}
		return null;
	});
</script>

<div
	class="flex h-full flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-xs transition-all hover:border-slate-300 hover:shadow-sm"
>
	<div>
		<!-- ── HEADER: SHELTER NAME & BADGES ─────────────────────────────── -->
		<div class="mb-2.5 flex items-center justify-between gap-2">
			<span
				class="max-w-[180px] truncate text-xs font-semibold text-slate-500 sm:max-w-xs"
				title={job.shelter_name || job.shelter_code}
			>
				{job.shelter_name || job.shelter_code}
			</span>

			<div class="flex shrink-0 items-center gap-1.5">
				{#if !applicable}
					<span
						class="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 text-xs font-medium text-rose-700"
					>
						เต็มแล้ว / ปิดรับสมัคร
					</span>
				{:else if job.status === 'almost_full'}
					<span
						class="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700"
					>
						ใกล้เต็ม
					</span>
				{:else}
					<span
						class="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700"
					>
						<span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
						เปิดรับสมัคร
					</span>
				{/if}

				{#if controlled}
					<span
						class="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 text-xs font-medium text-rose-700"
					>
						ระดับหัวหน้า/ผู้ดูแล
					</span>
				{:else}
					<span
						class="rounded-full border border-emerald-200 bg-emerald-50/60 px-2.5 py-0.5 text-xs font-medium text-emerald-700"
					>
						ระดับปฏิบัติงาน (Operational)
					</span>
				{/if}
			</div>
		</div>

		<!-- ── TITLE & DESCRIPTION ───────────────────────────────────────── -->
		<h3
			class="line-clamp-2 flex min-h-[2.75rem] items-center text-base leading-snug font-bold text-slate-900 sm:text-lg"
		>
			{job.title}
		</h3>

		<p
			class="mt-1.5 line-clamp-2 flex min-h-[2.25rem] items-center text-xs leading-relaxed text-slate-600 sm:text-sm"
		>
			{job.description || 'ไม่มีรายละเอียดเพิ่มเติมสำหรับภารกิจนี้'}
		</p>

		<!-- ── SPECIAL REQUIREMENT / NOTICE BOX (FOR CONTROLLED VS GENERAL) ───── -->
		{#if controlled}
			<div
				class="mt-2.5 flex items-center gap-2 rounded-xl border border-blue-200/80 bg-blue-50/70 px-3 py-2 text-xs text-blue-900"
			>
				<ShieldCheck class="h-4 w-4 shrink-0 text-blue-600" />
				<span class="truncate text-xs font-semibold text-blue-950">
					ภารกิจกึ่งเจ้าหน้าที่ • ยื่นขอปฏิบัติงานและตรวจคุณสมบัติหน้างาน
				</span>
			</div>
		{:else}
			<div
				class="mt-2.5 flex items-center gap-2 rounded-xl border border-emerald-200/60 bg-emerald-50/50 px-3 py-2 text-xs text-emerald-900"
			>
				<Check class="h-4 w-4 shrink-0 text-emerald-600" />
				<span class="truncate text-xs font-semibold text-emerald-950">
					ภารกิจทั่วไป • พร้อมเริ่มงานได้ทันที ไม่ต้องตรวจคุณสมบัติล่วงหน้า
				</span>
			</div>
		{/if}

		<!-- ── SKILLS TAGS ───────────────────────────────────────────────── -->
		<div class="mt-3 flex min-h-[1.75rem] flex-wrap items-center gap-1.5">
			{#if skills.length > 0}
				{#each skills as skill (skill.value)}
					<span
						class="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-medium text-slate-600"
					>
						<Tag class="h-3 w-3 text-slate-400" />
						{skill.label}
					</span>
				{/each}
			{:else}
				<span
					class="inline-flex items-center gap-1 rounded-full border border-slate-200/60 bg-slate-50/80 px-2.5 py-0.5 text-xs font-medium text-slate-500"
				>
					<Tag class="h-3 w-3 text-slate-400" />
					ไม่จำกัดทักษะเฉพาะ (ทุกคนร่วมทำได้)
				</span>
			{/if}
		</div>
	</div>

	<!-- ── SHIFT SELECTION & ACTION ──────────────────────────────────── -->
	<div class="mt-4">
		<p class="mb-2 text-xs font-bold text-slate-500">เลือกช่วงเวลาเพื่อจองภารกิจ:</p>

		<div class="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3.5">
			<!-- Shift Date & Time -->
			<div class="flex flex-wrap items-center justify-between gap-2 text-xs">
				<div class="flex items-center gap-2 font-bold text-slate-800">
					<CalendarDays class="h-3.5 w-3.5 text-slate-500" />
					<span>{shiftDateText}</span>
					<span
						class="rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-2xs font-semibold text-blue-800"
					>
						{shiftNameText}
					</span>
				</div>
				<div class="flex items-center gap-1.5 font-medium text-slate-600">
					<Clock class="h-3.5 w-3.5 text-slate-400" />
					<span>{timeText}</span>
				</div>
			</div>

			<!-- Capacity Stats Row -->
			<div class="flex flex-wrap items-center gap-2 text-[11px]">
				<span
					class="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700"
				>
					<span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
					ตรงกับทักษะ {matchedSkillsCount}
				</span>
				<span
					class="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 font-semibold text-amber-700"
				>
					<span class="h-1.5 w-1.5 rounded-full bg-amber-500"></span>
					เสนอแล้ว {job.slots_confirmed}
				</span>
				<span
					class="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-100 px-2 py-0.5 font-medium text-slate-600"
				>
					<span class="h-1.5 w-1.5 rounded-full bg-slate-400"></span>
					ยังขาดอีก: {job.slots_remaining} (เป้า {job.quota} คน)
				</span>
			</div>

			<!-- Progress Bar & Actions -->
			<div
				class="flex flex-col items-stretch justify-between gap-3 pt-1 sm:flex-row sm:items-center"
			>
				<div class="flex-1">
					<div class="h-2 w-full overflow-hidden rounded-full bg-slate-200">
						<div
							class="h-full {applicable
								? 'bg-emerald-500'
								: 'bg-slate-400'} transition-all duration-500"
							style="width: {filledPercent}%"
						></div>
					</div>
				</div>

				<!-- Action Button / State -->
				{#if isRegistered}
					<div
						class="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl border border-emerald-300 bg-emerald-100/90 px-4 py-2 text-xs font-bold text-emerald-800"
					>
						<Check class="h-4 w-4 text-emerald-700" />
						<span>ลงทะเบียนแล้ว</span>
					</div>
				{:else if clashingShift}
					<div
						class="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl border border-amber-300 bg-amber-100/80 px-3.5 py-2 text-xs font-bold text-amber-800"
					>
						<AlertTriangle class="h-3.5 w-3.5 text-amber-600" />
						<span>เวลาชนกับกะที่จองไว้</span>
					</div>
				{:else}
					<button
						type="button"
						onclick={() => onapply(job)}
						disabled={!applicable}
						class="inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl bg-[#0A2647] px-5 py-2 text-xs font-bold text-white shadow-xs transition-all hover:bg-[#081F38] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
					>
						{#if !applicable}
							<Lock class="h-3.5 w-3.5" />
							<span>กะเต็มแล้ว</span>
						{:else if controlled}
							<Send class="h-3.5 w-3.5" />
							<span>ยื่นขอปฏิบัติงานนี้ (รอพิจารณา)</span>
						{:else}
							<CalendarCheck class="h-3.5 w-3.5" />
							<span>จองภารกิจนี้</span>
						{/if}
					</button>
				{/if}
			</div>

			<!-- Clash Warning Box (Screenshot 4) -->
			{#if clashingShift}
				<div
					class="mt-2.5 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/90 p-2.5 text-xs text-amber-900"
				>
					<AlertTriangle class="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
					<div>
						<p class="font-bold text-amber-950">เวลาชนกับกะที่จองไว้</p>
						<p class="mt-0.5 text-[11px] leading-snug text-amber-800">
							คุณมีภารกิจ "{clashingShift.job_title}" ในช่วงเวลา {timeText}
						</p>
					</div>
				</div>
			{/if}
		</div>
	</div>
</div>
