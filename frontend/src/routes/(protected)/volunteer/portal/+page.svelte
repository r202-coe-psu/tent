<script lang="ts">
	import UserCheck from '@lucide/svelte/icons/user-check';
	import Bell from '@lucide/svelte/icons/bell';
	import Check from '@lucide/svelte/icons/check';
	import X from '@lucide/svelte/icons/x';
	import QrCode from '@lucide/svelte/icons/qr-code';
	import CalendarClock from '@lucide/svelte/icons/calendar-clock';
	import LogOut from '@lucide/svelte/icons/log-out';
	import { PublicPageShell } from '$lib/features/public-portal';

	// Mock Data
	let volunteer = $state({
		name: 'สมชาย ใจดี',
		id: 'V-1025',
		shelter: 'มหาวิทยาลัยสงขลานครินทร์'
	});

	let dispatchedJobs = $state([
		{
			id: 'dj-1',
			title: 'ทีมขนย้ายเวชภัณฑ์และอุปกรณ์การแพทย์',
			time: 'วันนี้ 13:00 - 17:00 น.',
			description: 'ต้องการกำลังคนด่วนเพื่อช่วยขนย้ายยาจากส่วนกลางไปยังเต็นท์พยาบาล'
		}
	]);

	let myShifts = $state([
		{
			id: 's-1',
			title: 'ทีมอำนวยการและต้อนรับผู้ประสานงาน',
			date: '13/06/2026',
			time: '08:00 - 12:00 น.',
			status: 'checked_in' as const
		},
		{
			id: 's-2',
			title: 'แจกจ่ายอาหารมื้อเย็น',
			date: '13/06/2026',
			time: '16:00 - 19:00 น.',
			status: 'standby' as const
		}
	]);

	function handleAcceptDispatch(id: string) {
		dispatchedJobs = dispatchedJobs.filter((j) => j.id !== id);
		alert('ยอมรับภารกิจสำเร็จ ระบบได้เพิ่มเข้าสู่ตารางงานของคุณแล้ว');
	}

	function handleDeclineDispatch(id: string) {
		dispatchedJobs = dispatchedJobs.filter((j) => j.id !== id);
	}
</script>

<svelte:head>
	<title>พอร์ทัลอาสาสมัคร (Volunteer Portal) — Smart Shelter</title>
</svelte:head>

<PublicPageShell class="space-y-6">
	<!-- Portal Header -->
	<div
		class="flex items-center justify-between rounded-3xl bg-primary px-6 py-8 text-primary-foreground shadow-lg sm:px-10"
	>
		<div>
			<div class="mb-2 flex items-center gap-2 text-primary-foreground/80">
				<UserCheck class="h-5 w-5" />
				<span class="text-sm font-bold tracking-widest">VOLUNTEER PORTAL</span>
			</div>
			<h1 class="text-2xl font-bold sm:text-3xl">สวัสดี, {volunteer.name}</h1>
			<p class="mt-2 text-sm opacity-90">รหัสประจำตัว: {volunteer.id} | {volunteer.shelter}</p>
		</div>
		<button
			class="flex items-center justify-center rounded-full bg-white/20 p-3 transition-colors hover:bg-white/30"
		>
			<LogOut class="h-5 w-5" />
		</button>
	</div>

	<div class="grid grid-cols-1 gap-6 lg:grid-cols-3">
		<!-- Left Column: Tasks -->
		<div class="flex flex-col gap-6 lg:col-span-2">
			<!-- Dispatch Cards (Direct Dispatch) -->
			{#if dispatchedJobs.length > 0}
				<div class="rounded-3xl border border-warning/30 bg-warning/5 p-6 shadow-sm">
					<h2 class="mb-4 flex items-center gap-2 text-lg font-bold text-warning-foreground">
						<Bell class="h-5 w-5" />
						ภารกิจด่วนที่ได้รับมอบหมาย ({dispatchedJobs.length})
					</h2>
					<div class="space-y-4">
						{#each dispatchedJobs as job (job.id)}
							<div class="rounded-2xl border border-warning/20 bg-card p-5 shadow-sm">
								<div class="mb-4">
									<h3 class="text-base font-bold text-foreground">{job.title}</h3>
									<p class="mt-1 text-xs text-muted-foreground">{job.time}</p>
									<p class="mt-3 text-sm text-muted-foreground">{job.description}</p>
								</div>
								<div class="flex gap-3">
									<button
										onclick={() => handleDeclineDispatch(job.id)}
										class="flex flex-1 items-center justify-center gap-2 rounded-xl border border-border bg-card py-2.5 text-sm font-bold text-foreground transition-colors hover:bg-muted"
									>
										<X class="h-4 w-4 text-danger" />
										ปฏิเสธภารกิจ
									</button>
									<button
										onclick={() => handleAcceptDispatch(job.id)}
										class="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-bold text-primary-foreground shadow-sm transition-colors hover:bg-primary-dark"
									>
										<Check class="h-4 w-4" />
										ยอมรับภารกิจ
									</button>
								</div>
							</div>
						{/each}
					</div>
				</div>
			{/if}

			<!-- My Shifts -->
			<div class="rounded-3xl border border-border bg-card p-6 shadow-sm">
				<h2 class="mb-5 flex items-center gap-2 text-lg font-bold text-foreground">
					<CalendarClock class="h-5 w-5 text-primary" />
					ตารางกะงานของฉัน (My Shifts)
				</h2>

				{#if myShifts.length > 0}
					<div class="space-y-4">
						{#each myShifts as shift (shift.id)}
							<div
								class="flex items-center justify-between rounded-2xl border border-border bg-muted/10 p-4 transition-colors hover:bg-muted/20"
							>
								<div>
									<h3 class="font-bold text-foreground">{shift.title}</h3>
									<p class="mt-1 text-xs text-muted-foreground">{shift.date} • {shift.time}</p>
								</div>
								<div>
									{#if shift.status === 'checked_in'}
										<span
											class="inline-flex items-center gap-1.5 rounded-full bg-success/15 px-3 py-1 text-xs font-bold text-success"
										>
											<span class="h-2 w-2 animate-pulse rounded-full bg-success"></span>
											ปฏิบัติงานอยู่
										</span>
									{:else if shift.status === 'standby'}
										<span
											class="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs font-bold text-muted-foreground"
										>
											รอสแตนด์บาย
										</span>
									{/if}
								</div>
							</div>
						{/each}
					</div>
				{:else}
					<p class="text-sm text-muted-foreground">ยังไม่มีกะงานในตาราง</p>
				{/if}
			</div>
		</div>

		<!-- Right Column: Digital Role Card -->
		<div>
			<div class="sticky top-6 rounded-3xl border border-border bg-card p-6 shadow-sm">
				<h2 class="mb-5 text-center text-lg font-bold text-foreground">บัตรประจำตัว (Role Card)</h2>

				<div class="mx-auto flex max-w-[200px] flex-col items-center">
					<div
						class="mb-4 flex aspect-square w-full items-center justify-center rounded-2xl border-4 border-muted/50 bg-white"
					>
						<QrCode class="h-32 w-32 text-slate-900" />
					</div>
					<p class="text-xs text-muted-foreground">ใช้สแกนหน้าจุดรายงานตัว</p>

					<div class="mt-6 w-full rounded-xl bg-muted/20 p-4 text-center">
						<p class="text-2xs font-bold tracking-widest text-muted-foreground uppercase">
							ROLE / หน้าที่
						</p>
						<p class="mt-1 text-sm font-bold text-foreground">ทีมอำนวยการ</p>
					</div>
				</div>
			</div>
		</div>
	</div>
</PublicPageShell>
