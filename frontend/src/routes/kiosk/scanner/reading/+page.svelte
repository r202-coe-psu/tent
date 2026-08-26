<script lang="ts">
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import Cpu from '@lucide/svelte/icons/cpu';
	import CreditCard from '@lucide/svelte/icons/credit-card';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
</script>

<svelte:head>
	<title>กำลังอ่านข้อมูลบัตรประชาชน — SmartShelter Kiosk</title>
</svelte:head>

<div class="flex w-full max-w-2xl flex-col items-center text-center">
	<!-- Holographic Scanning Ring Animation -->
	<div class="relative my-4 flex h-44 w-44 items-center justify-center sm:my-6 sm:h-52 sm:w-52">
		<!-- Outer pulsating orb -->
		<div
			class="absolute h-full w-full animate-ping rounded-full bg-cyan-500/15 duration-1000"
		></div>

		<!-- Rotating radar rings -->
		<div
			class="absolute h-40 w-40 animate-spin rounded-full border-2 border-dashed border-cyan-500/30 duration-3000 sm:h-48 sm:w-48"
		></div>
		<div
			class="absolute h-32 w-32 animate-spin rounded-full border-2 border-cyan-400/40 border-t-cyan-300 sm:h-40 sm:w-40"
		></div>

		<!-- Central Card Visual & Glowing Core -->
		<div
			class="relative flex h-24 w-24 items-center justify-center rounded-3xl border border-cyan-500/40 bg-gradient-to-tr from-slate-900 to-slate-800 shadow-2xl ring-2 shadow-cyan-500/30 ring-cyan-400/30 sm:h-28 sm:w-28"
		>
			<CreditCard class="h-10 w-10 text-cyan-400 sm:h-12 sm:w-12" />
			<div class="absolute -top-1.5 -right-1.5 flex h-6 w-6 items-center justify-center">
				<span class="absolute h-full w-full animate-ping rounded-full bg-cyan-400 opacity-75"
				></span>
				<span class="relative h-3 w-3 rounded-full bg-cyan-400"></span>
			</div>
		</div>
	</div>

	<!-- Title & Reading Status -->
	<div class="max-w-md space-y-2">
		<div
			class="inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3.5 py-1 font-mono text-xs font-semibold text-cyan-400"
		>
			<Cpu class="h-3.5 w-3.5 animate-spin" />
			<span>SMART CARD READING IN PROGRESS</span>
		</div>
		<h2 class="text-2xl font-black tracking-tight text-white sm:text-3xl lg:text-4xl">
			กำลังอ่านข้อมูลจากบัตรประชาชน...
		</h2>
		<p class="text-sm font-medium text-slate-300">
			กำลังดึงข้อมูลส่วนบุคคลและรูปถ่ายจากชิปสมาร์ทการ์ด
		</p>
	</div>

	<!-- Scanning Progress Line Animation -->
	<div class="mt-4 w-full max-w-md overflow-hidden rounded-full bg-slate-800/80 p-1">
		<div class="relative h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
			<div
				class="absolute inset-y-0 w-1/2 animate-[pulse_1.5s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-cyan-400 to-transparent"
				style="animation: shimmer 1.5s infinite;"
			></div>
		</div>
	</div>

	<!-- Critical Warning Callout -->
	<div
		class="mt-6 flex w-full max-w-lg items-center gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-left text-xs font-medium text-amber-300 shadow-sm"
	>
		<AlertCircle class="h-5 w-5 shrink-0 text-amber-400" />
		<div>
			<p class="font-bold text-amber-200">โปรดอย่าเพิ่งดึงบัตรออก</p>
			<p class="text-amber-300/80">ระบบกำลังประมวลผลข้อมูล โปรดรอสักครู่ (ประมาณ 1-2 วินาที)</p>
		</div>
	</div>

	<!-- PDPA Disclaimer Card -->
	<div
		class="mt-4 w-full max-w-lg rounded-2xl border border-slate-800/80 bg-slate-900/60 p-4 text-left text-xs text-slate-400 shadow-sm backdrop-blur-sm"
	>
		<div class="flex items-start gap-2.5">
			<ShieldAlert class="mt-0.5 h-4 w-4 shrink-0 text-cyan-400" />
			<div class="space-y-1">
				<p class="font-bold text-slate-200">นโยบายความคุ้มครองข้อมูลส่วนบุคคล (PDPA)</p>
				<p class="text-[11px] leading-relaxed text-slate-400">
					ข้อมูลส่วนบุคคลนี้จะถูกใช้เพื่อการลงทะเบียนคัดกรอง จัดสรรที่พักพิง
					และรับสิทธิประโยชน์ตามมาตรการบรรเทาภัยพิบัติ
					โดยข้อมูลจะถูกเข้ารหัสและรักษาความปลอดภัยตามมาตรฐานความปลอดภัยข้อมูล
				</p>
			</div>
		</div>
	</div>
</div>

<style>
	@keyframes shimmer {
		0% {
			transform: translateX(-100%);
		}
		100% {
			transform: translateX(200%);
		}
	}
</style>
