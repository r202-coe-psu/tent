<script lang="ts">
	import CreditCard from '@lucide/svelte/icons/credit-card';
	import ArrowDown from '@lucide/svelte/icons/arrow-down';
</script>

<svelte:head>
	<title>กรุณาเสียบบัตรประชาชน — SmartShelter Kiosk</title>
</svelte:head>

<div class="flex max-w-xl flex-col items-center text-center">
	<!-- Animated Card Insertion Graphic -->
	<div
		class="relative mb-8 flex h-52 w-80 flex-col items-center justify-center rounded-2xl border-2 border-dashed border-cyan-500/40 bg-slate-900/60 p-6 shadow-2xl backdrop-blur-xl"
	>
		<div
			class="relative flex h-32 w-52 flex-col justify-between rounded-xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-900 p-4 shadow-xl"
		>
			<div class="flex items-center justify-between">
				<div class="h-4 w-6 rounded bg-amber-400/80 shadow-inner"></div>
				<CreditCard class="h-5 w-5 text-slate-400" />
			</div>
			<div class="space-y-1 text-left">
				<div class="h-2 w-24 rounded bg-slate-700"></div>
				<div class="h-1.5 w-16 rounded bg-slate-700"></div>
			</div>
			<div class="flex justify-between font-mono text-[8px] text-slate-400">
				<span>THAI SMART CARD</span>
				<span>13 DIGITS</span>
			</div>
		</div>

		<!-- Animated down arrow -->
		<div
			class="absolute -bottom-4 flex h-8 w-8 animate-bounce items-center justify-center rounded-full bg-cyan-500 text-slate-950 shadow-lg shadow-cyan-500/40"
		>
			<ArrowDown class="h-5 w-5" />
		</div>
	</div>

	<!-- Action Instruction -->
	<h2 class="text-3xl font-extrabold text-white sm:text-4xl">กรุณาเสียบบัตรประจำตัวประชาชน</h2>
	<p class="mt-3 text-lg text-slate-300">
		เสียบบัตรเข้าเครื่องอ่าน โดยหงาย <span class="font-semibold text-amber-400"
			>ด้านชิปสีทองขึ้น</span
		>
	</p>

	<div
		class="mt-8 flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/80 px-6 py-3 text-sm text-slate-400 shadow-inner"
	>
		<span class="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-cyan-400"></span>
		<span>ระบบจะทำการอ่านข้อมูลและรูปถ่ายโดยอัตโนมัติ</span>
	</div>
</div>
