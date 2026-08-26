<script lang="ts">
	import { page } from '$app/state';
	import AlertOctagon from '@lucide/svelte/icons/alert-octagon';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';

	const errorMsg = $derived(
		page.url.searchParams.get('error_msg') ||
			'ไม่สามารถอ่านข้อมูลจากบัตรได้ โปรดตรวจสอบการเสียบบัตร'
	);
</script>

<svelte:head>
	<title>เกิดข้อผิดพลาด — SmartShelter Kiosk</title>
</svelte:head>

<div class="flex max-w-xl flex-col items-center text-center">
	<div
		class="relative mb-8 flex h-32 w-32 items-center justify-center rounded-full border-2 border-rose-500/40 bg-rose-500/10 shadow-2xl shadow-rose-500/20"
	>
		<AlertOctagon class="h-16 w-16 text-rose-500" />
	</div>

	<h2 class="text-3xl font-extrabold text-rose-400 sm:text-4xl">ไม่สามารถอ่านข้อมูลบัตรได้</h2>
	<p class="mt-3 max-w-md text-base text-slate-300">
		{errorMsg}
	</p>

	<div
		class="mt-8 space-y-2 rounded-2xl border border-slate-800 bg-slate-900/80 p-5 text-left text-xs text-slate-300"
	>
		<p class="flex items-center gap-1.5 font-semibold text-amber-400">
			<RotateCcw class="h-4 w-4" />
			คำแนะนำ:
		</p>
		<ul class="list-inside list-disc space-y-1 text-slate-400">
			<li>โปรดดึงบัตรออก และเสียบใหม่อีกครั้งโดยหงายด้านชิปสีทองขึ้น</li>
			<li>ทำความสะอาดหน้าสัมผัสชิปสีทองบนบัตร หากมีคราบสกปรก</li>
			<li>หากยังพบปัญหา โปรดติดต่อเจ้าหน้าที่ประจำศูนย์</li>
		</ul>
	</div>
</div>
