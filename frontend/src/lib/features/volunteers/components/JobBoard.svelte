<script lang="ts">
	import { onMount } from 'svelte';
	import Filter from '@lucide/svelte/icons/filter';
	import Search from '@lucide/svelte/icons/search';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Briefcase from '@lucide/svelte/icons/briefcase';
	import Tag from '@lucide/svelte/icons/tag';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import JobCard from './JobCard.svelte';
	import QuickApplyModal, { type QuickApplyJob } from './QuickApplyModal.svelte';

	interface DisplayShift {
		id: string;
		date: string;
		time: string;
		start_time?: string;
		end_time?: string;
		quota: number;
		confirmed: number;
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
		isControlled: boolean;
	}

	// Mock fallback data if database has no jobs yet
	const fallbackJobs: QuickApplyJob[] = [
		{
			id: 'job-1',
			title: 'ทีมอำนวยการและต้อนรับผู้ประสานงาน EOC ม.อ.',
			shelter: 'มหาวิทยาลัยสงขลานครินทร์ (ศูนย์อพยพหลักระดับจังหวัด)',
			shifts: [
				{
					id: 's1',
					date: '2026-06-13',
					time: '08:00 - 12:00 น.',
					start_time: '08:00',
					end_time: '12:00',
					quota: 10,
					confirmed: 6
				},
				{
					id: 's2',
					date: '2026-06-13',
					time: '12:00 - 16:00 น.',
					start_time: '12:00',
					end_time: '16:00',
					quota: 10,
					confirmed: 10
				}
			],
			skills_required: ['คัดกรองและสแกนประวัติ', 'ประสานงาน / ต้อนรับ']
		},
		{
			id: 'job-2',
			title: 'ทีมแพทย์และพยาบาลประจำจุดปฐมพยาบาล',
			shelter: 'ศูนย์พักพิง เทศบาลนครหาดใหญ่ (โรงเรียนเทศบาล 2)',
			shifts: [
				{
					id: 's1',
					date: '2026-06-13',
					time: '08:00 - 16:00 น.',
					start_time: '08:00',
					end_time: '16:00',
					quota: 4,
					confirmed: 3
				}
			],
			skills_required: ['การแพทย์ / ปฐมพยาบาล']
		},
		{
			id: 'job-3',
			title: 'ทีมครัวกลางและจัดเตรียมอาหารกล่องพระราชทาน',
			shelter: 'ศูนย์พักพิง เทศบาลเมืองบ้านพรุ',
			shifts: [
				{
					id: 's1',
					date: '2026-06-13',
					time: '08:00 - 12:00 น.',
					start_time: '08:00',
					end_time: '12:00',
					quota: 10,
					confirmed: 10
				},
				{
					id: 's2',
					date: '2026-06-13',
					time: '12:00 - 18:00 น.',
					start_time: '12:00',
					end_time: '18:00',
					quota: 15,
					confirmed: 8
				}
			],
			skills_required: ['ประกอบอาหาร / ครัวสนาม']
		},
		{
			id: 'job-4',
			title: 'ทีมคลังพัสดุและขนย้ายถุงยังชีพฉุกเฉิน',
			shelter: 'บ้านพี่เลี้ยงชุมชนคอหงส์',
			shifts: [
				{
					id: 's1',
					date: '2026-06-13',
					time: '13:00 - 17:00 น.',
					start_time: '13:00',
					end_time: '17:00',
					quota: 8,
					confirmed: 8
				}
			],
			skills_required: ['ขนย้ายสิ่งของ / พลาธิการ']
		}
	];

	interface RawPublicJobShift {
		id?: string;
		date: string;
		start_time: string;
		end_time: string;
		quota: number;
	}

	interface RawPublicJob {
		_id: string;
		title: string;
		description?: string;
		shelter_code?: string;
		tier?: string;
		status?: string;
		quota?: number;
		skills_required?: string[];
		shifts?: RawPublicJobShift[];
		slots_confirmed?: number;
		slots_remaining?: number;
		is_urgent?: boolean;
	}

	let rawJobs = $state<RawPublicJob[]>([]);
	let sheltersList = $state<{ code: string; name: string }[]>([]);
	let isLoading = $state(true);

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

	onMount(() => {
		fetchPublicJobs();
	});

	const shelterMap = $derived.by<Record<string, string>>(() => {
		const res: Record<string, string> = {};
		for (const s of sheltersList) {
			res[s.code] = s.name;
		}
		return res;
	});

	// Map public jobs from database (with fallback)
	const displayedJobs = $derived.by<DisplayJobCard[]>(() => {
		if (rawJobs && rawJobs.length > 0) {
			return rawJobs.map((job: RawPublicJob) => {
				const shelterName =
					shelterMap[job.shelter_code || ''] ?? (job.shelter_code || 'ศูนย์พักพิงหลัก');
				const isControlled =
					job.tier === 'staff-capable' ||
					(job.skills_required?.some((s: string) => s.includes('แพทย์') || s.includes('พยาบาล')) ??
						false);

				const shifts: DisplayShift[] =
					job.shifts && job.shifts.length > 0
						? job.shifts.map((s: RawPublicJobShift, idx: number) => ({
								id: s.id || `s-${idx}`,
								date: s.date,
								time: `${s.start_time} - ${s.end_time} น.`,
								start_time: s.start_time,
								end_time: s.end_time,
								quota: s.quota,
								confirmed: Math.min(
									s.quota,
									Math.round((job.slots_confirmed || 0) / (job.shifts?.length || 1))
								)
							}))
						: [
								{
									id: 'default-shift',
									date: new Date().toISOString().slice(0, 10),
									time: '08:00 - 16:00 น.',
									start_time: '08:00',
									end_time: '16:00',
									quota: job.quota || 10,
									confirmed: job.slots_confirmed || 0
								}
							];

				const tags: {
					label: string;
					variant: 'default' | 'success' | 'warning' | 'purple' | 'outline';
				}[] = [];
				if (isControlled) {
					tags.push({ label: 'ภารกิจควบคุม', variant: 'purple' });
				} else {
					tags.push({ label: 'ภารกิจทั่วไป', variant: 'default' });
				}

				if (job.status === 'open') {
					tags.push({ label: 'เปิดรับสมัคร', variant: 'success' });
				} else if (job.status === 'almost_full') {
					tags.push({ label: 'ใกล้เต็ม', variant: 'warning' });
				}

				if (job.skills_required) {
					for (const sk of job.skills_required) {
						tags.push({ label: sk, variant: 'outline' });
					}
				}

				return {
					id: (job._id || '').replace(/^job:/, ''),
					title: job.title,
					shelter: shelterName,
					shelter_code: job.shelter_code,
					description: job.description || 'ช่วยเหลืองานในศูนย์พักพิงตามภารกิจที่ได้รับมอบหมาย',
					shifts,
					tags,
					skills_required: job.skills_required,
					isControlled
				};
			});
		}

		// Use fallback formatted jobs
		return fallbackJobs.map((j) => ({
			id: j.id,
			title: j.title,
			shelter: j.shelter,
			description: 'ช่วยเหลืองานในศูนย์พักพิงตามภารกิจที่ได้รับมอบหมาย',
			shifts: j.shifts ?? [],
			tags: [
				{
					label: j.skills_required?.includes('การแพทย์ / ปฐมพยาบาล')
						? 'ภารกิจควบคุม'
						: 'ภารกิจทั่วไป',
					variant: j.skills_required?.includes('การแพทย์ / ปฐมพยาบาล') ? 'purple' : 'default'
				},
				{ label: 'เปิดรับสมัคร', variant: 'success' },
				...(j.skills_required?.map((s) => ({ label: s, variant: 'outline' as const })) ?? [])
			],
			skills_required: j.skills_required,
			isControlled: j.skills_required?.includes('การแพทย์ / ปฐมพยาบาล') ?? false
		}));
	});

	let isApplyModalOpen = $state(false);
	let selectedJob = $state<QuickApplyJob | null>(null);
	let searchQuery = $state('');
	let selectedFilter = $state<'all' | 'open' | 'near_full' | 'controlled'>('all');
	let selectedShelter = $state('all');
	let selectedSkill = $state('all');

	// Unique list of shelter names for filter dropdown
	const availableShelterNames = $derived.by<string[]>(() =>
		displayedJobs
			.map((j) => j.shelter)
			.filter((val, idx, arr) => Boolean(val) && arr.indexOf(val) === idx)
	);

	// Unique list of skills extracted from displayed jobs
	const availableSkills = $derived.by<string[]>(() => {
		const skills: string[] = [];
		for (const j of displayedJobs) {
			if (j.skills_required && Array.isArray(j.skills_required)) {
				for (const s of j.skills_required) {
					const trimmed = s.trim();
					if (trimmed && !skills.includes(trimmed)) {
						skills.push(trimmed);
					}
				}
			}
		}
		return skills;
	});

	let filteredJobs = $derived(
		displayedJobs.filter((j) => {
			if (searchQuery.trim()) {
				const q = searchQuery.toLowerCase().trim();
				const matchText =
					j.title.toLowerCase().includes(q) ||
					j.shelter.toLowerCase().includes(q) ||
					j.tags.some((t) => t.label.toLowerCase().includes(q));
				if (!matchText) return false;
			}

			if (selectedShelter !== 'all' && j.shelter !== selectedShelter) {
				return false;
			}

			if (selectedSkill !== 'all') {
				const targetSkill = selectedSkill.toLowerCase().trim();
				const hasSkill =
					j.skills_required?.some((s) => s.toLowerCase().trim() === targetSkill) ||
					j.tags.some((t) => t.label.toLowerCase().trim() === targetSkill);
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
	<div class="rounded-3xl border border-border/80 bg-white p-6 shadow-sm md:p-8">
		<!-- Header / Title -->
		<div class="mb-8 flex flex-col justify-between gap-6 md:flex-row md:items-start">
			<div>
				<h2
					class="flex items-center gap-3 text-xl font-black tracking-tight text-primary sm:text-2xl"
				>
					<Briefcase class="h-6 w-6 text-primary" />
					ตลาดงานอาสาสมัครในศูนย์พักพิง
				</h2>
				<p class="mt-2 text-sm text-muted-foreground">
					เลือกภารกิจและกะเวลาที่คุณสะดวก แล้วกดสมัครเพื่อรับบัตรตั๋วดิจิทัล (QR Code Pass) ทันที
					(ไม่ต้องใช้รหัสผ่าน)
				</p>
			</div>

			<!-- Search Bar -->
			<div class="relative w-full shrink-0 md:w-[340px]">
				<input
					type="text"
					bind:value={searchQuery}
					placeholder="ค้นหาชื่องาน, ทักษะ, หรือชื่อศูนย์..."
					class="w-full rounded-2xl border border-border/80 bg-white px-5 py-3.5 pl-11 text-sm text-foreground shadow-sm outline-hidden transition-all placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary"
				/>
				<Search class="absolute top-4 left-4 h-4.5 w-4.5 text-muted-foreground" />
			</div>
		</div>

		<!-- Filters Area -->
		<div class="flex flex-col gap-5">
			<!-- Filter Status Pills -->
			<div class="flex flex-wrap items-center gap-3">
				<div class="mr-2 flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
					<Filter class="h-4 w-4" />
					<span>ตัวกรอง:</span>
				</div>

				<button
					type="button"
					onclick={() => (selectedFilter = 'all')}
					class="cursor-pointer rounded-full px-5 py-2 text-xs font-bold transition-all {selectedFilter ===
					'all'
						? 'bg-primary text-white shadow-sm'
						: 'border border-border/80 bg-white text-muted-foreground hover:bg-muted/30'}"
				>
					ทั้งหมด ({displayedJobs.length})
				</button>

				<button
					type="button"
					onclick={() => (selectedFilter = 'open')}
					class="cursor-pointer rounded-full px-5 py-2 text-xs font-bold transition-all {selectedFilter ===
					'open'
						? 'border border-success bg-success/15 text-success shadow-sm'
						: 'border border-success/30 bg-success/5 text-success hover:bg-success/10'}"
				>
					<span class="mr-1.5 inline-block h-2 w-2 rounded-full bg-success"></span>
					เปิดรับสมัคร (Open)
				</button>

				<button
					type="button"
					onclick={() => (selectedFilter = 'near_full')}
					class="cursor-pointer rounded-full px-5 py-2 text-xs font-bold transition-all {selectedFilter ===
					'near_full'
						? 'border border-warning bg-warning/20 text-warning-foreground shadow-sm'
						: 'border border-warning/40 bg-warning/10 text-warning-foreground hover:bg-warning/20'}"
				>
					<span class="mr-1.5 inline-block h-3 w-3 rounded-full bg-warning"></span>
					ใกล้เต็ม (Near Full)
				</button>

				<button
					type="button"
					onclick={() => (selectedFilter = 'controlled')}
					class="cursor-pointer rounded-full px-5 py-2 text-xs font-bold transition-all {selectedFilter ===
					'controlled'
						? 'border border-accent-purple bg-accent-purple/15 text-accent-purple shadow-sm'
						: 'border border-accent-purple/30 bg-accent-purple/5 text-accent-purple hover:bg-accent-purple/10'}"
				>
					🩺 ทักษะวิชาชีพ/ควบคุม
				</button>
			</div>

			<!-- Skill Filter Chips -->
			{#if availableSkills.length > 0}
				<div class="flex flex-wrap items-center gap-2 border-t border-border/50 pt-3">
					<div class="mr-1 flex items-center gap-1.5 text-xs font-bold text-muted-foreground">
						<Tag class="h-3.5 w-3.5 text-primary" />
						<span>ทักษะ:</span>
					</div>

					<button
						type="button"
						onclick={() => (selectedSkill = 'all')}
						class="cursor-pointer rounded-full px-3 py-1 text-xs font-medium transition-all {selectedSkill ===
						'all'
							? 'bg-primary text-white shadow-xs'
							: 'border border-border/70 bg-muted/20 text-muted-foreground hover:bg-muted/50'}"
					>
						ทั้งหมด
					</button>

					{#each availableSkills as skill (skill)}
						{@const isSelected = selectedSkill === skill}
						<button
							type="button"
							onclick={() => (selectedSkill = isSelected ? 'all' : skill)}
							class="cursor-pointer rounded-full px-3 py-1 text-xs font-medium transition-all {isSelected
								? 'border border-primary bg-primary/10 font-bold text-primary shadow-xs'
								: 'border border-border/70 bg-white text-muted-foreground hover:border-primary/40 hover:text-foreground'}"
						>
							🏷️ {skill}
						</button>
					{/each}

					{#if selectedSkill !== 'all'}
						<button
							type="button"
							onclick={() => (selectedSkill = 'all')}
							class="ml-1 cursor-pointer text-xs font-semibold text-danger hover:underline"
						>
							✕ ล้างตัวกรอง
						</button>
					{/if}
				</div>
			{/if}

			<!-- Dropdown Selectors (Shelter & Skill) -->
			<div class="grid grid-cols-1 gap-4 pt-1 sm:grid-cols-2">
				<!-- Shelter Dropdown -->
				<div class="flex items-center gap-3">
					<span class="w-[60px] shrink-0 text-sm font-bold text-muted-foreground">ศูนย์:</span>
					<div class="relative w-full">
						<select
							bind:value={selectedShelter}
							class="w-full cursor-pointer appearance-none rounded-xl border border-border/80 bg-muted/20 px-4 py-2.5 pl-10 text-sm font-bold text-foreground outline-hidden transition-all focus:border-primary focus:ring-1 focus:ring-primary"
						>
							<option value="all">📍 ทุกศูนย์พักพิง ({availableShelterNames.length})</option>
							{#each availableShelterNames as name (name)}
								<option value={name}>{name}</option>
							{/each}
						</select>
						<MapPin class="absolute top-2.5 left-3.5 h-4 w-4 text-danger" />
					</div>
				</div>

				<!-- Skill Dropdown -->
				<div class="flex items-center gap-3">
					<span class="w-[60px] shrink-0 text-sm font-bold text-muted-foreground">ทักษะ:</span>
					<div class="relative w-full">
						<select
							bind:value={selectedSkill}
							class="w-full cursor-pointer appearance-none rounded-xl border border-border/80 bg-muted/20 px-4 py-2.5 pl-10 text-sm font-bold text-foreground outline-hidden transition-all focus:border-primary focus:ring-1 focus:ring-primary"
						>
							<option value="all">🏷️ ทุกทักษะ ({availableSkills.length})</option>
							{#each availableSkills as skill (skill)}
								<option value={skill}>{skill}</option>
							{/each}
						</select>
						<Tag class="absolute top-2.5 left-3.5 h-4 w-4 text-primary" />
					</div>
				</div>
			</div>
		</div>
	</div>

	<!-- Job Cards List -->
	<div class="flex flex-col gap-5">
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
					class="flex flex-col items-center justify-center rounded-3xl border-2 border-dashed border-border/80 bg-card p-12 text-center text-muted-foreground"
				>
					<Briefcase class="mb-3 h-10 w-10 text-muted-foreground/40" />
					<h3 class="text-base font-bold text-foreground">ไม่พบกะงานที่ตรงกับเงื่อนไขการค้นหา</h3>
					<p class="mt-1 text-xs text-muted-foreground">
						โปรดลองเปลี่ยนตัวกรองหรือคำค้นหาเพื่อดูกะงานอื่น
					</p>
				</div>
			{/each}
		{/if}
	</div>
</div>

<QuickApplyModal bind:isOpen={isApplyModalOpen} job={selectedJob} />
