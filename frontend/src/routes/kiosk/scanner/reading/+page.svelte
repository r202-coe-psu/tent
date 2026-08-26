<script lang="ts">
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
</script>

<svelte:head>
	<title>กำลังอ่านข้อมูลบัตรประชาชน — SmartShelter Kiosk</title>
</svelte:head>

<div class="flex max-w-xl flex-col items-center text-center">
	<!-- Animated Spinner & Processing Graphic -->
	<div class="relative mb-8 flex h-40 w-40 items-center justify-center">
		<div
			class="absolute h-full w-full animate-spin rounded-full border-4 border-cyan-500/20 border-t-cyan-400"
		></div>
		<div class="absolute h-28 w-28 animate-ping rounded-full bg-cyan-500/10"></div>
		<div
			class="flex h-24 w-24 items-center justify-center rounded-full border border-slate-700 bg-slate-900 shadow-2xl"
		>
			<span class="text-3xl">💳</span>
		</div>
	</div>

	<h2 class="text-3xl font-extrabold text-white sm:text-4xl">กำลังอ่านข้อมูลจากบัตรประชาชน...</h2>
	<p class="mt-3 text-lg text-slate-300">
		โปรดอย่าเพิ่งดึงบัตรออก กำลังดึงข้อมูลและรูปถ่ายจากชิปสมาร์ทการ์ด
	</p>

	<!-- PDPA Disclaimer Card -->
	<div
		class="mt-8 max-w-md rounded-2xl border border-slate-800 bg-slate-900/90 p-5 text-left text-xs text-slate-400 shadow-xl backdrop-blur-sm"
	>
		<div class="flex items-start gap-2.5">
			<ShieldAlert class="mt-0.5 h-4 w-4 shrink-0 text-cyan-400" />
			<div>
				<p class="font-semibold text-slate-200">นโยบายความคุ้มครองข้อมูลส่วนบุคคล (PDPA)</p>
				<p class="mt-1 leading-relaxed">
					ข้อมูลส่วนบุคคลนี้จะถูกใช้เพื่อการลงทะเบียนคัดกรอง จัดสรรที่พักพิง
					และรับสิทธิประโยชน์ตามมาตรการบรรเทาภัยพิบัติ
					โดยข้อมูลจะถูกเข้ารหัสและรักษาความปลอดภัยตามมาตรฐานความปลอดภัยข้อมูล
				</p>
			</div>
		</div>
	</div>
</div>
