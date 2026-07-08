<!--
  ╔══════════════════════════════════════════════════════════════════════════╗
  ║  ⚠️  UI STUB ONLY — ข้อมูล MOCK ทั้งหมด ยังไม่ใช่ของจริง             ║
  ║                                                                          ║
  ║  Component นี้สร้างขึ้นเพื่อ Layout placeholder เท่านั้น               ║
  ║  ข้อมูลทั้ง 8 รายการด้านในเป็น hardcoded mock — ยังไม่มี schema        ║
  ║  หรือ API จริงรองรับ                                                    ║
  ║                                                                          ║
  ║  เจ้าของงานจริง:                                                         ║
  ║    → Team C (ก้อง, มิว, พัฟ) — Supply & Inventory                      ║
  ║    → Task T-14: Stock dashboard + reorder threshold (FR-31)             ║
  ║                                                                          ║
  ║  เมื่อ Team C พัฒนา Alert Threshold feature เสร็จแล้ว:                  ║
  ║    1. ลบ mockAlerts array ออก                                            ║
  ║    2. Import hook และ types จาก feature ของ Team C มาใช้แทน             ║
  ║    3. ลบ stub file นี้ออก และเชื่อมต่อ component จริงแทน               ║
  ║                                                                          ║
  ║  ห้าม: เรียก barrel / function ของ Team C มาใช้เองโดยไม่ประสาน         ║
  ╚══════════════════════════════════════════════════════════════════════════╝
-->
<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';

	let search = $state('');

	const mockAlerts = [
		{ key: 'overstock', label: 'จำนวนวันสต็อกเกินพิกัด (Overstock Alert)', value: 14, unit: 'วัน' },
		{ key: 'expiry', label: 'วันใกล้หมดอายุ (Expiry Warning)', value: 30, unit: 'วัน' },
		{ key: 'min_stock', label: 'ขีดต่ำคลังสินค้า (Minimum stock threshold)', value: 20, unit: '%' },
		{ key: 'max_stock', label: 'ขีดสูงคลังสินค้า (Maximum capacity limit)', value: 90, unit: '%' },
		{
			key: 'food_critical',
			label: 'ระดับวิกฤตความมั่นคงอาหาร (Food critical reserve)',
			value: 3,
			unit: 'วัน'
		},
		{
			key: 'water_critical',
			label: 'ระดับวิกฤตน้ำดื่มน้ำใช้ (Water critical reserve)',
			value: 2,
			unit: 'วัน'
		},
		{
			key: 'occupancy_alert',
			label: 'จำนวนผู้พักอาศัยหนาแน่นเกินพิกัด (Occupancy alert)',
			value: 80,
			unit: '%'
		},
		{
			key: 'volunteer_ratio',
			label: 'อัตราส่วนอาสาสมัครขั้นต่ำต่อผู้พักภัย (Min volunteer ratio)',
			value: 10,
			unit: 'คน/100 คน'
		}
	];

	const filtered = $derived(
		search.trim()
			? mockAlerts.filter((item) => item.label.toLowerCase().includes(search.trim().toLowerCase()))
			: mockAlerts
	);
</script>

<section
	class="rounded-xl border bg-card p-4 text-card-foreground shadow-sm sm:p-6"
	aria-label="เกณฑ์การแจ้งเตือน"
>
	<header class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
		<h1 class="text-xl font-semibold">รายการเกณฑ์การแจ้งเตือน ({mockAlerts.length})</h1>
		<div class="flex items-center gap-2">
			<div class="relative w-full sm:w-64">
				<Input
					bind:value={search}
					type="search"
					placeholder="ค้นหา..."
					class="pl-9"
					aria-label="ค้นหา"
				/>
				<svg
					class="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					<circle cx="11" cy="11" r="8" />
					<path d="m21 21-4.3-4.3" />
				</svg>
			</div>
		</div>
	</header>

	<div class="overflow-hidden rounded-lg border">
		<table class="w-full text-sm">
			<thead class="bg-muted/50 text-muted-foreground">
				<tr>
					<th class="px-4 py-3 text-left font-semibold">รายการ (Item)</th>
					<th class="px-4 py-3 text-center font-semibold">ค่ากำหนด (Value)</th>
					<th class="px-4 py-3 text-right font-semibold">จัดการ (Action)</th>
				</tr>
			</thead>
			<tbody>
				{#each filtered as item (item.key)}
					<tr class="border-t hover:bg-muted/30">
						<td class="px-4 py-3 font-medium">
							{item.label}
						</td>
						<td class="px-4 py-3 text-center">
							<span
								class="inline-block rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary"
							>
								{item.value}
								{item.unit}
							</span>
						</td>
						<td class="px-4 py-3">
							<div class="flex items-center justify-end gap-2">
								<Button
									type="button"
									variant="outline"
									size="sm"
									class="border-blue-200 text-blue-700 hover:bg-blue-50"
									onclick={() =>
										alert('ฟังก์ชันเกณฑ์การแจ้งเตือน (Alert Threshold) กำลังอยู่ระหว่างการพัฒนา')}
									aria-label="จัดการ {item.label}"
								>
									<svg
										class="mr-1 h-3.5 w-3.5"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"
										aria-hidden="true"
									>
										<path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
									</svg>
									จัดการ
								</Button>
							</div>
						</td>
					</tr>
				{:else}
					<tr>
						<td colspan="3" class="px-4 py-8 text-center text-muted-foreground">
							ไม่พบเกณฑ์การแจ้งเตือนที่ตรงกัน
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</section>
