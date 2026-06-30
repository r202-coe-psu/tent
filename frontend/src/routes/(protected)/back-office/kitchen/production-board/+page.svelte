<script lang="ts">
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ChefHat from '@lucide/svelte/icons/chef-hat';
	import ClipboardList from '@lucide/svelte/icons/clipboard-list';
	import Flame from '@lucide/svelte/icons/flame';
	import Plus from '@lucide/svelte/icons/plus';
	import Scan from '@lucide/svelte/icons/scan';
	import Play from '@lucide/svelte/icons/play';
	import Ban from '@lucide/svelte/icons/ban';
	import AlertTriangle from '@lucide/svelte/icons/triangle-alert';
	import { page } from '$app/stores';
	import { resolve } from '$app/paths';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Button } from '$lib/components/ui/button';
	import { useActiveSopProfile } from '$lib/features/sop-ratios';
	import { useGasCylinderTypes, MEAL_PERIOD_LABELS } from '$lib/features/kitchen';

	const sopProfile = useActiveSopProfile();
	const gasTypes = useGasCylinderTypes();

	const mode = $derived($page.url.searchParams.get('mode') ?? 'bom');
	const planRef = $derived($page.url.searchParams.get('ref'));
	const isManage = $derived(!!planRef);

	function formatId(id: string): string {
		const suffix = id?.split(':').pop() ?? id ?? '';
		return `PRD-${suffix.slice(-4).toUpperCase()}`;
	}
	const displayRef = $derived(planRef ? formatId(planRef) : null);

	// BOM/Custom state
	let headcount = $state(3);
	let selectedMeal = $state('lunch');
	let customName = $state('');

	// Manage state (mock values)
	let manageHeadcount = $state(120);
	let manageStatus = $state('confirmed');
	let stove1Qty = $state(128);
	let stove2Qty = $state(0);

	const MEAL_OPTIONS = [
		{ value: 'breakfast', label: 'มื้อเช้า — ข้าวต้ม + ไข่ต้ม' },
		{ value: 'lunch', label: 'มื้อกลางวัน — ข้าวสวย + ไข่ต้ม (มาตรฐานช่วยผู้ประสบภัย)' },
		{ value: 'dinner', label: 'มื้อเย็น — ข้าวสวย + แกงจืด' }
	];

	const STATUS_OPTIONS = [
		{ value: 'draft', label: 'รอดำเนินการ (Draft)' },
		{ value: 'confirmed', label: 'Completed (สำเร็จสมบูรณ์)' }
	];

	// Mock BOM rows for standard mode
	const BOM_ROWS = $derived([
		{
			name: 'ข้าวสาร (ข้าวหอมมะลิ)',
			perPerson: 300,
			unit: 'g',
			total: ((300 * headcount) / 1000).toFixed(2),
			totalUnit: 'กก.',
			status: ''
		},
		{ name: 'ไข่', perPerson: 0, unit: 'ฟอง', total: '0.00', totalUnit: 'ฟอง', status: 'exceed' },
		{
			name: 'น้ำดื่มและประกอบการ',
			perPerson: 0.6,
			unit: 'ล.',
			total: '0.00',
			totalUnit: 'ล.',
			status: 'exceed'
		},
		{
			name: 'ถุงแก๊สขวด + ถัง 15kg',
			perPerson: 0.01,
			unit: 'กก.',
			total: '45.00',
			totalUnit: 'กก.',
			status: ''
		},
		{
			name: 'ถาดน้ำ + ถัง 4kg',
			perPerson: 0.01,
			unit: 'กก.',
			total: '45.00',
			totalUnit: 'กก.',
			status: ''
		}
	]);

	// Mock custom BOM rows (fewer items)
	const CUSTOM_ROWS = $derived([
		{
			name: 'ถุงแก๊สขวด + ถัง 15kg',
			perPerson: 0.01,
			unit: 'กก.',
			total: '45.00',
			totalUnit: 'กก.',
			status: ''
		},
		{
			name: 'ถาดน้ำ + ถัง 4kg',
			perPerson: 0.01,
			unit: 'กก.',
			total: '45.00',
			totalUnit: 'กก.',
			status: ''
		}
	]);

	// Mock manage BOM rows
	const MANAGE_ROWS = [
		{
			name: 'ข้าวสาร (ข้าวหอมมะลิ)',
			ref: '12000.00 kg',
			calc: '176.00 kg',
			actual: 'เกินสูตร 7775.00 กก.',
			exceed: true
		},
		{
			name: 'ไข่',
			ref: '240.00 น้ำ.',
			calc: '0.00 น้ำ.',
			actual: 'เกินสูตร 240.00 น้ำ.',
			exceed: true
		},
		{
			name: 'น้ำดื่มและประกอบการ',
			ref: '24.00 น้ำ.',
			calc: '0.00 น้ำ.',
			actual: 'เกินสูตร 24.00 น้ำ.',
			exceed: true
		},
		{
			name: 'ถุงแก๊สขวด + ถัง 15kg',
			ref: '0.00 กก.',
			calc: '45.00 กก.',
			actual: '',
			exceed: false
		},
		{ name: 'ถาดน้ำ + ถัง 4kg', ref: '0.24 กก.', calc: '45.00 กก.', actual: '', exceed: false }
	];

	const bomRows = $derived(mode === 'custom' ? CUSTOM_ROWS : BOM_ROWS);
</script>

<svelte:head>
	<title>
		{isManage
			? `จัดการ ${displayRef ?? ''} · SmartShelter`
			: mode === 'custom'
				? 'กำหนดสูตรเอง (Custom) · SmartShelter'
				: 'เพิ่มสูตรมาตรฐาน (BOM) · SmartShelter'}
	</title>
</svelte:head>

<div class="flex-1 overflow-auto {isManage ? 'bg-amber-50/30' : 'bg-gray-50'}">
	<!-- Header -->
	{#if isManage}
		<!-- Manage header: amber accent -->
		<div class="border-b border-amber-200 bg-amber-50 px-6 py-4">
			<div class="mx-auto max-w-7xl">
				<div class="mb-2 flex items-center gap-2">
					<a
						href={resolve('/back-office/kitchen')}
						class="flex h-7 w-7 items-center justify-center rounded-full border border-amber-300 transition-colors hover:bg-amber-100"
						aria-label="กลับ"
					>
						<ArrowLeft class="h-3.5 w-3.5 text-amber-700" />
					</a>
					<span
						class="inline-flex items-center gap-1 rounded-full bg-amber-200 px-2.5 py-0.5 text-xs font-semibold text-amber-800"
					>
						<AlertTriangle class="h-3 w-3" />
						กำลังดำเนินการ (WIP)
					</span>
					{#if displayRef}
						<span
							class="inline-flex items-center rounded-full bg-gray-800 px-2.5 py-0.5 text-xs font-semibold text-white"
						>
							Reference: {displayRef}
						</span>
					{/if}
				</div>
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-3">
						<ChefHat class="h-5 w-5 text-amber-700" />
						<div>
							<h1 class="text-base font-bold text-gray-900">
								แผงจัดการและจัดสรรแบบลื่อนหลัง (Production Management Board)
							</h1>
							<p class="text-xs text-amber-700">
								ปรับแผนและจัดสรรอุปกรณ์ใหม่ — บันทึกการเปลี่ยนแปลงเมื่อยืนยัน BOM ใหม่แล้ว
							</p>
						</div>
					</div>
					<div class="flex items-center gap-2">
						<div
							class="rounded-full border border-green-200 bg-green-50 px-4 py-1.5 text-xs font-semibold text-green-700"
						>
							ผู้ประสบภัย: {manageHeadcount} คน
						</div>
						<div
							class="rounded-full border border-amber-300 bg-amber-100 px-4 py-1.5 text-xs font-semibold text-amber-800"
						>
							จัดสรร: {manageHeadcount} ชุด
						</div>
					</div>
				</div>
			</div>
		</div>
	{:else}
		<!-- BOM/Custom header: dark navy -->
		<div class="border-b border-slate-700 bg-slate-900 px-6 py-4">
			<div class="mx-auto flex max-w-7xl items-center justify-between">
				<div class="flex items-center gap-3">
					<a
						href={resolve('/back-office/kitchen')}
						class="flex h-8 w-8 items-center justify-center rounded-full border border-slate-600 transition-colors hover:bg-slate-800"
						aria-label="กลับ"
					>
						<ArrowLeft class="h-3.5 w-3.5 text-slate-300" />
					</a>
					<ChefHat class="h-5 w-5 text-blue-400" />
					<div>
						<h1 class="text-base font-bold text-white">
							แผงควบคุมและจัดสรรเครื่องครัวภัยพิบัติ (Production Setup Board)
						</h1>
						<p class="text-xs text-slate-400">
							{mode === 'custom'
								? 'กำหนดชื่อสูตรเอง ระบุส่วนผสม และจัดสรรอุปกรณ์ก่อนเริ่มประกอบ'
								: 'ตั้งค่าสูตรอาหาร BOM ยอดผลิต และจัดสรรทรัพยากรก่อนเริ่มประกอบโรงครัว'}
						</p>
					</div>
				</div>
				<div class="flex items-center gap-2">
					<div
						class="rounded-full border border-green-500/40 bg-green-500/10 px-4 py-1.5 text-xs font-semibold text-green-400"
					>
						ผู้ประสบภัย: {headcount} คน
					</div>
					<div
						class="rounded-full border border-blue-400/40 bg-blue-400/10 px-4 py-1.5 text-xs font-semibold text-blue-300"
					>
						จัดสรร: {headcount} งาน
					</div>
				</div>
			</div>
		</div>
	{/if}

	<!-- Main content -->
	<div class="mx-auto grid max-w-7xl grid-cols-1 gap-5 p-6 lg:grid-cols-2">
		<!-- LEFT PANEL -->
		<div class="rounded-2xl bg-white p-6 shadow-sm">
			{#if isManage}
				<!-- Manage: BOM Re-Calibration -->
				<div class="mb-1 flex items-center gap-2">
					<ClipboardList class="h-4 w-4 text-blue-500" />
					<p class="font-bold text-gray-900">สูตรควบคุมวัตถุดิบและแก๊สใหม่ (BOM Re-Calibration)</p>
				</div>
				<p class="mb-4 text-xs text-gray-400">
					ระบุจำนวนผลิตใหม่ตามสูตร BOM ขอบเขต ตรวจสอบสต็อกคงเหลือ ดูข้อมูลล่าสุด 2)
				</p>

				<div class="mb-5 flex flex-wrap items-end gap-3">
					<div class="min-w-[180px] flex-1 space-y-1">
						<Label class="text-xs text-gray-500">ตำรับเสบียง (เมนู)</Label>
						<select
							bind:value={selectedMeal}
							class="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:ring-2 focus:ring-primary/30 focus:outline-none"
						>
							{#each MEAL_OPTIONS as opt (opt.value)}
								<option value={opt.value}>{opt.label}</option>
							{/each}
						</select>
					</div>
					<div class="w-28 space-y-1">
						<Label class="text-xs text-gray-500">จำนวนผู้รับ (คน)</Label>
						<Input
							type="number"
							min="1"
							bind:value={manageHeadcount}
							class="rounded-lg border-gray-200"
						/>
					</div>
					<Button size="sm" class="rounded-lg bg-red-600 text-white hover:bg-red-700">ด่วน</Button>
				</div>

				<div class="overflow-x-auto rounded-xl border border-gray-100">
					<table class="w-full text-sm">
						<thead class="bg-gray-50 text-xs text-gray-500">
							<tr>
								<th class="px-4 py-2.5 text-left font-medium">ชื่อส่วนผสม</th>
								<th class="px-4 py-2.5 text-right font-medium">ปริมาณอ้างอิง/คน</th>
								<th class="px-4 py-2.5 text-right font-medium">ออกคำสั่งสมมาตร</th>
								<th class="px-4 py-2.5 text-right font-medium">ปริมาณ</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-gray-50">
							{#each MANAGE_ROWS as row}
								<tr class="hover:bg-gray-50/50">
									<td class="px-4 py-3 font-medium text-gray-800">{row.name}</td>
									<td class="px-4 py-3 text-right text-gray-600">{row.ref}</td>
									<td class="px-4 py-3 text-right text-gray-600">{row.calc}</td>
									<td class="px-4 py-3 text-right">
										{#if row.exceed}
											<span
												class="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700"
											>
												{row.actual}
											</span>
										{:else}
											<span class="text-xs text-gray-300">—</span>
										{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>

				<div class="mt-5 space-y-1">
					<Label class="text-xs text-gray-500">สรุปเสบียงสมบูรณ์ทั้งหมด</Label>
					<select
						bind:value={manageStatus}
						class="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:ring-2 focus:ring-primary/30 focus:outline-none"
					>
						{#each STATUS_OPTIONS as opt (opt.value)}
							<option value={opt.value}>{opt.label}</option>
						{/each}
					</select>
				</div>

				<div
					class="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3"
				>
					<AlertTriangle class="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
					<p class="text-xs text-amber-800">
						การเปลี่ยนสถานะจะบันทึกในประวัติ — ตรวจสอบยอดก่อนยืนยัน
					</p>
				</div>

				<p class="mt-3 text-xs text-gray-400">รายการเสบียงออกใบสั่งได้ทันที</p>
			{:else if mode === 'custom'}
				<!-- Custom mode -->
				<div class="mb-1 flex items-center gap-2">
					<ClipboardList class="h-4 w-4 text-blue-500" />
					<p class="font-bold text-gray-900">สูตรควบคุมการวัตถุดิบและแก๊ส (BOM Calibration)</p>
				</div>
				<p class="mb-4 text-xs text-gray-400">
					ตั้งชื่อสูตรเองและระบุส่วนผสม — บันทึกเป็นสูตร Custom สำหรับใช้งานซ้ำ
				</p>

				<div class="mb-5 flex flex-wrap items-end gap-3">
					<div class="min-w-[180px] flex-1 space-y-1">
						<Label class="text-xs text-gray-500">ชื่อสูตร (ตั้งเอง)</Label>
						<div class="relative">
							<Input
								placeholder="เช่น แกงพลัส (ค่าแบบ)"
								bind:value={customName}
								class="rounded-lg border-gray-200 pr-9"
							/>
							<button
								class="absolute top-1/2 right-2.5 -translate-y-1/2 text-gray-400 hover:text-gray-600"
							>
								<Scan class="h-4 w-4" />
							</button>
						</div>
					</div>
					<div class="w-24 space-y-1">
						<Label class="text-xs text-gray-500">จำนวน</Label>
						<Input
							type="number"
							min="1"
							bind:value={headcount}
							class="rounded-lg border-gray-200"
						/>
					</div>
				</div>

				<p class="mb-2 text-xs font-medium text-gray-500">รายการวัตถุดิบ/ส่วนผสม</p>
				<div class="overflow-x-auto rounded-xl border border-gray-100">
					<table class="w-full text-sm">
						<thead class="bg-gray-50 text-xs text-gray-500">
							<tr>
								<th class="px-4 py-2.5 text-left font-medium">ชื่อส่วนผสม</th>
								<th class="px-4 py-2.5 text-right font-medium">ปริมาณการใช้งาน/คน</th>
								<th class="px-4 py-2.5 text-right font-medium">ออกคำสั่งสมมาตร กก. สูตร</th>
								<th class="px-4 py-2.5 text-center font-medium">สถานะแก๊ก</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-gray-50">
							{#each CUSTOM_ROWS as row}
								<tr class="hover:bg-gray-50/50">
									<td class="px-4 py-3 font-medium text-gray-800">{row.name}</td>
									<td class="px-4 py-3 text-right">
										<div class="inline-flex items-center gap-1">
											<span
												class="w-12 rounded border border-gray-200 bg-white px-2 py-0.5 text-right text-xs"
											>
												{row.perPerson}
											</span>
											<span class="text-xs text-gray-400">{row.unit}</span>
										</div>
									</td>
									<td class="px-4 py-3 text-right text-gray-600">{row.total} {row.totalUnit}</td>
									<td class="px-4 py-3 text-center">
										{#if row.status === 'exceed'}
											<span
												class="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700"
											>
												เกินสูตร
											</span>
										{:else}
											<span class="text-xs text-gray-300">—</span>
										{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>

				<button class="mt-3 flex items-center gap-1.5 text-xs text-primary hover:underline">
					<Plus class="h-3.5 w-3.5" />
					เพิ่มวัตถุดิบ/ส่วน
				</button>

				<p class="mt-4 text-xs text-gray-400">สรุปคำสั่งออกใบสั่งได้ทันที</p>
			{:else}
				<!-- BOM standard mode -->
				<div class="mb-1 flex items-center gap-2">
					<ClipboardList class="h-4 w-4 text-blue-500" />
					<p class="font-bold text-gray-900">สรุปความต้องการวัตถุดิบและแก๊ส (BOM Calibration)</p>
				</div>
				<p class="mb-4 text-xs text-gray-400">
					โอกาสหน้าตัวจำนวนตามสูตรอาหาร BOM รายละเอียด ตรวจสอบสต็อกคงเหลือ ดูข้อมูลล่าสุด
					(โรงเรียนเทศบาล 2)
				</p>

				<div class="mb-5 flex flex-wrap items-end gap-3">
					<div class="min-w-[180px] flex-1 space-y-1">
						<Label class="text-xs text-gray-500">ตำรับเสบียง (เมนู)</Label>
						<select
							bind:value={selectedMeal}
							class="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:ring-2 focus:ring-primary/30 focus:outline-none"
						>
							{#each MEAL_OPTIONS as opt (opt.value)}
								<option value={opt.value}>{opt.label}</option>
							{/each}
						</select>
					</div>
					<div class="w-24 space-y-1">
						<Label class="text-xs text-gray-500">จำนวนผู้รับ (คน)</Label>
						<Input
							type="number"
							min="1"
							bind:value={headcount}
							class="rounded-lg border-gray-200"
						/>
					</div>
					<Button variant="outline" size="sm" class="rounded-lg border-dashed">
						<Plus class="mr-1 h-3.5 w-3.5" />
						เพิ่มเมนู
					</Button>
				</div>

				<div class="overflow-x-auto rounded-xl border border-gray-100">
					<table class="w-full text-sm">
						<thead class="bg-gray-50 text-xs text-gray-500">
							<tr>
								<th class="px-4 py-2.5 text-left font-medium">ชื่อส่วนผสม</th>
								<th class="px-4 py-2.5 text-right font-medium">ปริมาณการใช้งาน/คน</th>
								<th class="px-4 py-2.5 text-right font-medium">ออกคำสั่งสมมาตร กก. สูตร</th>
								<th class="px-4 py-2.5 text-center font-medium">สถานะแก๊ก</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-gray-50">
							{#each BOM_ROWS as row}
								<tr class="hover:bg-gray-50/50">
									<td class="px-4 py-3 font-medium text-gray-800">{row.name}</td>
									<td class="px-4 py-3 text-right">
										<div class="inline-flex items-center gap-1">
											<span
												class="w-14 rounded border border-gray-200 bg-white px-2 py-0.5 text-right text-xs"
											>
												{row.perPerson}
											</span>
											<span class="text-xs text-gray-400">{row.unit}</span>
										</div>
									</td>
									<td class="px-4 py-3 text-right text-gray-600">{row.total} {row.totalUnit}</td>
									<td class="px-4 py-3 text-center">
										{#if row.status === 'exceed'}
											<span
												class="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700"
											>
												เกินสูตร {row.total}
												{row.totalUnit}
											</span>
										{:else}
											<span class="text-xs text-gray-300">—</span>
										{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>

				<button class="mt-3 flex items-center gap-1.5 text-xs text-primary hover:underline">
					<Plus class="h-3.5 w-3.5" />
					เพิ่มวัตถุดิบ/สูตร
				</button>

				<p class="mt-4 text-xs text-gray-400">สรุปคำสั่งออกใบสั่งได้ทันที</p>
			{/if}

			<!-- Bottom action -->
			<div class="mt-4 flex justify-end">
				<Button
					disabled
					class="cursor-not-allowed rounded-full px-6 opacity-60"
					variant={isManage ? 'outline' : 'default'}
				>
					{isManage ? 'ส่งเอกสารไปยังระบบ' : 'สำรองใบสั่งให้เสร็จ'}
				</Button>
			</div>
		</div>

		<!-- RIGHT PANEL -->
		<div class="rounded-2xl bg-white p-6 shadow-sm">
			{#if isManage}
				<!-- Manage: Modify Equipment Allocation -->
				<div class="mb-1 flex items-center gap-2">
					<Flame class="h-4 w-4 text-orange-500" />
					<p class="font-bold text-gray-900">ปรับออกทำการรายชื่อ (Modify Equipment Allocation)</p>
				</div>
				<p class="mb-5 text-xs text-gray-400">ปรับจำนวนเตาและถังแก๊สตามแผนการผลิตจริง</p>

				<div class="space-y-4">
					<!-- Stove 1 -->
					<div class="space-y-3 rounded-xl border border-gray-100 bg-gray-50/50 p-4">
						<div class="flex items-start justify-between gap-3">
							<div class="flex items-center gap-2">
								<Flame class="h-4 w-4 shrink-0 text-orange-400" />
								<div>
									<p class="text-sm font-semibold text-gray-900">
										ถังแก๊สขวด ถัง 1 (High-Pressure Stove)
									</p>
									<span
										class="mt-1 inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700"
									>
										สถานะ: ถังแก๊สขาดความดัน &gt;80%
									</span>
								</div>
							</div>
							<div class="text-right">
								<Input
									type="number"
									bind:value={stove1Qty}
									class="w-20 rounded-lg border-gray-200 text-right text-sm font-bold"
								/>
							</div>
						</div>
						<select
							class="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-xs focus:ring-1 focus:ring-primary/30 focus:outline-none"
						>
							<option>ถุงแก๊สขวด + ถัง 15kg (15kg)</option>
						</select>
					</div>

					<!-- Stove 2 -->
					<div class="space-y-3 rounded-xl border border-gray-100 bg-gray-50/50 p-4">
						<div class="flex items-start justify-between gap-3">
							<div class="flex items-center gap-2">
								<Flame class="h-4 w-4 shrink-0 text-orange-400" />
								<div>
									<p class="text-sm font-semibold text-gray-900">
										ถังแก๊สขวด ถัง 2 (High-Pressure Stove)
									</p>
									<span
										class="mt-1 inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700"
									>
										สถานะ: ถังแก๊สขาดความดัน &gt;80%
									</span>
								</div>
							</div>
							<div class="text-right">
								<Input
									type="number"
									bind:value={stove2Qty}
									class="w-20 rounded-lg border-gray-200 text-right text-sm font-bold"
								/>
							</div>
						</div>
						<select
							class="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-xs focus:ring-1 focus:ring-primary/30 focus:outline-none"
						>
							<option>ถุงแก๊สขวด + ถัง 15kg (15kg)</option>
						</select>
					</div>
				</div>

				<!-- Progress -->
				<div
					class="mt-5 flex items-center justify-between rounded-xl border border-primary/10 bg-primary/5 px-5 py-4"
				>
					<div>
						<p class="text-xs text-gray-500">ยอดจัดสรรผลิตทั้งหมด</p>
						<p class="text-2xl font-bold text-primary">{manageHeadcount} / {manageHeadcount}</p>
					</div>
				</div>

				<!-- Time estimates -->
				<div class="mt-4 grid grid-cols-2 gap-3">
					<div class="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
						<p class="text-xs text-gray-400">สมมาตรตามลำดับ (Sequential)</p>
						<p class="mt-0.5 text-sm font-bold text-gray-800">~ 1 ชั่วโมง 11 นาที</p>
					</div>
					<div class="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
						<p class="text-xs text-gray-400">สมมาตรคู่ขนาน (Parallel)</p>
						<p class="mt-0.5 text-sm font-bold text-gray-800">~ 1 ชั่วโมง 11 นาที</p>
					</div>
				</div>

				<!-- Action buttons -->
				<div class="mt-5 flex gap-3">
					<Button
						variant="outline"
						class="flex-1 rounded-full border-red-300 text-red-700 hover:bg-red-50"
					>
						<Ban class="mr-1.5 h-3.5 w-3.5" />
						สมมาตรการรรมสำเร็จ
					</Button>
					<Button class="flex-1 rounded-full bg-primary px-5 text-white hover:bg-primary/90">
						<Play class="mr-1.5 h-3.5 w-3.5 fill-white" />
						บันทึกการสมมาตรให้สำเร็จ
					</Button>
				</div>
			{:else}
				<!-- BOM/Custom: Equipment Allocation -->
				<div class="mb-1 flex items-center gap-2">
					<Flame class="h-4 w-4 text-orange-500" />
					<p class="font-bold text-gray-900">จัดสรรทำกาแฟและหัวเชื้อ (Equipment Allocation)</p>
				</div>
				<p class="mb-5 text-xs text-gray-400">
					เลือกถังแก๊สที่จะใช้ตามกำลังการผลิตและปริมาณสำรองประปรา
				</p>

				<div class="space-y-4">
					<!-- Mock gas tank card 1 -->
					<div class="space-y-3 rounded-xl border border-gray-100 bg-gray-50/50 p-4">
						<div class="flex items-start justify-between gap-3">
							<div class="flex items-center gap-2">
								<Flame class="h-4 w-4 shrink-0 text-orange-400" />
								<div>
									<p class="text-sm font-semibold text-gray-900">ถังแก๊สขวด + ถัง 15kg</p>
									<span
										class="mt-1 inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700"
									>
										สถานะแดง: ถังแก๊สขาดความดัน &lt;80%
									</span>
								</div>
							</div>
							<div class="text-right">
								<p class="text-xl font-bold text-primary">1</p>
								<p class="text-xs text-gray-400">จำนวนน้ำ</p>
							</div>
						</div>
						<p class="text-xs text-gray-400">ปริมาณความแม่นยำน้อยเกินไปพอ</p>
						<select
							class="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-xs focus:ring-1 focus:ring-primary/30 focus:outline-none"
						>
							<option>ถุงแก๊สขวด + ถัง 15kg (15kg)</option>
						</select>
						<p class="text-xs text-gray-400">
							เริ่มต้นที่ 1 | ประมาณเส้น 0.0 กก. | ประมาณมิติ 0.07 kg
						</p>
					</div>

					<!-- Mock gas tank card 2 -->
					<div class="space-y-3 rounded-xl border border-gray-100 bg-gray-50/50 p-4">
						<div class="flex items-start justify-between gap-3">
							<div class="flex items-center gap-2">
								<Flame class="h-4 w-4 shrink-0 text-orange-400" />
								<div>
									<p class="text-sm font-semibold text-gray-900">ถังแก๊สขวด + ถัง 15kg</p>
									<span
										class="mt-1 inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700"
									>
										สถานะแดง: ถังแก๊สขาดความดัน &lt;80%
									</span>
								</div>
							</div>
							<div class="text-right">
								<p class="text-xl font-bold text-primary">1</p>
								<p class="text-xs text-gray-400">จำนวน</p>
							</div>
						</div>
						<p class="text-xs text-gray-400">ปริมาณความแม่นยำน้อยเกินไปพอ</p>
					</div>

					{#if !gasTypes.data?.length}
						<p class="text-sm text-gray-400">
							ยังไม่มีข้อมูลถังแก๊ส —
							<a href={resolve('/back-office/kitchen/gas')} class="text-primary underline"
								>เพิ่มที่นี่</a
							>
						</p>
					{/if}
				</div>

				<!-- Headcount progress -->
				<div
					class="mt-5 flex items-center justify-between rounded-xl border border-gray-100 bg-gray-50 px-5 py-3"
				>
					<div>
						<p class="text-xs text-gray-400">จำนวนคนเบิกสูตรสมบูรณ์</p>
						<p class="mt-0.5 text-xs text-gray-500">สมมาตรจัดจำย: {headcount} คน</p>
					</div>
					<p class="text-xl font-bold text-primary">{headcount} / {headcount}</p>
				</div>

				<!-- Time estimates -->
				<div class="mt-4 grid grid-cols-2 gap-3">
					<div class="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
						<p class="text-xs text-gray-400">สมมาตรตามลำดับ (Sequential)</p>
						<p class="mt-0.5 text-sm font-bold text-gray-800">~ 2 นาที</p>
					</div>
					<div class="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
						<p class="text-xs text-gray-400">สมมาตรคู่ขนาน (Parallel)</p>
						<p class="mt-0.5 text-sm font-bold text-gray-800">~ 1 นาที</p>
					</div>
				</div>

				<!-- Submit -->
				<Button class="mt-5 w-full rounded-full bg-slate-900 py-3 text-white hover:bg-slate-800">
					<Play class="mr-2 h-4 w-4 fill-white" />
					บันทึกและเริ่มปฏิบัติประกอบเลือกกับ
				</Button>
			{/if}
		</div>
	</div>
</div>
