<script lang="ts">
	import { page } from '$app/state';
	import AlertOctagon from '@lucide/svelte/icons/alert-octagon';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import UserCheck from '@lucide/svelte/icons/user-check';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';

	const errorMsg = $derived(
		page.url.searchParams.get('error_msg') ||
			'ไม่สามารถอ่านข้อมูลจากบัตรได้ โปรดตรวจสอบการเสียบบัตร'
	);
</script>

<svelte:head>
	<title>เกิดข้อผิดพลาด — SmartShelter Kiosk</title>
</svelte:head>

<div
	class="flex h-full w-full max-w-6xl flex-1 flex-col justify-center gap-6 py-4 lg:gap-10 xl:max-w-7xl"
>
	<!-- ========================================== -->
	<!-- 2-Column Grid สำหรับจอกว้าง Kiosk แนวนอน -->
	<!-- ========================================== -->
	<div
		class="my-auto grid w-full grid-cols-1 items-center gap-6 lg:grid-cols-12 lg:gap-10 xl:gap-14"
	>
		<!-- คอลัมน์ซ้าย: Visual Error Shield & ข้อความแจ้งข้อผิดพลาด -->
		<div
			class="flex flex-col items-center space-y-4 text-center lg:col-span-6 lg:items-start lg:text-left xl:col-span-5"
		>
			<div class="relative flex h-40 w-40 items-center justify-center sm:h-48 sm:w-48">
				<!-- Outer pulse -->
				<div
					class="absolute h-full w-full animate-ping rounded-full bg-rose-500/15 duration-1000"
				></div>

				<!-- Central Error Shield -->
				<div
					class="flex h-28 w-28 items-center justify-center rounded-full border-4 border-rose-400 bg-white shadow-2xl ring-4 shadow-rose-500/25 ring-rose-100 sm:h-34 sm:w-34"
				>
					<AlertOctagon class="h-14 w-14 text-rose-600 sm:h-18 sm:w-18" />
				</div>
			</div>

			<div class="space-y-2">
				<div
					class="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-4 py-1.5 text-xs font-black text-rose-700 shadow-sm sm:text-sm"
				>
					<AlertTriangle class="h-4 w-4" />
					<span>SCANNING ERROR / อ่านบัตรไม่สำเร็จ</span>
				</div>

				<h2
					class="text-3xl leading-tight font-black tracking-tight text-rose-600 sm:text-4xl lg:text-5xl"
				>
					ไม่สามารถอ่านข้อมูลบัตรได้
				</h2>
			</div>

			<div
				class="w-full rounded-2xl border-2 border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-800 shadow-sm sm:text-base"
			>
				{errorMsg}
			</div>
		</div>

		<!-- คอลัมน์ขวา: คำแนะนำการแก้ไขปัญหา 3 ขั้นตอน -->
		<div class="flex flex-col justify-center space-y-3.5 text-left lg:col-span-6 xl:col-span-7">
			<h3 class="text-sm font-black tracking-wider text-slate-500 uppercase">
				ขั้นตอนการแก้ไขปัญหา (Recovery Steps)
			</h3>

			<div
				class="flex items-center gap-4 rounded-2xl border-2 border-slate-200 bg-white p-4 shadow-sm transition-transform hover:scale-[1.01]"
			>
				<div
					class="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-700 ring-2 ring-amber-300/40"
				>
					<ArrowUp class="h-6 w-6 stroke-[2.5]" />
				</div>
				<div>
					<p class="text-base font-black text-slate-900 sm:text-lg">1. ดึงบัตรประชาชนออก</p>
					<p class="text-xs font-medium text-slate-500 sm:text-sm">
						นำบัตรออกจากเครื่องอ่านเพื่อเตรียมเสียบใหม่อีกครั้ง
					</p>
				</div>
			</div>

			<div
				class="flex items-center gap-4 rounded-2xl border-2 border-slate-200 bg-white p-4 shadow-sm transition-transform hover:scale-[1.01]"
			>
				<div
					class="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blue-100 text-blue-700 ring-2 ring-blue-300/40"
				>
					<RotateCcw class="h-6 w-6 stroke-[2.5]" />
				</div>
				<div>
					<p class="text-base font-black text-slate-900 sm:text-lg">
						2. เสียบใหม่อีกครั้ง โดยหงายชิปสีทองขึ้น
					</p>
					<p class="text-xs font-medium text-slate-500 sm:text-sm">
						ตรวจสอบให้แน่ใจว่าหน้าสัมผัสชิปสะอาดและเสียบเข้าจนสุดช่อง
					</p>
				</div>
			</div>

			<div
				class="flex items-center gap-4 rounded-2xl border-2 border-slate-200 bg-white p-4 shadow-sm transition-transform hover:scale-[1.01]"
			>
				<div
					class="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-cyan-100 text-cyan-700 ring-2 ring-cyan-300/40"
				>
					<UserCheck class="h-6 w-6 stroke-[2.5]" />
				</div>
				<div>
					<p class="text-base font-black text-slate-900 sm:text-lg">
						3. หากยังพบปัญหา โปรดติดต่อเจ้าหน้าที่
					</p>
					<p class="text-xs font-medium text-slate-500 sm:text-sm">
						เจ้าหน้าที่ประจำศูนย์พักพิงสามารถกรอกข้อมูลลงทะเบียนให้ท่านได้โดยตรง
					</p>
				</div>
			</div>
		</div>
	</div>
</div>
