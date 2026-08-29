<script lang="ts">
	import { PublicPageShell } from '$lib/features/public-portal';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import Home from '@lucide/svelte/icons/home';
	import Building2 from '@lucide/svelte/icons/building-2';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import Activity from '@lucide/svelte/icons/activity';
</script>

<svelte:head>
	<title>เปิดบ้านเป็น "บ้านพี่เลี้ยง" — Smart Shelter</title>
</svelte:head>

<PublicPageShell class="space-y-6 md:space-y-10">
	<!-- Hero Banner -->
	<div
		class="relative overflow-hidden rounded-3xl bg-primary px-12 py-16 md:px-16 md:py-20 lg:px-20"
	>
		<!-- Subtle Grid Background -->
		<div
			class="absolute inset-0 opacity-10"
			style="background-image: linear-gradient(rgba(255, 255, 255, 0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(255, 255, 255, 0.4) 1px, transparent 1px); background-size: 40px 40px;"
		></div>
		<div class="relative z-10 flex flex-col items-center justify-between gap-10 md:flex-row">
			<!-- Text Content -->
			<div class="max-w-xl flex-1 text-left">
				<div
					class="mb-6 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-xs font-bold text-white backdrop-blur-md"
				>
					<CheckCircle2 class="h-4 w-4" />
					โครงการบ้านพี่เลี้ยง (LEVEL 1 SHELTER)
				</div>

				<h1 class="mb-6 text-3xl leading-tight font-black text-white md:text-5xl lg:text-[56px]">
					เปิดบ้านของคุณ<br />
					เป็น
					<span class="mt-2 inline-block rounded-xl bg-success/80 px-4 py-1.5 leading-tight"
						>"บ้านพี่เลี้ยง"</span
					>
				</h1>

				<p class="mb-8 max-w-md text-sm leading-relaxed font-medium text-white/80 md:text-base">
					เปลี่ยนหน้าบ้านหรือพื้นที่ปลอดภัยของคุณ ให้เป็นที่พึ่งพิงในยามวิกฤต
					ร่วมสร้างเครือข่ายความปลอดภัยระดับชุมชน
				</p>

				<button
					class="rounded-xl bg-white px-8 py-3.5 text-sm font-bold text-primary shadow-lg transition-transform hover:scale-105 active:scale-95"
				>
					ลงทะเบียนเข้าร่วมโครงการ
				</button>
			</div>

			<!-- Graphic Side -->
			<div class="relative flex h-64 w-64 shrink-0 items-center justify-center md:h-80 md:w-80">
				<!-- Outer Circle -->
				<div class="absolute inset-0 rounded-full border border-white/20"></div>
				<!-- Inner Circle -->
				<div class="absolute inset-8 rounded-full border border-white/10"></div>

				<!-- Center Icon -->
				<div class="z-10">
					<Home class="h-24 w-24 text-white opacity-90" strokeWidth={1.5} />
				</div>

				<!-- Orbiting Badges -->
				<div
					class="absolute top-4 right-0 z-20 rotate-12 rounded-full bg-warning px-4 py-1.5 text-xs font-bold text-primary shadow-md"
				>
					บรรเทาทุกข์
				</div>
				<div
					class="absolute right-4 bottom-10 z-20 -rotate-12 rounded-full bg-primary-strong px-4 py-1.5 text-xs font-bold text-white shadow-md"
				>
					ปลอดภัย
				</div>
				<div
					class="absolute top-1/2 left-0 z-20 -translate-y-1/2 -rotate-6 rounded-full bg-success px-4 py-1.5 text-xs font-bold text-white shadow-md"
				>
					มาตรฐาน Sphere
				</div>
			</div>
		</div>
	</div>

	<!-- Features Cards -->
	<div class="grid gap-6 pb-8 md:grid-cols-3">
		<!-- Card 1 -->
		<div
			class="flex flex-col items-center rounded-3xl border border-border/80 bg-white p-8 text-center shadow-sm transition-shadow hover:shadow-md"
		>
			<div class="mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
				<Building2 class="h-6 w-6 text-primary" />
			</div>
			<h3 class="mb-3 text-lg font-black text-foreground">ไม่จำกัดประเภทอาคาร</h3>
			<p class="text-sm leading-relaxed text-muted-foreground">
				บ้านเดี่ยว ตึกแถว คอนโด หรือศาสนสถาน ที่มีโครงสร้างแข็งแรงและพ้นน้ำ
			</p>
		</div>

		<!-- Card 2 -->
		<div
			class="flex flex-col items-center rounded-3xl border border-border/80 bg-white p-8 text-center shadow-sm transition-shadow hover:shadow-md"
		>
			<div class="mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-success/10">
				<ShieldCheck class="h-6 w-6 text-success" />
			</div>
			<h3 class="mb-3 text-lg font-black text-foreground">ยึดมาตรฐานสากล</h3>
			<p class="text-sm leading-relaxed text-muted-foreground">
				ประเมินตามหลัก Sphere Standards ด้านที่อยู่อาศัย น้ำ และสุขอนามัยเบื้องต้น
			</p>
		</div>

		<!-- Card 3 -->
		<div
			class="flex flex-col items-center rounded-3xl border border-border/80 bg-white p-8 text-center shadow-sm transition-shadow hover:shadow-md"
		>
			<div class="mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-warning/15">
				<Activity class="h-6 w-6 text-warning-foreground" />
			</div>
			<h3 class="mb-3 text-lg font-black text-foreground">เตรียมพร้อมรับมือ</h3>
			<p class="text-sm leading-relaxed text-muted-foreground">
				รับการอบรมและป้าย/สติกเกอร์ยืนยัน เพื่อเป็นหน่วยปฏิบัติการเมื่อเกิดภัย
			</p>
		</div>
	</div>
</PublicPageShell>
