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
	import Radio from '@lucide/svelte/icons/radio';
	import ChefHat from '@lucide/svelte/icons/chef-hat';
	import Car from '@lucide/svelte/icons/car';
	import Phone from '@lucide/svelte/icons/phone';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';

	let { data }: { data: PageData } = $props();
	const shelter = data.shelter;
</script>

<svelte:head>
	<title>{shelter?.name || 'ข้อมูลศูนย์พักพิง'} - Smart Shelter</title>
</svelte:head>

<div class="min-h-screen bg-slate-50 pb-20">
	<!-- Top Navigation Bar -->
	<div class="border-b border-slate-200 bg-white">
		<div class="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 md:px-6">
			<a href="/public/shelters" class="flex items-center gap-2 text-sm font-bold text-slate-700 hover:text-primary transition-colors bg-slate-100 py-1.5 px-3 rounded-lg border border-slate-200">
				<ChevronLeft class="h-4 w-4" />
				ย้อนกลับหน้าตรวจสอบสถานะ
			</a>
			<div class="hidden text-[10px] font-bold uppercase tracking-widest text-slate-400 md:block">
				SMARTSHELTER • ข้อมูลศูนย์พักพิงฉบับสมบูรณ์
			</div>
		</div>
	</div>

	{#if shelter}
		<div class="mx-auto max-w-6xl px-4 py-8 md:px-6">
			<!-- Hero Card -->
			<div class="mb-8 overflow-hidden rounded-2xl bg-[#1e293b] text-white shadow-xl relative">
				<div class="absolute inset-0 opacity-10 bg-[radial-gradient(#fff_1px,transparent_1px)] [background-size:20px_20px]"></div>
				
				<div class="relative p-6 md:p-10">
					<!-- Status Pill -->
					<div class="mb-5 inline-flex items-center gap-1.5 rounded-full bg-emerald-500/20 border border-emerald-500/30 px-3 py-1 text-xs font-bold text-emerald-400">
						<span class="relative flex h-2 w-2">
						  <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
						  <span class="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
						</span>
						{shelter.status === 'OPEN' ? 'เปิดรับผู้อพยพ' : shelter.status}
					</div>

					<!-- Title & Subtitle -->
					<h1 class="mb-3 text-3xl font-bold tracking-tight md:text-4xl">{shelter.name}</h1>
					<div class="mb-10 flex flex-wrap items-center gap-3 text-sm text-slate-300">
						<div class="flex items-center gap-1.5">
							<MapPin class="h-4 w-4 text-amber-400" />
							{shelter.address}
						</div>
						<span class="rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-semibold text-white/90 border border-white/20">
							{shelter.admin_type}
						</span>
					</div>

					<!-- Stats Grid -->
					<div class="flex flex-col md:flex-row md:items-end justify-between gap-6 border-t border-white/10 pt-6">
						<div class="grid grid-cols-2 md:flex gap-8">
							<div>
								<div class="mb-1 text-xs font-semibold text-slate-400">ความจุ (ว่าง / ทั้งหมด)</div>
								<div class="flex items-baseline gap-1.5">
									<span class="text-3xl font-bold text-emerald-400">{shelter.capacity.available}</span>
									<span class="text-xl font-medium text-slate-500">/</span>
									<span class="text-xl font-bold text-white">{shelter.capacity.total}</span>
									<span class="text-sm font-medium text-slate-400">คน</span>
								</div>
							</div>
							
							<div>
								<div class="mb-1 text-xs font-semibold text-slate-400">อัตราครองเตียง</div>
								<div class="text-3xl font-bold text-white">{shelter.occupancy_rate}%</div>
							</div>

							<div class="col-span-2 md:col-span-1">
								<div class="mb-1 text-xs font-semibold text-slate-400">สถานะอาคาร</div>
								<div class="flex items-center gap-2 text-base font-bold text-white">
									<CheckCircle2 class="h-5 w-5 text-amber-400" />
									{shelter.building_status}
								</div>
							</div>
						</div>

						<a 
							href={`https://www.google.com/maps/dir/?api=1&destination=${shelter.geo.lat},${shelter.geo.lng}`}
							target="_blank"
							class="flex w-fit items-center gap-2 rounded-xl bg-amber-400 px-6 py-3.5 text-sm font-bold text-[#1e293b] transition-colors hover:bg-amber-300 shadow-lg"
						>
							<Navigation class="h-4.5 w-4.5" />
							นำทางด้วย Google Maps
						</a>
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
							<CheckCircle2 class="h-5 w-5 text-emerald-600" />
							<h2 class="text-lg font-bold text-slate-800">นโยบายการรับเข้าพัก (Admission Policy)</h2>
						</div>
						
						<div class="flex flex-col gap-3">
							<!-- Pets -->
							<div class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm flex items-start gap-4">
								<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-orange-50 text-orange-500">
									<Dog class="h-5 w-5" />
								</div>
								<div>
									<h3 class="font-bold text-slate-800 text-sm mb-1">นโยบายสัตว์เลี้ยง</h3>
									<p class="text-sm text-slate-600">{shelter.admission_policy.pets}</p>
								</div>
							</div>

							<!-- Vulnerable -->
							<div class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm flex items-start gap-4">
								<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-purple-50 text-purple-500">
									<Users class="h-5 w-5" />
								</div>
								<div>
									<h3 class="font-bold text-slate-800 text-sm mb-1">กลุ่มเปราะบางที่รองรับได้เป็นพิเศษ</h3>
									<p class="text-sm text-slate-600">{shelter.admission_policy.vulnerable_groups.join(', ')}</p>
								</div>
							</div>
						</div>
					</section>

					<!-- Travel & Limitations -->
					<section>
						<div class="mb-4 flex items-center gap-2">
							<AlertTriangle class="h-5 w-5 text-amber-500" />
							<h2 class="text-lg font-bold text-slate-800">การเดินทางและข้อจำกัด</h2>
						</div>

						<div class="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
							<div class="flex justify-between items-center p-4 border-b border-slate-100">
								<span class="text-sm font-semibold text-slate-500">เส้นทางเข้าศูนย์</span>
								<span class="text-sm font-bold text-slate-800">{shelter.travel.route}</span>
							</div>
							<div class="flex justify-between items-center p-4 border-b border-slate-100">
								<span class="text-sm font-semibold text-slate-500">ระดับความสูงจากน้ำทะเล</span>
								<span class="text-sm font-bold text-slate-800">{shelter.travel.altitude}</span>
							</div>
							<div class="p-4 bg-red-50/50">
								<div class="flex items-center gap-2 text-sm font-bold text-red-600">
									⚠️ {shelter.travel.flood_warning}
								</div>
							</div>
						</div>
					</section>
				</div>

				<!-- RIGHT COLUMN -->
				<div class="flex flex-col gap-8">
					<!-- Facilities -->
					<section>
						<div class="mb-4 flex items-center gap-2">
							<Droplets class="h-5 w-5 text-blue-500" />
							<h2 class="text-lg font-bold text-slate-800">สิ่งอำนวยความสะดวกในศูนย์</h2>
						</div>

						<div class="flex flex-col gap-4">
							<!-- Hygiene -->
							<div class="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
								<h3 class="font-bold text-slate-800 text-sm mb-3">สุขอนามัย (ห้องน้ำ/ห้องอาบน้ำ)</h3>
								<div class="flex flex-wrap gap-4 text-sm mb-3">
									<div class="bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-100"><span class="text-slate-500">ชาย:</span> <span class="font-bold">{shelter.facilities.hygiene.male}</span></div>
									<div class="bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-100"><span class="text-slate-500">หญิง:</span> <span class="font-bold">{shelter.facilities.hygiene.female}</span></div>
									<div class="bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-100"><span class="text-slate-500">คนพิการ:</span> <span class="font-bold">{shelter.facilities.hygiene.accessible}</span></div>
									<div class="bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-100"><span class="text-slate-500">อาบน้ำ:</span> <span class="font-bold">{shelter.facilities.hygiene.shower}</span></div>
								</div>
								<div class="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-md">
									+ รถสุขาเคลื่อนที่ ({shelter.facilities.hygiene.mobile_toilet} คัน)
								</div>
							</div>

							<!-- Power & Comms Grid -->
							<div class="grid grid-cols-2 gap-4">
								<div class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
									<div class="flex items-center gap-1.5 mb-3">
										<Zap class="h-4 w-4 text-blue-500" />
										<h3 class="font-bold text-slate-800 text-sm">พลังงานประปา</h3>
									</div>
									<div class="text-xs space-y-2">
										<div class="flex justify-between border-b border-slate-100 pb-1"><span class="text-slate-500">ไฟฟ้าหลัก:</span> <span class="font-bold">{shelter.facilities.power}</span></div>
										<div class="flex justify-between"><span class="text-slate-500">น้ำประปา:</span> <span class="font-bold">{shelter.facilities.water}</span></div>
									</div>
								</div>
								
								<div class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
									<div class="flex items-center gap-1.5 mb-3">
										<Signal class="h-4 w-4 text-blue-500" />
										<h3 class="font-bold text-slate-800 text-sm">การสื่อสาร</h3>
									</div>
									<div class="text-xs space-y-2">
										<div class="flex justify-between border-b border-slate-100 pb-1"><span class="text-slate-500">สัญญาณมือถือ</span> <span class="font-bold">{shelter.facilities.comms.includes('สัญญาณมือถือ') ? 'มี' : 'ไม่มี'}</span></div>
										<div class="flex justify-between"><span class="text-slate-500">VHF</span> <span class="font-bold">{shelter.facilities.comms.includes('VHF') ? 'มี' : 'ไม่มี'}</span></div>
									</div>
								</div>
							</div>

							<!-- Badges -->
							<div class="flex flex-wrap gap-3 mt-1">
								<div class="flex items-center gap-1.5 bg-amber-50 border border-amber-200 text-amber-700 px-3 py-2 rounded-xl text-sm font-bold shadow-sm">
									<ChefHat class="h-4 w-4" />
									{shelter.facilities.kitchen}
								</div>
								<div class="flex items-center gap-1.5 bg-slate-100 border border-slate-200 text-slate-700 px-3 py-2 rounded-xl text-sm font-bold shadow-sm">
									<Car class="h-4 w-4" />
									{shelter.facilities.parking}
								</div>
							</div>
						</div>
					</section>

					<!-- Contact & FAQ -->
					<section>
						<div class="mb-4 flex items-center gap-2">
							<Phone class="h-5 w-5 text-emerald-600" />
							<h2 class="text-lg font-bold text-slate-800">ติดต่อสอบถาม & คำถามที่พบบ่อย</h2>
						</div>

						<div class="rounded-xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm mb-4 flex items-center gap-4">
							<div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
								<Phone class="h-6 w-6" />
							</div>
							<div>
								<div class="text-sm font-bold text-emerald-900">ผู้ดูแลศูนย์: {shelter.contact.manager}</div>
								<div class="text-xl font-bold text-emerald-700">{shelter.contact.phone}</div>
							</div>
						</div>

						<div class="flex flex-col gap-2">
							{#each shelter.faq as item, i}
								<details class="group rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
									<summary class="flex cursor-pointer items-start justify-between gap-4 p-4 font-bold text-slate-800 hover:bg-slate-50 text-sm list-none [&::-webkit-details-marker]:hidden">
										<div class="flex gap-2 items-start">
											<span class="text-primary mt-0.5">Q:</span>
											<span>{item.q}</span>
										</div>
										<ChevronDown class="h-5 w-5 shrink-0 text-slate-400 transition-transform group-open:rotate-180" />
									</summary>
									<div class="bg-slate-50 p-4 pt-2 text-sm text-slate-600 border-t border-slate-100 flex gap-2 items-start">
										<span class="text-emerald-600 font-bold">A:</span>
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
			<AlertTriangle class="mb-4 h-12 w-12 text-slate-300" />
			<h2 class="text-xl font-bold text-slate-700">ไม่พบข้อมูลศูนย์พักพิง</h2>
			<p class="mt-2 text-sm text-slate-500">
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
