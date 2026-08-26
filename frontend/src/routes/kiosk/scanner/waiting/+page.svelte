<script lang="ts">
	import CreditCard from '@lucide/svelte/icons/credit-card';
	import ArrowDown from '@lucide/svelte/icons/arrow-down';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import Timer from '@lucide/svelte/icons/timer';
</script>

<svelte:head>
	<title>กรุณาเสียบบัตรประชาชน — SmartShelter Kiosk</title>
</svelte:head>

<div
	class="flex w-full max-w-5xl flex-col items-center justify-center gap-8 text-center lg:flex-row lg:items-center lg:gap-12 lg:text-left"
>
	<!-- Left / Top Column: 3D Smart Card Mockup with Slot Animation -->
	<div class="flex w-full max-w-sm shrink-0 flex-col items-center justify-center">
		<!-- Card Graphic -->
		<div
			class="relative flex h-48 w-72 flex-col justify-between overflow-hidden rounded-2xl border border-cyan-500/30 bg-gradient-to-br from-slate-800 via-slate-900 to-slate-950 p-5 shadow-2xl ring-1 shadow-cyan-500/10 ring-white/10 backdrop-blur-xl transition-transform hover:scale-[1.02] sm:h-56 sm:w-80"
		>
			<!-- Top row: Thai flag accent & Card type -->
			<div class="flex items-center justify-between">
				<div class="flex h-2.5 w-12 overflow-hidden rounded shadow-sm">
					<div class="w-1/5 bg-red-600"></div>
					<div class="w-1/5 bg-white"></div>
					<div class="w-1/5 bg-blue-800"></div>
					<div class="w-1/5 bg-white"></div>
					<div class="w-1/5 bg-red-600"></div>
				</div>
				<div class="flex items-center gap-1 font-mono text-[9px] font-bold text-slate-400">
					<CreditCard class="h-3.5 w-3.5 text-cyan-400" />
					<span>THAI NATIONAL ID</span>
				</div>
			</div>

			<!-- Middle row: Gold Smart Chip with Golden Glow -->
			<div class="my-auto flex items-center gap-4">
				<div
					class="relative flex h-11 w-14 items-center justify-center rounded-lg border border-amber-300/60 bg-gradient-to-tr from-amber-500 via-yellow-400 to-amber-200 shadow-md ring-2 shadow-amber-500/30 ring-amber-400/40 sm:h-12 sm:w-16"
				>
					<!-- Chip circuit lines -->
					<div class="grid grid-cols-2 grid-rows-2 gap-1 opacity-75">
						<div class="h-2.5 w-4 rounded-sm border border-amber-700/60 bg-amber-600/20"></div>
						<div class="h-2.5 w-4 rounded-sm border border-amber-700/60 bg-amber-600/20"></div>
						<div class="h-2.5 w-4 rounded-sm border border-amber-700/60 bg-amber-600/20"></div>
						<div class="h-2.5 w-4 rounded-sm border border-amber-700/60 bg-amber-600/20"></div>
					</div>
					<!-- Gleam effect -->
					<span
						class="absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-yellow-200 text-[8px] text-amber-900 shadow-sm"
					>
						✨
					</span>
				</div>

				<!-- Mock photo placeholder & ID lines -->
				<div class="flex-1 space-y-2 text-left">
					<div class="h-2.5 w-24 rounded bg-slate-700/80"></div>
					<div class="h-2 w-32 rounded bg-slate-800"></div>
					<div class="h-1.5 w-16 rounded bg-slate-800"></div>
				</div>
			</div>

			<!-- Bottom row: Card specs -->
			<div
				class="flex items-center justify-between border-t border-slate-800/60 pt-2 font-mono text-[9px] text-slate-500"
			>
				<span>13 DIGITS CHIP CARD</span>
				<span class="text-cyan-400/80">SMART CARD</span>
			</div>
		</div>

		<!-- Card Slot Insertion Base with animated down arrow -->
		<div
			class="relative -mt-3 flex h-12 w-80 items-center justify-center rounded-b-2xl border-2 border-dashed border-cyan-400/50 bg-slate-900/90 shadow-xl backdrop-blur-md sm:w-88"
		>
			<div class="flex items-center gap-2 text-xs font-semibold text-cyan-300">
				<div
					class="flex h-7 w-7 animate-bounce items-center justify-center rounded-full bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/50"
				>
					<ArrowDown class="h-4 w-4 stroke-[3]" />
				</div>
				<span>ช่องเสียบบัตร Smart Card Reader</span>
			</div>
		</div>

		<!-- Status Pulse Indicator -->
		<div class="mt-4 flex items-center gap-2 font-mono text-xs text-slate-400">
			<span class="relative flex h-2 w-2">
				<span
					class="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-75"
				></span>
				<span class="relative inline-flex h-2 w-2 rounded-full bg-cyan-500"></span>
			</span>
			<span>กำลังรอการเสียบบัตร...</span>
		</div>
	</div>

	<!-- Right / Bottom Column: Instructions & Steps -->
	<div class="flex max-w-lg flex-1 flex-col items-center lg:items-start">
		<!-- Primary Action Title -->
		<h2 class="text-2xl font-black tracking-tight text-white sm:text-3xl lg:text-4xl">
			กรุณาเสียบบัตรประจำตัวประชาชน
		</h2>

		<div
			class="mt-3 inline-flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-300 shadow-sm"
		>
			<Sparkles class="h-4 w-4 shrink-0 text-amber-400" />
			<span class="font-medium">
				เสียบบัตรเข้าเครื่อง โดยหงาย <b class="font-bold text-amber-200">ด้านชิปสีทองขึ้น</b>
			</span>
		</div>

		<!-- 3-Step Flow Guide -->
		<div class="mt-6 w-full space-y-3 text-left">
			<div
				class="flex items-center gap-3.5 rounded-2xl border border-slate-800/80 bg-slate-900/60 p-3.5 shadow-sm transition-all hover:bg-slate-900/80"
			>
				<div
					class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cyan-500/20 font-mono text-sm font-bold text-cyan-400 ring-1 ring-cyan-400/30"
				>
					1
				</div>
				<div>
					<p class="text-sm font-bold text-slate-200">เสียบบัตรเข้าเครื่องอ่าน</p>
					<p class="text-xs text-slate-400">หงายด้านชิปสีทองขึ้น และเสียบให้สุดช่องอ่าน</p>
				</div>
			</div>

			<div
				class="flex items-center gap-3.5 rounded-2xl border border-slate-800/80 bg-slate-900/60 p-3.5 shadow-sm transition-all hover:bg-slate-900/80"
			>
				<div
					class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-500/20 font-mono text-sm font-bold text-blue-400 ring-1 ring-blue-400/30"
				>
					2
				</div>
				<div>
					<div class="flex items-center gap-1.5">
						<p class="text-sm font-bold text-slate-200">รอระบบอ่านข้อมูล</p>
						<span
							class="flex items-center gap-1 rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-400"
						>
							<Timer class="h-3 w-3 text-cyan-400" />
							1-2 วิ
						</span>
					</div>
					<p class="text-xs text-slate-400">ระบบจะดึงข้อมูลและรูปถ่ายเข้าสู่ระบบศูนย์พักพิง</p>
				</div>
			</div>

			<div
				class="flex items-center gap-3.5 rounded-2xl border border-slate-800/80 bg-slate-900/60 p-3.5 shadow-sm transition-all hover:bg-slate-900/80"
			>
				<div
					class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/20 font-mono text-sm font-bold text-emerald-400 ring-1 ring-emerald-400/30"
				>
					3
				</div>
				<div>
					<p class="text-sm font-bold text-slate-200">ถอดบัตรออกเมื่อเสร็จสิ้น</p>
					<p class="text-xs text-slate-400">
						เมื่อหน้าจอเปลี่ยนเป็นสีเขียว สามารถดึงบัตรออกได้ทันที
					</p>
				</div>
			</div>
		</div>
	</div>
</div>
