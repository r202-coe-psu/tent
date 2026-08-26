<script lang="ts">
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
</script>

<svelte:head>
	<title>อ่านข้อมูลสำเร็จ — SmartShelter Kiosk</title>
</svelte:head>

<div class="flex max-w-xl flex-col items-center text-center">
	<!-- Success Icon with Pulse -->
	<div class="relative mb-8 flex h-36 w-36 items-center justify-center">
		<div
			class="absolute h-full w-full animate-ping rounded-full bg-emerald-500/20 duration-1000"
		></div>
		<div
			class="flex h-32 w-32 items-center justify-center rounded-full border-2 border-emerald-500/50 bg-emerald-500/10 shadow-2xl shadow-emerald-500/20"
		>
			<CheckCircle2 class="h-20 w-20 text-emerald-400" />
		</div>
	</div>

	<h2 class="text-3xl font-extrabold text-emerald-400 sm:text-4xl">สแกนข้อมูลสำเร็จเรียบร้อย</h2>
	<p class="mt-3 flex items-center justify-center gap-2 text-2xl font-bold text-white">
		<ArrowUp class="h-6 w-6 animate-bounce text-amber-400" />
		<span>กรุณาถอดบัตรประชาชนออก</span>
	</p>
	<p class="mt-2 text-sm text-slate-400">
		ข้อมูลของท่านได้ถูกส่งไปยังระบบลงทะเบียนของเจ้าหน้าที่เรียบร้อยแล้ว
	</p>

	<div
		class="mt-8 rounded-xl border border-slate-800 bg-slate-900/60 px-6 py-3 text-xs text-slate-400"
	>
		เมื่อถอดบัตรออก หน้าจอจะรีเซ็ตเพื่อรองรับผู้รับบริการท่านถัดไป
	</div>
</div>
