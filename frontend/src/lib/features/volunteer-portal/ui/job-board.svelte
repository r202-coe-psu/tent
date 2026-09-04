<script lang="ts">
	/**
	 * ตลาดงานอาสาสมัคร — the public job board (CR-092 หน้าจอ 1, AC-094-04).
	 *
	 * Reads real projected jobs through `GET /api/public/v1/volunteer/jobs`. Only the
	 * shelter filter goes to the server (FastAPI indexes `shelter_code` and `skill`);
	 * the free-text search is decided here from the projected quota.
	 */
	import Briefcase from '@lucide/svelte/icons/briefcase';
	import Building2 from '@lucide/svelte/icons/building-2';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Search from '@lucide/svelte/icons/search';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import { useVolunteerJobs, useVolunteerSkills } from '../application/queries';
	import { type PublicJob, type ScheduleShift } from '../domain/volunteer';
	import { skillLabel } from '../domain/skill-label';
	import JobCard from './job-card.svelte';
	import QuickApplyModal from './quick-apply-modal.svelte';

	let {
		bookedShifts = [],
		volunteerSkills = []
	}: {
		bookedShifts?: readonly ScheduleShift[];
		volunteerSkills?: readonly string[];
	} = $props();

	let searchQuery = $state('');
	let shelterCode = $state('all');

	const jobsQuery = useVolunteerJobs(() =>
		shelterCode === 'all' ? {} : { shelter_code: shelterCode }
	);
	const jobs = $derived(jobsQuery.data ?? []);

	const skillsQuery = useVolunteerSkills();
	const skillOptions = $derived(skillsQuery.data ?? []);

	const shelters = $derived.by(() => {
		const byCode: Record<string, string> = {};
		for (const job of jobs) {
			byCode[job.shelter_code] ??= job.shelter_name || job.shelter_code;
		}
		return Object.entries(byCode).map(([code, name]) => ({ code, name }));
	});

	function matchesSearch(job: PublicJob, term: string): boolean {
		const needle = term.trim().toLowerCase();
		if (!needle) return true;
		return (
			job.title.toLowerCase().includes(needle) ||
			job.description.toLowerCase().includes(needle) ||
			(job.shelter_name || job.shelter_code).toLowerCase().includes(needle) ||
			job.skills_required.some((skill) =>
				skillLabel(skill, skillOptions).toLowerCase().includes(needle)
			)
		);
	}

	const filteredJobs = $derived(jobs.filter((job) => matchesSearch(job, searchQuery)));

	let selectedJob = $state<PublicJob | null>(null);
	let applyOpen = $state(false);

	function openApply(job: PublicJob) {
		selectedJob = job;
		applyOpen = true;
	}
</script>

<div class="space-y-6">
	<!-- ── SEARCH & SHELTER FILTER ROW (Screenshot 4 Design) ───────────── -->
	<div class="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
		<div class="relative flex-1">
			<Search
				class="pointer-events-none absolute top-1/2 left-4 h-4 w-4 -translate-y-1/2 text-slate-400"
			/>
			<input
				type="search"
				bind:value={searchQuery}
				placeholder="ค้นหาภารกิจที่เหมาะสมกับทักษะ..."
				aria-label="ค้นหาภารกิจ"
				class="w-full rounded-xl border border-slate-200 bg-white py-2.5 pr-4 pl-10 text-sm text-slate-800 shadow-xs transition-all placeholder:text-slate-400 focus:border-[#0A2647] focus:ring-1 focus:ring-[#0A2647] focus:outline-none"
			/>
		</div>

		<div class="relative sm:w-72">
			<Building2
				class="pointer-events-none absolute top-1/2 left-4 h-4 w-4 -translate-y-1/2 text-slate-400"
			/>
			<select
				bind:value={shelterCode}
				aria-label="ศูนย์พักพิง"
				class="w-full cursor-pointer appearance-none rounded-xl border border-slate-200 bg-white py-2.5 pr-10 pl-10 text-sm font-medium text-slate-700 shadow-xs transition-all focus:border-[#0A2647] focus:ring-1 focus:ring-[#0A2647] focus:outline-none"
			>
				<option value="all">ทุกศูนย์พักพิง</option>
				{#each shelters as shelter (shelter.code)}
					<option value={shelter.code}>{shelter.name}</option>
				{/each}
			</select>
			<ChevronDown
				class="pointer-events-none absolute top-1/2 right-3.5 h-4 w-4 -translate-y-1/2 text-slate-400"
			/>
		</div>
	</div>

	<!-- ── JOB CARDS GRID ──────────────────────────────────────────────── -->
	{#if jobsQuery.isPending}
		<div class="grid grid-cols-1 gap-5 lg:grid-cols-2">
			{#each [0, 1] as key (key)}
				<Skeleton class="h-64 rounded-2xl" />
			{/each}
		</div>
	{:else if jobsQuery.isError}
		<p
			class="rounded-2xl border border-destructive/20 bg-destructive/5 p-6 text-sm text-destructive"
		>
			โหลดกระดานงานอาสาไม่สำเร็จ: {jobsQuery.error instanceof Error
				? jobsQuery.error.message
				: 'เกิดข้อผิดพลาด'}
		</p>
	{:else}
		<div class="grid grid-cols-1 gap-5 lg:grid-cols-2">
			{#each filteredJobs as job (job.job_id)}
				<JobCard {job} onapply={openApply} {skillOptions} {bookedShifts} {volunteerSkills} />
			{:else}
				<div
					class="col-span-full flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-white p-12 text-center text-slate-500"
				>
					<Briefcase class="mb-3 h-10 w-10 text-slate-300" />
					<h3 class="text-base font-bold text-slate-800">
						{jobs.length === 0
							? 'ยังไม่มีภารกิจเปิดรับสมัครในขณะนี้'
							: 'ไม่พบภารกิจที่ตรงกับเงื่อนไขการค้นหา'}
					</h3>
					<p class="mt-1 text-xs text-slate-400">
						{jobs.length === 0
							? 'ศูนย์พักพิงจะประกาศภารกิจใหม่เมื่อมีความต้องการกำลังพล'
							: 'โปรดลองเปลี่ยนคำค้นหาหรือเลือกศูนย์พักพิงอื่น'}
					</p>
				</div>
			{/each}
		</div>
	{/if}
</div>

<QuickApplyModal bind:open={applyOpen} job={selectedJob} {skillOptions} />
