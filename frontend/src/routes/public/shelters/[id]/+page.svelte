<script lang="ts">
	import type { PageData } from './$types';
	// Icons
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Navigation from '@lucide/svelte/icons/navigation';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import Dog from '@lucide/svelte/icons/dog';
	import Users from '@lucide/svelte/icons/users';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import Droplets from '@lucide/svelte/icons/droplets';
	import Zap from '@lucide/svelte/icons/zap';
	import Signal from '@lucide/svelte/icons/signal';
	import ChefHat from '@lucide/svelte/icons/chef-hat';
	import Car from '@lucide/svelte/icons/car';
	import Phone from '@lucide/svelte/icons/phone';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Button from '$lib/components/ui/button/button.svelte';

	let { data }: { data: PageData } = $props();
	let shelter = $derived(data.shelter);
</script>

<svelte:head>
	<title>{shelter?.name || 'ข้อมูลศูนย์พักพิง'} - Smart Shelter</title>
</svelte:head>

<div class="min-h-screen pb-20">
	<!-- Top Navigation Bar -->
	<div class="border-b border-border bg-white">
		<div class="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 md:px-6">
			<a
				href="/public/shelters"
				class="flex items-center gap-2 rounded-lg border border-border bg-muted px-3 py-1.5 text-sm font-bold text-foreground/90 transition-colors hover:text-primary"
			>
				<ChevronLeft class="h-4 w-4" />
				ย้อนกลับหน้าตรวจสอบสถานะ
			</a>
			<div
				class="hidden text-[10px] font-bold tracking-widest text-muted-foreground/80 uppercase md:block"
			>
				SMARTSHELTER • ข้อมูลศูนย์พักพิงฉบับสมบูรณ์
			</div>
		</div>
	</div>

	{#if shelter}
		<div class="mx-auto max-w-6xl px-4 py-8 md:px-6">
			<!-- Hero Card -->
			<div class="relative mb-8 overflow-hidden rounded-2xl bg-primary-dark text-white shadow-xl">
				<div
					class="absolute inset-0 bg-[radial-gradient(#fff_1px,transparent_1px)] [background-size:20px_20px] opacity-10"
				></div>

				<div class="relative p-6 md:p-10">
					<!-- Status Pill -->
					<div
						class="mb-5 inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success/20 px-3 py-1 text-xs font-bold text-success-subtle"
					>
						<span class="relative flex h-2 w-2">
							<span
								class="absolute inline-flex h-full w-full animate-ping rounded-full bg-success-subtle opacity-75"
							></span>
							<span class="relative inline-flex h-2 w-2 rounded-full bg-success"></span>
						</span>
						{shelter.status === 'OPEN' ? 'เปิดรับผู้อพยพ' : shelter.status}
					</div>

					<!-- Title & Subtitle -->
					<h1 class="mb-3 text-3xl font-bold tracking-tight md:text-4xl">{shelter.name}</h1>
					<div class="mb-10 flex flex-wrap items-center gap-3 text-sm text-muted-foreground/60">
						<div class="flex items-center gap-1.5 text-accent">
							<MapPin class="h-4 w-4 text-warning" />
							{shelter.address}
						</div>
						<span
							class="rounded-full border border-white/20 bg-white/10 px-2.5 py-0.5 text-xs font-semibold text-white/90"
						>
							{shelter.admin_type}
						</span>
					</div>

					<!-- Stats Grid -->
					<div
						class="flex flex-col justify-between gap-6 border-t border-white/10 pt-6 md:flex-row md:items-end"
					>
						<div class="grid grid-cols-2 gap-8 md:flex">
							<div>
								<div class="mb-1 text-xs font-semibold text-secondary/80">
									ความจุ (ว่าง / ทั้งหมด)
								</div>
								<div class="flex items-baseline gap-1.5">
									<span class="text-3xl font-bold text-success-subtle"
										>{shelter.capacity.available}</span
									>
									<span class="text-xl font-medium text-secondary">/</span>
									<span class="text-xl font-bold text-white">{shelter.capacity.total}</span>
									<span class="text-sm font-medium text-secondary/80">คน</span>
								</div>
							</div>

							<div>
								<div class="mb-1 text-xs font-semibold text-secondary/80">อัตราครองเตียง</div>
								<div class="text-3xl font-bold text-white">{shelter.occupancy_rate}%</div>
							</div>

							<div class="col-span-2 items-center justify-around md:col-span-1 md:space-y-2">
								<div class="text-xs font-semibold text-secondary/80">สถานะอาคาร</div>
								<div class="flex items-end gap-2 self-end text-xl font-bold text-white">
									<CheckCircle2 class="h-5 w-5 text-warning-subtle" />
									{shelter.building_status}
								</div>
							</div>
						</div>

						<Button
							onclick={() =>
								window.open(
									`https://www.google.com/maps/dir/?api=1&destination=${shelter.geo.lat},${shelter.geo.lng}`,
									'_blank'
								)}
							target="_blank"
							class="flex w-fit items-center gap-2 rounded-xl bg-warning px-6 py-3.5 text-sm font-bold text-warning-foreground shadow-lg transition-colors hover:bg-warning-subtle"
						>
							<Navigation class="h-4.5 w-4.5" />
							นำทางด้วย Google Maps
						</Button>
					</div>
				</div>
			</div>

			<!-- Main Content Grid -->
			<div class="grid grid-cols-1 gap-8 lg:grid-cols-2">
				<!-- LEFT COLUMN -->
				<div class="flex flex-col gap-8">
					<!-- Admission Policy -->
					<section>
						<div class="mb-4 flex items-center gap-2">
							<CheckCircle2 class="h-5 w-5 text-success-dark" />
							<h2 class="text-lg font-bold text-foreground">
								นโยบายการรับเข้าพัก (Admission Policy)
							</h2>
						</div>

						<div class="flex flex-col gap-3">
							<!-- Pets -->
							<div
								class="flex items-start gap-4 rounded-xl border border-border bg-white p-4 shadow-sm"
							>
								<div
									class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-warning/15 text-warning-dark"
								>
									<Dog class="h-5 w-5" />
								</div>
								<div>
									<h3 class="mb-1 text-sm font-bold text-foreground">นโยบายสัตว์เลี้ยง</h3>
									<p class="text-sm text-muted-foreground">{shelter.admission_policy.pets}</p>
								</div>
							</div>

							<!-- Vulnerable -->
							<div
								class="flex items-start gap-4 rounded-xl border border-border bg-white p-4 shadow-sm"
							>
								<div
									class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-purple-muted text-accent-purple"
								>
									<Users class="h-5 w-5" />
								</div>
								<div>
									<h3 class="mb-1 text-sm font-bold text-foreground">
										กลุ่มเปราะบางที่รองรับได้เป็นพิเศษ
									</h3>
									<p class="text-sm text-muted-foreground">
										{shelter.admission_policy.vulnerable_groups.join(', ')}
									</p>
								</div>
							</div>
						</div>
					</section>

					<!-- Travel & Limitations -->
					<section>
						<div class="mb-4 flex items-center gap-2">
							<AlertTriangle class="h-5 w-5 text-warning" />
							<h2 class="text-lg font-bold text-foreground">การเดินทางและข้อจำกัด</h2>
						</div>

						<div class="overflow-hidden rounded-xl border border-border bg-white shadow-sm">
							<div class="flex items-center justify-between border-b border-border/50 p-4">
								<span class="text-sm font-semibold text-muted-foreground">เส้นทางเข้าศูนย์</span>
								<span class="text-sm font-bold text-foreground">{shelter.travel.route}</span>
							</div>
							<div class="flex items-center justify-between border-b border-border/50 p-4">
								<span class="text-sm font-semibold text-muted-foreground"
									>ระดับความสูงจากน้ำทะเล</span
								>
								<span class="text-sm font-bold text-foreground">{shelter.travel.altitude}</span>
							</div>
							{#if shelter.travel.flood_warning}
								<div class="bg-danger-muted/50 p-4">
									<div class="flex items-center gap-2 text-sm font-bold text-danger">
										⚠️ {shelter.travel.flood_warning}
									</div>
								</div>
							{/if}
						</div>
					</section>
				</div>

				<!-- RIGHT COLUMN -->
				<div class="flex flex-col gap-8">
					<!-- Facilities -->
					<section>
						<div class="mb-4 flex items-center gap-2">
							<Droplets class="h-5 w-5 text-primary" />
							<h2 class="text-lg font-bold text-foreground">สิ่งอำนวยความสะดวกในศูนย์</h2>
						</div>

						<div class="flex flex-col gap-4">
							<!-- Hygiene -->
							<div class="rounded-xl border border-border bg-white p-5 shadow-sm">
								<h3 class="mb-3 text-sm font-bold text-foreground">
									สุขอนามัย (ห้องน้ำ/ห้องอาบน้ำ)
								</h3>
								<div class="mb-3 flex flex-wrap gap-4 text-sm">
									<div class="rounded-lg border border-border/50 bg-muted/50 px-3 py-1.5">
										<span class="text-muted-foreground">ชาย:</span>
										<span class="font-bold">{shelter.facilities.hygiene.male}</span>
									</div>
									<div class="rounded-lg border border-border/50 bg-muted/50 px-3 py-1.5">
										<span class="text-muted-foreground">หญิง:</span>
										<span class="font-bold">{shelter.facilities.hygiene.female}</span>
									</div>
									<div class="rounded-lg border border-border/50 bg-muted/50 px-3 py-1.5">
										<span class="text-muted-foreground">คนพิการ:</span>
										<span class="font-bold">{shelter.facilities.hygiene.accessible}</span>
									</div>
									<div class="rounded-lg border border-border/50 bg-muted/50 px-3 py-1.5">
										<span class="text-muted-foreground">อาบน้ำ:</span>
										<span class="font-bold">{shelter.facilities.hygiene.shower}</span>
									</div>
								</div>
								{#if shelter.facilities.hygiene.mobile_toilet > 0}
									<div class="flex flex-wrap gap-2">
										<div
											class="inline-flex items-center gap-1.5 rounded-md bg-success-muted px-2 py-1 text-xs font-bold text-success-dark"
										>
											<CheckCircle2 class="h-3 w-3" />
											มีรถสุขาเคลื่อนที่ให้บริการ
										</div>
										<span class="text-xs text-muted-foreground"
											>จำนวน {shelter.facilities.hygiene.mobile_toilet} คัน</span
										>
									</div>
								{/if}
							</div>

							<!-- Power & Comms Grid -->
							<div class="grid grid-cols-2 gap-4">
								<div class="rounded-xl border border-border bg-white p-4 shadow-sm">
									<div class="mb-3 flex items-center gap-1.5">
										<Zap class="h-4 w-4 text-primary" />
										<h3 class="text-sm font-bold text-foreground">พลังงานประปา</h3>
									</div>
									<div class="space-y-2 text-xs">
										<div class="flex justify-between border-b border-border/50 pb-1">
											<span class="text-muted-foreground">ไฟฟ้าหลัก:</span>
											<span class="font-bold">{shelter.facilities.power}</span>
										</div>
										<div class="flex justify-between">
											<span class="text-muted-foreground">น้ำประปา:</span>
											<span class="font-bold">{shelter.facilities.water}</span>
										</div>
									</div>
								</div>

								<div class="rounded-xl border border-border bg-white p-4 shadow-sm">
									<div class="mb-3 flex items-center gap-1.5">
										<Signal class="h-4 w-4 text-primary" />
										<h3 class="text-sm font-bold text-foreground">การสื่อสาร</h3>
									</div>
									<div class="space-y-2 text-xs">
										<div class="flex justify-between border-b border-border/50 pb-1">
											<span class="text-muted-foreground">สัญญาณมือถือ</span>
											<span class="font-bold"
												>{shelter.facilities.comms.includes('สัญญาณมือถือ') ? 'มี' : 'ไม่มี'}</span
											>
										</div>
										<div class="flex justify-between">
											<span class="text-muted-foreground">VHF</span>
											<span class="font-bold"
												>{shelter.facilities.comms.includes('VHF') ? 'มี' : 'ไม่มี'}</span
											>
										</div>
									</div>
								</div>
							</div>

							<!-- Badges -->
							<div class="mt-1 flex flex-wrap gap-3">
								<div
									class="flex items-center gap-1.5 rounded-xl bg-warning px-3 py-2 text-sm font-bold text-warning-foreground shadow-sm"
								>
									<ChefHat class="h-4 w-4" />
									{shelter.facilities.kitchen}
								</div>
								<div
									class="flex items-center gap-1.5 rounded-xl border border-border bg-muted px-3 py-2 text-sm font-bold text-foreground/90 shadow-sm"
								>
									<Car class="h-4 w-4" />
									{shelter.facilities.parking}
								</div>
							</div>
						</div>
					</section>

					<!-- Contact & FAQ -->
					<section>
						<div class="mb-4 flex items-center gap-2">
							<Phone class="h-5 w-5 text-success-dark" />
							<h2 class="text-lg font-bold text-foreground">ติดต่อสอบถาม</h2>
						</div>

						<div
							class="mb-4 flex items-center gap-4 rounded-xl border border-success-border bg-success-muted p-5 shadow-sm"
						>
							<div
								class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-success/20 text-success-dark"
							>
								<Phone class="h-6 w-6" />
							</div>
							<div>
								<div class="text-sm font-bold text-success-dark">
									ผู้ดูแลศูนย์: {shelter.contact.manager}
								</div>
								<div class="text-xl font-bold text-success-dark">{shelter.contact.phone}</div>
							</div>
						</div>

						<div class="flex flex-col gap-2">
							{#each shelter.faq as item (item.q)}
								<details
									class="group overflow-hidden rounded-xl border border-border bg-white shadow-sm"
								>
									<summary
										class="flex cursor-pointer list-none items-start justify-between gap-4 p-4 text-sm font-bold text-foreground hover:bg-muted/50 [&::-webkit-details-marker]:hidden"
									>
										<div class="flex items-start gap-2">
											<span class="mt-0.5 text-primary">Q:</span>
											<span>{item.q}</span>
										</div>
										<ChevronDown
											class="h-5 w-5 shrink-0 text-muted-foreground/80 transition-transform group-open:rotate-180"
										/>
									</summary>
									<div
										class="flex items-start gap-2 border-t border-border/50 bg-muted/50 p-4 pt-2 text-sm text-muted-foreground"
									>
										<span class="font-bold text-success-dark">A:</span>
										<span>{item.a}</span>
									</div>
								</details>
							{/each}
						</div>
					</section>
				</div>
			</div>
		</div>
	{:else}
		<div class="flex min-h-[50vh] flex-col items-center justify-center px-4 py-20 text-center">
			<AlertTriangle class="mb-4 h-12 w-12 text-muted-foreground/60" />
			<h2 class="text-xl font-bold text-foreground/90">ไม่พบข้อมูลศูนย์พักพิง</h2>
			<p class="mt-2 text-sm text-muted-foreground">
				ขออภัย ข้อมูลที่คุณต้องการค้นหาอาจถูกลบหรือไม่มีอยู่ในระบบ
			</p>
			<a
				href="/public/shelters"
				class="mt-6 inline-flex h-10 items-center justify-center rounded-lg bg-primary px-6 text-sm font-bold text-primary-foreground shadow-sm hover:bg-primary/90"
			>
				กลับไปหน้าตรวจสอบสถานะ
			</a>
		</div>
	{/if}
</div>
