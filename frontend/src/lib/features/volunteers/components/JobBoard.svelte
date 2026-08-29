<script lang="ts">
	import Filter from '@lucide/svelte/icons/filter';
	import Search from '@lucide/svelte/icons/search';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Briefcase from '@lucide/svelte/icons/briefcase';
	import JobCard from './JobCard.svelte';
	import QuickApplyModal from './QuickApplyModal.svelte';

	interface JobShift {
		id: string;
		date: string;
		time: string;
		quota: number;
		confirmed: number;
	}

	interface JobItem {
		id: string;
		title: string;
		shelter: string;
		description: string;
		shifts: JobShift[];
		tags: { label: string; variant: 'default' | 'success' | 'warning' | 'purple' | 'outline' }[];
	}

	// Mock data for jobs
	let jobs = $state<JobItem[]>([
		{
			id: 'job-1',
			title: 'ทีมอำนวยการและต้อนรับผู้ประสานงาน EOC ม.อ.',
			shelter: 'มหาวิทยาลัยสงขลานครินทร์ (ศูนย์อพยพหลักระดับจังหวัด)',
			description:
				'ช่วยงานอำนวยการ ต้อนรับผู้ประสานงานจากศูนย์ EOC ม.อ. คัดกรองและประสานงานผู้ประสบภัยที่เดินทางมาถึง',
			shifts: [
				{ id: 's1', date: '13/06/2026', time: '08:00 - 12:00 น.', quota: 10, confirmed: 6 },
				{ id: 's2', date: '13/06/2026', time: '12:00 - 16:00 น.', quota: 10, confirmed: 10 }
			],
			tags: [
				{ label: 'ภารกิจทั่วไป', variant: 'default' },
				{ label: 'เปิดรับสมัคร', variant: 'success' },
				{ label: 'คัดกรองและสแกนประวัติ', variant: 'outline' },
				{ label: 'Communications', variant: 'outline' }
			]
		},
		{
			id: 'job-2',
			title: 'ทีมแพทย์และพยาบาลประจำจุดปฐมพยาบาล',
			shelter: 'ศูนย์พักพิง เทศบาลนครหาดใหญ่ (โรงเรียนเทศบาล 2)',
			description:
				'ประจำจุดปฐมพยาบาล ดูแลผู้ป่วยเบื้องต้น และคัดกรองผู้ป่วยที่ต้องส่งต่อโรงพยาบาล (ต้องมีใบประกอบวิชาชีพ)',
			shifts: [{ id: 's1', date: '13/06/2026', time: '08:00 - 16:00 น.', quota: 4, confirmed: 3 }],
			tags: [
				{ label: 'ภารกิจควบคุม', variant: 'purple' },
				{ label: 'ใกล้เต็ม', variant: 'warning' },
				{ label: 'การแพทย์/พยาบาล', variant: 'outline' }
			]
		},
		{
			id: 'job-3',
			title: 'ทีมครัวกลางและจัดเตรียมอาหารกล่องพระราชทาน',
			shelter: 'ศูนย์พักพิง เทศบาลเมืองบ้านพรุ',
			description:
				'ช่วยประกอบอาหาร ปรุงสุก สะอาด บรรจุกล่อง และจัดลำดับแจกจ่ายอาหารมื้อกลางวันและเย็น',
			shifts: [
				{ id: 's1', date: '13/06/2026', time: '08:00 - 12:00 น.', quota: 10, confirmed: 10 },
				{ id: 's2', date: '13/06/2026', time: '12:00 - 18:00 น.', quota: 15, confirmed: 8 }
			],
			tags: [
				{ label: 'ภารกิจทั่วไป', variant: 'default' },
				{ label: 'เปิดรับสมัคร', variant: 'success' },
				{ label: 'ครัวกลาง / อาหาร', variant: 'outline' }
			]
		},
		{
			id: 'job-4',
			title: 'ทีมคลังพัสดุและขนย้ายถุงยังชีพฉุกเฉิน',
			shelter: 'บ้านพี่เลี้ยงชุมชนคอหงส์',
			description:
				'ช่วยตรวจนับสต็อกสิ่งของบริจาค ยกของ และจัดเรียงถุงยังชีพสำหรับแจกจ่ายแก่ผู้ประสบภัย',
			shifts: [{ id: 's1', date: '13/06/2026', time: '13:00 - 17:00 น.', quota: 8, confirmed: 8 }],
			tags: [
				{ label: 'ภารกิจทั่วไป', variant: 'default' },
				{ label: 'กะเต็มแล้ว', variant: 'warning' },
				{ label: 'คลังพัสดุ / ขนย้าย', variant: 'outline' }
			]
		}
	]);

	let isApplyModalOpen = $state(false);
	// selectedJob now can also carry the selectedShift details for the modal
	let selectedJob = $state<(JobItem & { selectedShift?: JobShift }) | null>(null);
	let searchQuery = $state('');
	let selectedFilter = $state<'all' | 'open' | 'near_full' | 'controlled'>('all');
	let selectedShelter = $state('all');

	let filteredJobs = $derived(
		jobs.filter((j) => {
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
				return j.tags.some((t) => t.variant === 'purple');
			}

			return true;
		})
	);

	function openApplyModal(jobId: string, shiftId: string) {
		const job = jobs.find((j) => j.id === jobId);
		if (job) {
			const shift = job.shifts.find((s) => s.id === shiftId);
			selectedJob = { ...job, selectedShift: shift };
			isApplyModalOpen = true;
		}
	}

	function handleApply(formData: unknown) {
		console.log('Applied for job:', selectedJob?.id, 'Data:', formData);
		alert(`ส่งใบสมัครสำหรับ ${selectedJob?.title} สำเร็จ! คุณจะได้รับรหัสตั๋ว QR Code ทันที`);
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
					ทั้งหมด (5)
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

			<!-- Shelter Selector Dropdown -->
			<div class="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
				<span class="w-auto text-sm font-bold text-muted-foreground sm:w-[70px]">ศูนย์:</span>
				<div class="relative w-full sm:w-[340px]">
					<select
						bind:value={selectedShelter}
						class="w-full cursor-pointer appearance-none rounded-xl border border-border/80 bg-muted/20 px-4 py-2.5 pl-10 text-sm font-bold text-foreground outline-hidden transition-all focus:border-primary focus:ring-1 focus:ring-primary"
					>
						<option value="all">📍 ทุกศูนย์พักพิง (6)</option>
						<option value="มหาวิทยาลัยสงขลานครินทร์ (ศูนย์อพยพหลักระดับจังหวัด)">
							ม.สงขลานครินทร์ (ศูนย์หลัก)
						</option>
						<option value="ศูนย์พักพิง เทศบาลนครหาดใหญ่ (โรงเรียนเทศบาล 2)">
							เทศบาลนครหาดใหญ่
						</option>
						<option value="ศูนย์พักพิง เทศบาลเมืองบ้านพรุ">เทศบาลเมืองบ้านพรุ</option>
						<option value="บ้านพี่เลี้ยงชุมชนคอหงส์">บ้านพี่เลี้ยงชุมชนคอหงส์</option>
					</select>
					<MapPin class="absolute top-2.5 left-3.5 h-4 w-4 text-danger" />
				</div>
			</div>
		</div>
	</div>

	<!-- Job Cards List -->
	<div class="flex flex-col gap-5">
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
	</div>
</div>

<QuickApplyModal bind:isOpen={isApplyModalOpen} job={selectedJob} onSubmit={handleApply} />
