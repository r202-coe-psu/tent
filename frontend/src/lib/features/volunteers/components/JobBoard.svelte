<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import Filter from '@lucide/svelte/icons/filter';
	import Search from '@lucide/svelte/icons/search';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Briefcase from '@lucide/svelte/icons/briefcase';
	import Tag from '@lucide/svelte/icons/tag';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import { fetchVolunteerSkills } from '$lib/features/volunteer-portal/data/volunteer-api';
	import { findSkillOption, skillLabel } from '$lib/features/volunteer-portal/domain/skill-label';
	import type {
		PortalCredential,
		VolunteerProfile,
		VolunteerSkillOption
	} from '$lib/features/volunteer-portal/domain/volunteer';
	import { languageStore } from '$lib/stores/language.svelte';
	import { jobsI18n } from '$lib/features/volunteers/i18n/jobs.i18n';
	import JobCard from './JobCard.svelte';
	import QuickApplyModal, { type QuickApplyJob } from './QuickApplyModal.svelte';

	let {
		applicantProfile = null,
		applicantCredential = null
	}: {
		applicantProfile?: VolunteerProfile | null;
		applicantCredential?: PortalCredential | null;
	} = $props();

	const t = $derived(jobsI18n[languageStore.current]);

	interface DisplayShift {
		id: string;
		date: string;
		time: string;
		start_time?: string;
		end_time?: string;
		quota: number;
		confirmed: number;
		applicants_count: number;
	}

	interface DisplayJobCard {
		id: string;
		title: string;
		shelter: string;
		shelter_code?: string;
		description: string;
		shifts: DisplayShift[];
		tags: { label: string; variant: 'default' | 'success' | 'warning' | 'purple' | 'outline' }[];
		skills_required?: string[];
		applicants_count: number;
		isControlled: boolean;
	}

	interface RawPublicJobShift {
		shift_id?: string;
		id?: string;
		date: string;
		start_time: string;
		end_time: string;
		quota: number;
		slots_confirmed?: number;
		applicants_count?: number;
		confirmed?: number;
	}

	interface RawPublicJob {
		_id?: string;
		job_id?: string;
		title: string;
		description?: string;
		shelter_code?: string;
		shelter_name?: string;
		tier?: string;
		status?: string;
		quota?: number;
		skills_required?: string[];
		shifts?: RawPublicJobShift[];
		shift_template?: {
			shift_name?: string;
			start_time?: string;
			end_time?: string;
			days?: string[];
		};
		slots_confirmed?: number;
		slots_remaining?: number;
		applicants_count?: number;
		is_urgent?: boolean;
		requires_review?: boolean;
	}

	interface FilterSkillItem {
		code: string;
		label: string;
		isControlled: boolean;
	}

	let rawJobs = $state<RawPublicJob[]>([]);
	let sheltersList = $state<{ code: string; name: string }[]>([]);
	// Skills come only from the effective volunteer_skills Master Data endpoint.
	let skillOptions = $state<VolunteerSkillOption[]>([]);
	let isLoading = $state(true);

	function resolvedSkillLabel(value: string): string {
		return skillLabel(value, skillOptions);
	}

	/** Compare filter values and stored job values by Master Data code or label. */
	function skillsMatch(left: string, right: string): boolean {
		if (!left || !right) return false;
		if (left.trim().toLowerCase() === right.trim().toLowerCase()) return true;
		const leftOption = findSkillOption(left, skillOptions);
		const rightOption = findSkillOption(right, skillOptions);
		if (leftOption && rightOption && leftOption.code === rightOption.code) return true;
		if (leftOption && leftOption.label.trim().toLowerCase() === right.trim().toLowerCase())
			return true;
		if (rightOption && rightOption.label.trim().toLowerCase() === left.trim().toLowerCase())
			return true;
		return false;
	}

	const weekdayIndexes: Record<string, number> = {
		sun: 0,
		sunday: 0,
		จันทร์: 1,
		mon: 1,
		monday: 1,
		tue: 2,
		tuesday: 2,
		พุธ: 3,
		wed: 3,
		wednesday: 3,
		พฤหัสบดี: 4,
		thu: 4,
		thursday: 4,
		ศุกร์: 5,
		fri: 5,
		friday: 5,
		เสาร์: 6,
		sat: 6,
		saturday: 6
	};

	function asApplyDate(value: string, index: number): string {
		const normalized = value.trim();
		if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized;

		const targetDay = weekdayIndexes[normalized.toLowerCase()];
		const today = new Date();
		const dayOffset = targetDay === undefined ? index : (targetDay - today.getDay() + 7) % 7;
		return new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate() + dayOffset))
			.toISOString()
			.slice(0, 10);
	}

	function isControlledSkill(value: string): boolean {
		const option = findSkillOption(value, skillOptions);
		return option?.category?.toLowerCase() === 'controlled';
	}

	async function fetchPublicJobs() {
		try {
			isLoading = true;
			const res = await fetch('/api/public/v1/volunteer/jobs');
			if (res.ok) {
				const data = await res.json();
				rawJobs = Array.isArray(data.jobs) ? data.jobs : [];
				sheltersList = Array.isArray(data.shelters) ? data.shelters : [];
			}
		} catch (err) {
			console.warn('Failed to load public volunteer jobs:', err);
		} finally {
			isLoading = false;
		}
	}

	async function fetchMasterSkills() {
		try {
			const skills = await fetchVolunteerSkills();
			if (skills && skills.length > 0) {
				skillOptions = skills;
				return;
			}
		} catch (err) {
			console.warn('Failed to load volunteer skill master data from API:', err);
		}
		// No fallback labels: Master Data is the source of truth for this list.
		skillOptions = [];
	}

	onMount(() => {
		fetchPublicJobs();
		fetchMasterSkills();
	});

	const shelterMap = $derived.by<Record<string, string>>(() => {
		const res: Record<string, string> = {};
		for (const s of sheltersList) {
			res[s.code] = s.name;
		}
		return res;
	});

	const displayedJobs = $derived.by<DisplayJobCard[]>(() => {
		if (rawJobs && rawJobs.length > 0) {
			return rawJobs.map((job: RawPublicJob) => {
				const jobId = job.job_id || job._id || '';
				const cleanJobId = jobId.replace(/^job:/, '');
				const shelterName =
					job.shelter_name ||
					shelterMap[job.shelter_code || ''] ||
					job.shelter_code ||
					'ศูนย์พักพิงหลัก';
				const isControlled =
					job.tier === 'staff-capable' ||
					(job.skills_required?.some((s: string) => isControlledSkill(s)) ?? false);

				let shifts: DisplayShift[];
				if (job.shifts && job.shifts.length > 0) {
					shifts = job.shifts.map((s: RawPublicJobShift, idx: number) => {
						const st = s.start_time || '08:00';
						const et = s.end_time || '16:00';
						return {
							id: s.shift_id || s.id || `s-${idx}`,
							date: s.date || new Date().toISOString().slice(0, 10),
							time: `${st} - ${et} น.`,
							start_time: st,
							end_time: et,
							quota: s.quota || 10,
							applicants_count: s.applicants_count ?? 0,
							confirmed:
								s.slots_confirmed ??
								s.confirmed ??
								Math.min(
									s.quota || 10,
									Math.round((job.slots_confirmed || 0) / (job.shifts?.length || 1))
								)
						};
					});
				} else if (job.shift_template) {
					const tmpl = job.shift_template;
					const stTime = tmpl.start_time || '08:00';
					const edTime = tmpl.end_time || '16:00';
					const days =
						tmpl.days && tmpl.days.length > 0 ? tmpl.days : [new Date().toISOString().slice(0, 10)];
					shifts = days.map((day: string, idx: number) => ({
						id: `st-${cleanJobId}-${idx}`,
						date: asApplyDate(day, idx),
						time: `${stTime} - ${edTime} น.`,
						start_time: stTime,
						end_time: edTime,
						quota: job.quota || 10,
						applicants_count: job.applicants_count || 0,
						confirmed: job.slots_confirmed || 0
					}));
				} else {
					shifts = [
						{
							id: `default-${cleanJobId}`,
							date: new Date().toISOString().slice(0, 10),
							time: '08:00 - 16:00 น.',
							start_time: '08:00',
							end_time: '16:00',
							quota: job.quota || 10,
							applicants_count: job.applicants_count || 0,
							confirmed: job.slots_confirmed || 0
						}
					];
				}

				const tags: {
					label: string;
					variant: 'default' | 'success' | 'warning' | 'purple' | 'outline';
				}[] = [];
				if (isControlled) {
					tags.push({ label: t.controlledMission, variant: 'purple' });
				} else {
					tags.push({ label: t.generalMission, variant: 'default' });
				}

				if (job.status === 'open') {
					tags.push({ label: t.tagOpen, variant: 'success' });
				} else if (job.status === 'almost_full') {
					tags.push({ label: t.tagNearFull, variant: 'warning' });
				} else if (job.status === 'full') {
					tags.push({ label: t.tagFull, variant: 'outline' });
				}

				if (job.skills_required) {
					for (const sk of job.skills_required) {
						const label = resolvedSkillLabel(sk);
						if (label) tags.push({ label, variant: 'outline' });
					}
				}

				return {
					id: cleanJobId,
					title: job.title,
					shelter: job.shelter_name || shelterName,
					shelter_code: job.shelter_code,
					description: job.description || t.defaultJobDesc,
					shifts,
					tags,
					skills_required: job.skills_required,
					applicants_count: job.applicants_count || 0,
					isControlled
				};
			});
		}

		return [];
	});

	let isApplyModalOpen = $state(false);
	let selectedJob = $state<QuickApplyJob | null>(null);
	let searchQuery = $state('');
	let selectedFilter = $state<'all' | 'open' | 'near_full' | 'controlled'>('all');
	let selectedShelter = $state('all');
	let selectedSkill = $state('all');

	// Unique list of shelters for the filter
	const availableShelters = $derived.by<{ code: string; name: string }[]>(() => {
		const shelters: Record<string, string> = {};
		for (const s of sheltersList) {
			if (s.code && s.name) shelters[s.code] = s.name;
		}
		for (const job of displayedJobs) {
			const code = job.shelter_code || job.shelter;
			if (code && job.shelter && !shelters[code]) shelters[code] = job.shelter;
		}
		return Object.entries(shelters).map(([code, name]) => ({ code, name }));
	});

	// Full list of active skills from Master Data. Job values not present in the
	// master list are intentionally omitted instead of leaking internal codes.
	const availableSkills = $derived.by<FilterSkillItem[]>(() => {
		const result: FilterSkillItem[] = [];
		const seenCodes = new SvelteSet<string>();

		const baseList = skillOptions;

		// 1. Add skills from Master Data
		for (const opt of baseList) {
			const code = opt.code || opt.label;
			const label = skillLabel(code, skillOptions);
			const normCode = code.trim().toLowerCase();
			if (code && label && !seenCodes.has(normCode)) {
				seenCodes.add(normCode);
				seenCodes.add(label.toLowerCase());
				result.push({
					code,
					label,
					isControlled: opt.category === 'controlled'
				});
			}
		}

		return result;
	});

	let filteredJobs = $derived(
		displayedJobs.filter((j) => {
			if (searchQuery.trim()) {
				const q = searchQuery.toLowerCase().trim();
				const matchText =
					j.title.toLowerCase().includes(q) ||
					j.shelter.toLowerCase().includes(q) ||
					j.tags.some((tg) => tg.label.toLowerCase().includes(q));
				if (!matchText) return false;
			}

			if (selectedShelter !== 'all' && (j.shelter_code || j.shelter) !== selectedShelter) {
				return false;
			}

			if (selectedSkill !== 'all') {
				const hasSkill =
					j.skills_required?.some((s) => skillsMatch(s, selectedSkill)) ||
					j.tags.some((tg) => skillsMatch(tg.label, selectedSkill)) ||
					skillsMatch(j.title, selectedSkill);
				if (!hasSkill) return false;
			}

			if (selectedFilter === 'open') {
				return j.shifts.some((s) => s.quota - s.confirmed > 0);
			}
			if (selectedFilter === 'near_full') {
				return j.shifts.some((s) => {
					const rem = s.quota - s.confirmed;
					return rem > 0 && rem <= 2;
				});
			}
			if (selectedFilter === 'controlled') {
				return j.isControlled;
			}

			return true;
		})
	);

	function openApplyModal(jobId: string, shiftId: string) {
		const found = displayedJobs.find((j) => j.id === jobId);
		if (found) {
			const shift = found.shifts.find((s) => s.id === shiftId) ?? found.shifts[0];
			selectedJob = {
				id: found.id,
				title: found.title,
				shelter: found.shelter,
				shelter_code: found.shelter_code,
				shifts: found.shifts,
				selectedShift: shift,
				skills_required: found.skills_required
			};
			isApplyModalOpen = true;
		}
	}
</script>

<div class="space-y-6">
	<!-- Search & Filter Card -->
	<div
		class="rounded-2xl border border-border/80 bg-white p-4 shadow-sm sm:rounded-3xl sm:p-6 md:p-8"
	>
		<!-- Header / Title -->
		<div class="mb-6 flex flex-col justify-between gap-4 sm:mb-8 md:flex-row md:items-start">
			<div>
				<h2
					class="flex items-center gap-2.5 text-lg font-black tracking-tight text-primary sm:gap-3 sm:text-xl md:text-2xl"
				>
					<Briefcase class="h-5 w-5 shrink-0 text-primary sm:h-6 sm:w-6" />
					<span>{t.jobBoardSectionTitle}</span>
				</h2>
			</div>

			<!-- Search Bar -->
			<div class="relative w-full shrink-0 md:w-[320px] lg:w-[360px]">
				<input
					type="text"
					bind:value={searchQuery}
					placeholder={t.searchPlaceholder}
					class="w-full rounded-2xl border border-border/80 bg-white px-4 py-3 pl-10 text-base text-foreground shadow-sm outline-hidden transition-all placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary sm:px-5 sm:py-3.5 sm:pl-11 sm:text-sm"
				/>
				<Search
					class="pointer-events-none absolute top-3.5 left-3.5 h-4.5 w-4.5 text-muted-foreground sm:top-4 sm:left-4"
				/>
			</div>
		</div>

		<!-- Filters Area -->
		<div class="flex flex-col gap-4 sm:gap-5">
			<!-- Filter Status Pills -->
			<div class="flex flex-wrap items-center gap-2 sm:gap-3">
				<div
					class="mr-1 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground sm:mr-2 sm:text-sm"
				>
					<Filter class="h-4 w-4" />
					<span>{t.filterLabel}</span>
				</div>

				<button
					type="button"
					onclick={() => (selectedFilter = 'all')}
					class="cursor-pointer rounded-full px-3.5 py-1.5 text-xs font-bold transition-all active:scale-95 sm:px-5 sm:py-2 {selectedFilter ===
					'all'
						? 'bg-primary text-white shadow-sm'
						: 'border border-border/80 bg-white text-muted-foreground hover:bg-muted/30'}"
				>
					{t.filterAll} ({displayedJobs.length})
				</button>

				<button
					type="button"
					onclick={() => (selectedFilter = 'open')}
					class="cursor-pointer rounded-full px-3.5 py-1.5 text-xs font-bold transition-all active:scale-95 sm:px-5 sm:py-2 {selectedFilter ===
					'open'
						? 'border border-success bg-success/15 text-success shadow-sm'
						: 'border border-success/30 bg-success/5 text-success hover:bg-success/10'}"
				>
					<span class="mr-1.5 inline-block h-2 w-2 rounded-full bg-success"></span>
					{t.filterOpen}
				</button>

				<button
					type="button"
					onclick={() => (selectedFilter = 'near_full')}
					class="cursor-pointer rounded-full px-3.5 py-1.5 text-xs font-bold transition-all active:scale-95 sm:px-5 sm:py-2 {selectedFilter ===
					'near_full'
						? 'border border-warning bg-warning/20 text-warning-foreground shadow-sm'
						: 'border border-warning/40 bg-warning/10 text-warning-foreground hover:bg-warning/20'}"
				>
					<span class="mr-1.5 inline-block h-2.5 w-2.5 rounded-full bg-warning"></span>
					{t.filterNearFull}
				</button>

				<button
					type="button"
					onclick={() => (selectedFilter = 'controlled')}
					class="cursor-pointer rounded-full px-3.5 py-1.5 text-xs font-bold transition-all active:scale-95 sm:px-5 sm:py-2 {selectedFilter ===
					'controlled'
						? 'border border-accent-purple bg-accent-purple/15 text-accent-purple shadow-sm'
						: 'border border-accent-purple/30 bg-accent-purple/5 text-accent-purple hover:bg-accent-purple/10'}"
				>
					{t.filterControlled}
				</button>
			</div>

			<!-- Skill Filter Chips (Full Comprehensive List) -->
			{#if availableSkills.length > 0}
				<div class="flex flex-col gap-2.5 border-t border-border/50 pt-3 sm:pt-4">
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-1.5 text-xs font-bold text-muted-foreground">
							<Tag class="h-3.5 w-3.5 text-primary" />
							<span>{t.skillsLabel}</span>
							<span class="text-3xs font-medium text-muted-foreground/70"
								>({availableSkills.length})</span
							>
						</div>
						{#if selectedSkill !== 'all'}
							<button
								type="button"
								onclick={() => (selectedSkill = 'all')}
								class="cursor-pointer text-xs font-bold text-danger hover:underline"
							>
								{t.clearFilter}
							</button>
						{/if}
					</div>

					<div class="flex flex-wrap items-center gap-1.5 sm:gap-2">
						<button
							type="button"
							onclick={() => (selectedSkill = 'all')}
							class="cursor-pointer rounded-full px-3 py-1.5 text-xs font-bold transition-all active:scale-95 {selectedSkill ===
							'all'
								? 'bg-primary text-white shadow-xs ring-2 ring-primary/20'
								: 'border border-border/80 bg-muted/20 text-muted-foreground hover:bg-muted/50'}"
						>
							{t.filterAll}
						</button>

						{#each availableSkills as skill (skill.code)}
							{@const isSelected = selectedSkill === skill.code || selectedSkill === skill.label}
							<button
								type="button"
								onclick={() => (selectedSkill = isSelected ? 'all' : skill.code)}
								class="flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all active:scale-95 {isSelected
									? 'border border-primary bg-primary font-bold text-white shadow-xs ring-2 ring-primary/20'
									: skill.isControlled
										? 'border border-accent-purple/40 bg-accent-purple/5 text-accent-purple hover:bg-accent-purple/15'
										: 'border border-border/80 bg-white text-muted-foreground hover:border-primary/40 hover:text-foreground'}"
							>
								<span>{skill.label}</span>
							</button>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Shelter Selector Dropdown -->
			<div
				class="flex flex-col gap-2 border-t border-border/50 pt-1 sm:flex-row sm:items-center sm:gap-3"
			>
				<span class="w-auto shrink-0 text-xs font-bold text-muted-foreground sm:w-[60px] sm:text-sm"
					>{t.shelterLabel}</span
				>
				<div class="relative w-full max-w-full sm:max-w-md">
					<Select.Root type="single" bind:value={selectedShelter}>
						<Select.Trigger
							class="h-10 w-full rounded-xl border-border/80 bg-muted/20 pl-10 text-xs font-bold text-foreground sm:h-11 sm:text-sm"
						>
							{#if selectedShelter === 'all'}
								{t.allShelters} ({availableShelters.length})
							{:else}
								{availableShelters.find((s) => s.code === selectedShelter)?.name ?? t.selectShelter}
							{/if}
						</Select.Trigger>
						<Select.Content>
							<Select.Group>
								<Select.Item value="all" label={`${t.allShelters} (${availableShelters.length})`}>
									{t.allShelters} ({availableShelters.length})
								</Select.Item>
								{#each availableShelters as shelter (shelter.code)}
									<Select.Item value={shelter.code} label={shelter.name}>
										{shelter.name}
									</Select.Item>
								{/each}
							</Select.Group>
						</Select.Content>
					</Select.Root>
					<MapPin
						class="pointer-events-none absolute top-2.5 left-3.5 h-4 w-4 text-danger sm:top-3"
					/>
				</div>
			</div>
		</div>
	</div>

	<!-- Job Cards List -->
	<div class="flex flex-col gap-4 sm:gap-5">
		{#if isLoading}
			<div class="space-y-4">
				<Skeleton class="h-44 rounded-2xl" />
				<Skeleton class="h-44 rounded-2xl" />
			</div>
		{:else}
			{#each filteredJobs as job (job.id)}
				<JobCard {job} onApply={openApplyModal} />
			{:else}
				<div
					class="flex flex-col items-center justify-center rounded-2xl sm:rounded-3xl border-2 border-dashed border-border/80 bg-card p-8 sm:p-12 text-center text-muted-foreground"
				>
					<Briefcase class="mb-3 h-10 w-10 text-muted-foreground/40" />
					<h3 class="text-sm sm:text-base font-bold text-foreground">{t.noJobsFound}</h3>
					<p class="mt-1 text-xs text-muted-foreground max-w-sm">
						{t.noJobsFoundDesc}
					</p>
				</div>
			{/each}
		{/if}
	</div>
</div>

<QuickApplyModal
	bind:isOpen={isApplyModalOpen}
	job={selectedJob}
	{applicantProfile}
	{applicantCredential}
/>
