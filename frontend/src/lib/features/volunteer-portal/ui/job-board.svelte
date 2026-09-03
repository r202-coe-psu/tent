<script lang="ts">
	/**
	 * ตลาดงานอาสาสมัคร — the public job board (CR-092 หน้าจอ 1, AC-094-04).
	 *
	 * Reads real projected jobs through `GET /api/public/v1/volunteer/jobs`. Only the
	 * shelter filter goes to the server (FastAPI indexes `shelter_code` and `skill`);
	 * the free-text search and the status chips are decided here from the projected
	 * quota, because there is no server-side index for either and the list a shelter
	 * holds is small enough to filter in the browser.
	 *
	 * The shelter dropdown is built from what came back rather than a hard-coded list,
	 * so a new shelter appears on the board the moment the worker projects its first job.
	 */
	import Briefcase from '@lucide/svelte/icons/briefcase';
	import Filter from '@lucide/svelte/icons/filter';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Search from '@lucide/svelte/icons/search';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import { useVolunteerJobs, useVolunteerSkills } from '../application/queries';
	import { isJobApplicable, type PublicJob } from '../domain/volunteer';
	import { skillLabel } from '../domain/skill-label';
	import JobCard from './job-card.svelte';
	import QuickApplyModal from './quick-apply-modal.svelte';

	type StatusFilter = 'all' | 'open' | 'near_full' | 'controlled';

	let searchQuery = $state('');
	let statusFilter = $state<StatusFilter>('all');
	let shelterCode = $state('all');

	// The shelter pick is the one filter the server can answer, so it is part of the key.
	const jobsQuery = useVolunteerJobs(() =>
		shelterCode === 'all' ? {} : { shelter_code: shelterCode }
	);
	const jobs = $derived(jobsQuery.data ?? []);

	/**
	 * Master Data skill list (CR-100): the board spans shelters, so it reads the
	 * global list — a shelter-only skill still shows, because an unresolved
	 * value falls back to itself.
	 */
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

	function matchesStatus(job: PublicJob, filter: StatusFilter): boolean {
		if (filter === 'open') return isJobApplicable(job);
		// "ใกล้เต็ม" is the projection's own status plus the last-few-seats case, so a job
		// the worker has not re-flagged yet still surfaces to someone hunting for one.
		if (filter === 'near_full') {
			return isJobApplicable(job) && (job.status === 'almost_full' || job.slots_remaining <= 2);
		}
		if (filter === 'controlled') return job.tier === 'controlled' || job.requires_review;
		return true;
	}

	const filteredJobs = $derived(
		jobs.filter((job) => matchesSearch(job, searchQuery) && matchesStatus(job, statusFilter))
	);

	let selectedJob = $state<PublicJob | null>(null);
	let applyOpen = $state(false);

	function openApply(job: PublicJob) {
		selectedJob = job;
		applyOpen = true;
	}

	const chipClass = 'cursor-pointer rounded-full px-5 py-2 text-xs font-bold transition-all border';
</script>

<div class="space-y-6">
	<div class="rounded-3xl border border-border/80 bg-card p-6 shadow-sm md:p-8">
		<div class="mb-8 flex flex-col justify-between gap-6 md:flex-row md:items-start">
			<div>
				<h2
					class="flex items-center gap-3 text-xl font-black tracking-tight text-primary sm:text-2xl"
				>
					<Briefcase class="h-6 w-6 text-primary" />
					ตลาดงานอาสาสมัครในศูนย์พักพิง
				</h2>
				<p class="mt-2 text-sm text-muted-foreground">
					เลือกภารกิจและกะที่คุณสะดวก แล้วกดจองเพื่อรับบัตรตั๋วดิจิทัล (QR Code Pass) ทันที
					ไม่ต้องรอรหัส SMS
				</p>
			</div>

			<div class="relative w-full shrink-0 md:w-[340px]">
				<input
					type="search"
					bind:value={searchQuery}
					placeholder="ค้นหาชื่องาน, ทักษะ, หรือชื่อศูนย์..."
					aria-label="ค้นหาภารกิจ"
					class="w-full rounded-2xl border border-border/80 bg-card px-5 py-3.5 pl-11 text-sm shadow-sm outline-hidden transition-all placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary"
				/>
				<Search class="absolute top-4 left-4 h-4.5 w-4.5 text-muted-foreground" />
			</div>
		</div>

		<div class="flex flex-col gap-5">
			<div class="flex flex-wrap items-center gap-3">
				<div class="mr-2 flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
					<Filter class="h-4 w-4" />
					<span>ตัวกรอง:</span>
				</div>

				<button
					type="button"
					onclick={() => (statusFilter = 'all')}
					class="{chipClass} {statusFilter === 'all'
						? 'border-primary bg-primary text-white shadow-sm'
						: 'border-border/80 bg-card text-muted-foreground hover:bg-muted/30'}"
				>
					ทั้งหมด ({jobs.length})
				</button>

				<button
					type="button"
					onclick={() => (statusFilter = 'open')}
					class="{chipClass} {statusFilter === 'open'
						? 'border-success bg-success/15 text-success shadow-sm'
						: 'border-success/30 bg-success/5 text-success hover:bg-success/10'}"
				>
					<span class="mr-1.5 inline-block h-2 w-2 rounded-full bg-success"></span>
					เปิดรับจอง (Open)
				</button>

				<button
					type="button"
					onclick={() => (statusFilter = 'near_full')}
					class="{chipClass} {statusFilter === 'near_full'
						? 'border-warning bg-warning/20 text-warning-foreground shadow-sm'
						: 'border-warning/40 bg-warning/10 text-warning-foreground hover:bg-warning/20'}"
				>
					<span class="mr-1.5 inline-block h-2.5 w-2.5 rounded-full bg-warning"></span>
					ใกล้เต็ม (Near Full)
				</button>

				<button
					type="button"
					onclick={() => (statusFilter = 'controlled')}
					class="{chipClass} {statusFilter === 'controlled'
						? 'border-accent-purple bg-accent-purple/15 text-accent-purple shadow-sm'
						: 'border-accent-purple/30 bg-accent-purple/5 text-accent-purple hover:bg-accent-purple/10'}"
				>
					🩺 ทักษะวิชาชีพ/ควบคุม
				</button>
			</div>

			<div class="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
				<span class="w-auto text-sm font-bold text-muted-foreground sm:w-[70px]">ศูนย์:</span>
				<div class="relative w-full sm:w-[340px]">
					<select
						bind:value={shelterCode}
						aria-label="ศูนย์พักพิง"
						class="w-full cursor-pointer appearance-none rounded-xl border border-border/80 bg-muted/20 px-4 py-2.5 pl-10 text-sm font-bold outline-hidden transition-all focus:border-primary focus:ring-1 focus:ring-primary"
					>
						<option value="all">📍 ทุกศูนย์พักพิง</option>
						{#each shelters as shelter (shelter.code)}
							<option value={shelter.code}>{shelter.name}</option>
						{/each}
					</select>
					<MapPin class="absolute top-2.5 left-3.5 h-4 w-4 text-danger" />
				</div>
			</div>
		</div>
	</div>

	{#if jobsQuery.isPending}
		<div class="flex flex-col gap-5">
			{#each [0, 1, 2] as key (key)}
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
		<div class="flex flex-col gap-5">
			{#each filteredJobs as job (job.job_id)}
				<JobCard {job} onapply={openApply} {skillOptions} />
			{:else}
				<div
					class="flex flex-col items-center justify-center rounded-3xl border-2 border-dashed border-border/80 bg-card p-12 text-center text-muted-foreground"
				>
					<Briefcase class="mb-3 h-10 w-10 text-muted-foreground/40" />
					<h3 class="text-base font-bold text-foreground">
						{jobs.length === 0
							? 'ยังไม่มีภารกิจเปิดรับจองในขณะนี้'
							: 'ไม่พบภารกิจที่ตรงกับเงื่อนไขการค้นหา'}
					</h3>
					<p class="mt-1 text-xs text-muted-foreground">
						{jobs.length === 0
							? 'ศูนย์พักพิงจะประกาศภารกิจใหม่เมื่อมีความต้องการกำลังพล'
							: 'โปรดลองเปลี่ยนตัวกรองหรือคำค้นหาเพื่อดูภารกิจอื่น'}
					</p>
				</div>
			{/each}
		</div>
	{/if}
</div>

<QuickApplyModal bind:open={applyOpen} job={selectedJob} {skillOptions} />
