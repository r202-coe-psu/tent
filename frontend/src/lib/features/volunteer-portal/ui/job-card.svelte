<script lang="ts">
	/**
	 * One card on กระดานงานอาสาสาธารณะ (CR-092 หน้าจอ 1).
	 *
	 * Renders exactly what the public projection carries — a job holds ONE shift template,
	 * not a list of dated shifts, so the card shows the template plus the 2-colour quota
	 * (`จองแล้ว` / `ว่าง`). The third quota colour, `dispatched`, is a back-office state
	 * and is deliberately folded into "not available" here rather than shown in public
	 * (see `PublicJobItem` in the FastAPI schemas).
	 */
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import Clock from '@lucide/svelte/icons/clock';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import Tag from '@lucide/svelte/icons/tag';
	import { isJobApplicable, type PublicJob, type VolunteerSkillOption } from '../domain/volunteer';
	import { skillLabels } from '../domain/skill-label';

	let {
		job,
		onapply,
		/** Master Data skill list, so CR-100 codes render as their Thai label. */
		skillOptions = []
	}: {
		job: PublicJob;
		onapply: (job: PublicJob) => void;
		skillOptions?: readonly VolunteerSkillOption[];
	} = $props();

	const skills = $derived(skillLabels(job.skills_required, skillOptions));

	const applicable = $derived(isJobApplicable(job));
	const controlled = $derived(job.tier === 'controlled' || job.requires_review);
	const filledPercent = $derived(
		job.quota > 0 ? Math.min(100, (job.slots_confirmed / job.quota) * 100) : 0
	);
	const template = $derived(job.shift_template);
	const timeText = $derived(
		template.start_time && template.end_time
			? `${template.start_time} - ${template.end_time} น.`
			: 'ยังไม่กำหนดเวลา'
	);
</script>

<div
	class="rounded-2xl border border-border bg-card p-6 shadow-sm transition-shadow hover:shadow-md"
>
	<div class="mb-4 flex flex-wrap items-center gap-2">
		{#if controlled}
			<span
				class="inline-flex items-center gap-1.5 rounded-full border border-accent-purple/30 bg-accent-purple/10 px-3 py-1 text-xs font-bold text-accent-purple"
			>
				<ShieldAlert class="h-3.5 w-3.5" />
				ภารกิจควบคุม (ต้องผ่านการตรวจคุณสมบัติ)
			</span>
		{:else}
			<span
				class="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-bold text-primary"
			>
				<Sparkles class="h-3.5 w-3.5" />
				ภารกิจทั่วไป
			</span>
		{/if}

		{#if !applicable}
			<span class="rounded-full bg-danger/15 px-3 py-1 text-xs font-bold text-danger">
				เต็มแล้ว / ปิดรับจอง
			</span>
		{:else if job.status === 'almost_full'}
			<span class="rounded-full bg-warning/15 px-3 py-1 text-xs font-bold text-warning-foreground">
				ใกล้เต็ม
			</span>
		{:else}
			<span
				class="inline-flex items-center gap-1.5 rounded-full bg-success/15 px-3 py-1 text-xs font-bold text-success"
			>
				<span class="h-2 w-2 rounded-full bg-success"></span>
				เปิดรับจอง
			</span>
		{/if}

		{#each skills as skill (skill.value)}
			<span
				class="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/30 px-3 py-1 text-xs font-medium text-muted-foreground"
			>
				<Tag class="h-3 w-3" />
				{skill.label}
			</span>
		{/each}
	</div>

	<h3 class="mb-2 text-xl font-bold text-primary">{job.title}</h3>
	{#if job.description}
		<p class="mb-4 text-sm text-muted-foreground">{job.description}</p>
	{/if}

	<div class="mb-6 flex items-start gap-2 text-muted-foreground">
		<MapPin class="mt-0.5 h-4 w-4 shrink-0" />
		<span class="text-sm font-medium">{job.shelter_name || job.shelter_code}</span>
	</div>

	<div class="rounded-xl border border-border bg-muted/5 p-4 sm:p-5">
		<div
			class="mb-4 flex flex-col justify-between gap-2 border-b border-border/50 pb-4 sm:flex-row sm:items-center"
		>
			<span class="flex items-center gap-2 text-sm font-bold text-primary">
				<CalendarDays class="h-4.5 w-4.5" />
				{template.shift_name || 'กะปฏิบัติงาน'}
			</span>
			<span class="flex items-center gap-1.5 text-sm font-medium text-primary">
				<Clock class="h-4 w-4" />
				{timeText}
			</span>
		</div>

		{#if template.days.length > 0}
			<p class="mb-4 text-xs text-muted-foreground">
				วันที่เปิดกะ: {template.days.join(' · ')}
			</p>
		{/if}

		<div class="mb-5">
			<div class="mb-2 flex justify-between text-xs">
				<span class="font-medium {!applicable ? 'text-muted-foreground/80' : ''}"
					>รับ {job.quota} คน (จองแล้ว {job.slots_confirmed})</span
				>
				<span class="font-bold {applicable ? 'text-success' : 'text-muted-foreground'}">
					{!applicable ? 'เต็มแล้ว (0 ที่)' : `ว่าง ${job.slots_remaining} ที่`}
				</span>
			</div>
			<div class="h-2 w-full overflow-hidden rounded-full bg-muted">
				<div
					class="h-full {applicable
						? 'bg-success'
						: 'bg-muted-foreground/35'} transition-all duration-500"
					style="width: {!applicable ? 100 : filledPercent}%"
				></div>
			</div>
		</div>

		<button
			type="button"
			onclick={() => onapply(job)}
			disabled={!applicable}
			class="flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold shadow-xs transition-all {!applicable
				? 'cursor-not-allowed border border-border/80 bg-muted text-muted-foreground opacity-70 select-none'
				: 'cursor-pointer bg-primary text-white hover:bg-primary-dark active:scale-[0.98]'}"
		>
			{!applicable ? '🔒 กะเต็มแล้ว' : controlled ? '🚀 ยื่นขอจองภารกิจนี้' : '🚀 จองภารกิจนี้'}
		</button>

		{#if applicable && controlled}
			<p class="mt-2 text-center text-2xs text-muted-foreground">
				ภารกิจนี้ต้องผ่านการตรวจคุณสมบัติ — การจองจะขึ้นสถานะ "รอการพิจารณา" ก่อน
			</p>
		{/if}
	</div>
</div>
