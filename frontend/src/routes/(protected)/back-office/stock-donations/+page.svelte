<script lang="ts">
	import Package from '@lucide/svelte/icons/package';
	import Scan from '@lucide/svelte/icons/scan';
	import ClipboardList from '@lucide/svelte/icons/clipboard-list';
	import Megaphone from '@lucide/svelte/icons/megaphone';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import Plus from '@lucide/svelte/icons/plus';
	import Search from '@lucide/svelte/icons/search';
	import { X } from '@lucide/svelte';

	let selectedShelter = $state('shelter-1');
	let activeSubTab = $state('needs'); // 'scan', 'pending', 'needs'

	let searchQuery = $state('');

	let isModalOpen = $state(false);
	let newItemName = $state('');
	let newItemTarget = $state(1000);
	let newItemLocation = $state('คลังช่วยเหลือภัยพิบัติ EOC');

	let items = $state([
		{
			id: '1',
			name: 'ข้าวสาร (ข้าวหอมมะลิ 100%)',
			location: 'คลังช่วยเหลือภัยพิบัติ EOC',
			reserved: 450,
			target: 1000,
			showOnHome: true,
			isCutOff: false
		},
		{
			id: '2',
			name: 'เนื้อไก่สด (เนื้อส่วนอก / สะโพก)',
			location: 'คลังช่วยเหลือภัยพิบัติ EOC',
			reserved: 150,
			target: 1000,
			showOnHome: true,
			isCutOff: false
		},
		{
			id: '3',
			name: 'น้ำดื่มบรรจุขวด 1.5L',
			location: 'คลังช่วยเหลือภัยพิบัติ EOC',
			reserved: 600,
			target: 1000,
			showOnHome: true,
			isCutOff: false
		},
		{
			id: '4',
			name: 'ข้าวสาร (ข้าวหอมมะลิ 100%)',
			location: 'คลังช่วยเหลือภัยพิบัติ EOC',
			reserved: 80,
			target: 1000,
			showOnHome: true,
			isCutOff: false
		},
		{
			id: '5',
			name: 'น้ำดื่มบรรจุขวด 1.5L',
			location: 'คลังช่วยเหลือภัยพิบัติ EOC',
			reserved: 120,
			target: 1000,
			showOnHome: true,
			isCutOff: false
		}
	]);

	let filteredItems = $derived(
		items.filter(
			(item) =>
				item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
				item.location.toLowerCase().includes(searchQuery.toLowerCase())
		)
	);

	function toggleShowOnHome(itemId: string) {
		const item = items.find((i) => i.id === itemId);
		if (item) {
			item.showOnHome = !item.showOnHome;
		}
	}

	function toggleCutOff(itemId: string) {
		const item = items.find((i) => i.id === itemId);
		if (item) {
			item.isCutOff = !item.isCutOff;
		}
	}

	function handleAddItem(e: SubmitEvent) {
		e.preventDefault();
		if (!newItemName.trim()) return;

		items.push({
			id: String(items.length + 1),
			name: newItemName,
			location: newItemLocation,
			reserved: 0,
			target: newItemTarget,
			showOnHome: true,
			isCutOff: false
		});

		newItemName = '';
		newItemTarget = 1000;
		isModalOpen = false;
	}
</script>

<header
	class="flex shrink-0 items-center justify-between border-b border-sidebar-border bg-card px-6 py-4"
>
	<div class="flex items-center gap-2">
		<Package class="h-5 w-5 text-muted-foreground" />
		<h1 class="text-base font-bold text-foreground">คลังทรัพยากร (Stock & Donations)</h1>
	</div>

	<div class="flex items-center gap-3">
		<div class="flex items-center gap-1.5 text-xs text-muted-foreground">
			<span>ศูนย์อพยพ:</span>
			<select
				bind:value={selectedShelter}
				class="rounded-lg border border-border bg-muted/50 px-3 py-1.5 text-xs font-medium text-foreground outline-hidden focus:border-primary focus:ring-1 focus:ring-primary"
			>
				<option value="shelter-1">ศูนย์พักพิง เทศบาลนครหาดใหญ่ (โรงเรียนเทศบาล 2)</option>
				<option value="shelter-2">ศูนย์พักพิง เทศบาลเมืองคลองแห (โรงเรียนวัดคลองแห)</option>
			</select>
		</div>

		<span
			class="inline-flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-[11px] font-medium text-amber-600"
		>
			<span class="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500"></span>
			Offline Mode
		</span>
	</div>
</header>

<div class="flex w-full flex-1 flex-col gap-6 p-6">
	<div
		class="flex items-start gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-amber-800 dark:text-amber-300"
	>
		<AlertTriangle class="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-500" />
		<div>
			<h4 class="text-xs font-bold">Offline Mode: เปิดใช้งานระบบบันทึกในเครื่อง</h4>
			<p class="mt-1 text-[11px] leading-relaxed opacity-90">
				ระบบอ่าน-เขียนข้อมูลไปยังคอมพิวเตอร์ของคุณโดยตรง
				จะทำการซิงก์ข้อมูลขึ้นคลาวด์อัตโนมัติเมื่อตรวจพบการเชื่อมต่อออนไลน์
			</p>
		</div>
	</div>

	<div class="flex items-center justify-start border-b border-border">
		<div class="-mb-px flex gap-2">
			<button
				onclick={() => (activeSubTab = 'scan')}
				class="flex items-center gap-2 border-b-2 px-4 py-3 text-xs font-bold transition-all {activeSubTab ===
				'scan'
					? 'border-primary text-primary'
					: 'border-transparent text-muted-foreground hover:text-foreground'}"
			>
				<Scan class="h-3.5 w-3.5" />
				สแกนรับของเข้าคลัง
			</button>

			<button
				onclick={() => (activeSubTab = 'pending')}
				class="flex items-center gap-2 border-b-2 px-4 py-3 text-xs font-bold transition-all {activeSubTab ===
				'pending'
					? 'border-primary text-primary'
					: 'border-transparent text-muted-foreground hover:text-foreground'}"
			>
				<ClipboardList class="h-3.5 w-3.5" />
				รายการรอตรวจสอบ
				<span
					class="rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] leading-none font-bold text-white"
					>2</span
				>
			</button>

			<button
				onclick={() => (activeSubTab = 'needs')}
				class="flex items-center gap-2 border-b-2 px-4 py-3 text-xs font-bold transition-all {activeSubTab ===
				'needs'
					? 'border-primary text-primary'
					: 'border-transparent text-muted-foreground hover:text-foreground'}"
			>
				<Megaphone class="h-3.5 w-3.5" />
				จัดการความต้องการ
			</button>
		</div>
	</div>

	{#if activeSubTab === 'scan'}
		<div
			class="rounded-2xl border border-border bg-card p-8 text-center text-xs text-muted-foreground"
		>
			[ส่วนแผงสแกนรับของเข้าคลัง - จะพัฒนาในอนาคต]
		</div>
	{:else if activeSubTab === 'pending'}
		<div
			class="rounded-2xl border border-border bg-card p-8 text-center text-xs text-muted-foreground"
		>
			[ส่วนตรวจสอบรายการรออนุมัติ - จะพัฒนาในอนาคต]
		</div>
	{:else if activeSubTab === 'needs'}
		<div class="relative mb-4 w-full md:w-80">
			<input
				type="text"
				placeholder="ค้นหารายการพัสดุ..."
				bind:value={searchQuery}
				class="w-full rounded-xl border border-border bg-card px-3 py-2 pl-9 text-xs text-foreground outline-hidden focus:border-primary focus:ring-1 focus:ring-primary"
			/>
			<Search class="absolute top-2.5 left-3 h-3.5 w-3.5 text-muted-foreground" />
		</div>

		<div class="overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
			<div
				class="flex flex-col justify-between gap-4 border-b border-border/60 bg-muted/5 p-6 md:flex-row md:items-center"
			>
				<div>
					<h2 class="flex items-center gap-2 text-base font-bold text-foreground">
						<Megaphone class="h-4 w-4 text-primary" />
						จัดการกระดานแจ้งความต้องการด่วน (Public Needs Board)
					</h2>
					<p class="mt-1 text-[11px] text-muted-foreground">
						สับสวิตช์เปิด-ปิด
						หรือจำกัดจำนวนรายการสิ่งของที่ศูนย์ต้องการแจ้งให้สาธารณชนรับทราบผ่านทางหน้าเว็บแรก
					</p>
				</div>
				<div>
					<div>
						<button
							onclick={() => (isModalOpen = true)}
							class="flex cursor-pointer items-center gap-2 rounded-xl bg-foreground px-4 py-2.5 text-xs font-bold text-background shadow-xs transition-colors hover:bg-foreground/90"
						>
							<Plus class="h-3.5 w-3.5" />
							สร้างประกาศแบบกำหนดเอง (Special Request)
						</button>
					</div>
				</div>
			</div>

			<!-- ตารางแสดงรายการ -->
			<div class="overflow-x-auto">
				<table class="w-full border-collapse text-left">
					<thead>
						<tr
							class="border-b border-border bg-muted/20 text-[11px] font-bold text-muted-foreground uppercase"
						>
							<th class="px-6 py-4">รายการพัสดุ / ประกาศพิเศษ</th>
							<th class="px-6 py-4 text-right">ยอดจองบริจาคแล้ว</th>
							<th class="px-6 py-4 text-right">ยอดเป้าหมาย</th>
							<th class="px-6 py-4">ความคืบหน้า (PROGRESS)</th>
							<th class="px-6 py-4 text-center">สถานะโปรโมตหน้าแรก</th>
							<th class="px-6 py-4 text-center">การจัดการ</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-border/60 text-xs">
						{#each items as item (item.id)}
							{@const progressPercent = Math.min(
								Math.round((item.reserved / item.target) * 100),
								100
							)}

							<tr
								class="transition-colors hover:bg-muted/5 {item.isCutOff
									? 'bg-muted/10 opacity-65'
									: ''}"
							>
								<td class="px-6 py-4">
									<div class="flex items-center gap-2 font-bold text-foreground">
										{#if item.isCutOff}
											<span
												class="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-extrabold text-red-600 dark:bg-red-950/50 dark:text-red-400"
												>CUT-OFF</span
											>
										{/if}
										{item.name}
									</div>
									<div class="mt-0.5 text-[10px] text-muted-foreground">{item.location}</div>
								</td>

								<td class="px-6 py-4 text-right font-semibold text-foreground">
									<span class="rounded-md border border-border/40 bg-muted px-2.5 py-1">
										{item.reserved.toLocaleString()}
									</span>
								</td>

								<td class="px-6 py-4 text-right font-semibold text-foreground">
									{item.target.toLocaleString()}
								</td>

								<td class="min-w-[180px] px-6 py-4">
									<div class="flex items-center gap-3">
										<div
											class="relative h-2 w-28 overflow-hidden rounded-full border border-border/40 bg-muted"
										>
											<div
												class="h-full rounded-full transition-all duration-300 {item.isCutOff
													? 'bg-red-500'
													: 'bg-primary'}"
												style="width: {progressPercent}%"
											></div>
										</div>
										<span class="text-[10px] font-bold text-muted-foreground"
											>{progressPercent}%</span
										>
									</div>
								</td>

								<td class="px-6 py-4 text-center">
									<button
										onclick={() => toggleShowOnHome(item.id)}
										disabled={item.isCutOff}
										class="inline-flex cursor-pointer items-center justify-center rounded-lg border px-3 py-1.5 text-[11px] font-bold transition-all
										{item.showOnHome && !item.isCutOff
											? 'border-blue-100 bg-blue-50 text-blue-600 hover:bg-blue-100 dark:border-blue-900/30 dark:bg-blue-950/20 dark:text-blue-400'
											: 'cursor-not-allowed border-transparent bg-muted text-muted-foreground opacity-50'}"
									>
										{item.showOnHome && !item.isCutOff ? 'กำลังโชว์บนหน้าเว็บ' : 'ซ่อนจากหน้าเว็บ'}
									</button>
								</td>

								<td class="px-6 py-4 text-center">
									<button
										onclick={() => toggleCutOff(item.id)}
										class="inline-flex cursor-pointer items-center justify-center rounded-lg border px-3 py-1.5 text-[11px] font-bold transition-colors
										{item.isCutOff
											? 'border-emerald-200 bg-emerald-50 text-emerald-600 hover:bg-emerald-100/70 dark:border-emerald-900/30 dark:bg-emerald-950/20 dark:text-emerald-400'
											: 'border-red-200 bg-red-50 text-red-600 hover:bg-red-100/70 dark:border-red-900/30 dark:bg-red-950/20 dark:text-red-400'}"
									>
										{item.isCutOff ? 'เปิดรับบริจาค (Restore)' : 'Force Cut-off (ปิดด่วน)'}
									</button>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>
	{/if}
</div>

<!-- ---------------------------------------------------- -->
<!-- โค้ดของกล่องข้อความป๊อปอัป (Modal Dialog) -->
{#if isModalOpen}
	<!-- แผ่นโปร่งใสเบื้องหลัง (Backdrop) -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs"
		onclick={() => (isModalOpen = false)}
	>
		<!-- ตัวฟอร์มป๊อปอัป (หยุดยั้งการสืบทอดแอ็กชันคลิกไม่ให้คลิกแล้วปิดป๊อปอัปด้วย stopPropagation) -->
		<div
			class="relative w-full max-w-md animate-in rounded-3xl border border-border bg-card p-6 text-foreground shadow-2xl duration-200 zoom-in-95 fade-in"
			onclick={(e) => e.stopPropagation()}
		>
			<!-- หัวข้อป๊อปอัป & ปุ่มปิด -->
			<div class="mb-5 flex items-center justify-between border-b border-border/60 pb-4">
				<h3 class="flex items-center gap-2 text-sm font-bold text-foreground">
					<Megaphone class="h-4 w-4 text-primary" />
					สร้างประกาศความต้องการใหม่
				</h3>
				<button
					onclick={() => (isModalOpen = false)}
					class="cursor-pointer rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
				>
					<X class="h-4 w-4" />
				</button>
			</div>

			<!-- ฟอร์มกรอกข้อมูล -->
			<form onsubmit={handleAddItem} class="space-y-4">
				<div>
					<label
						class="mb-1.5 block text-[11px] font-bold text-muted-foreground uppercase"
						for="item-name"
					>
						รายการพัสดุ / ประกาศพิเศษ
					</label>
					<input
						id="item-name"
						type="text"
						placeholder="เช่น ยาสามัญประจำบ้าน, แพมเพิสเด็กแรกเกิด"
						bind:value={newItemName}
						required
						class="w-full rounded-xl border border-border bg-muted/20 px-3.5 py-2.5 text-xs text-foreground outline-hidden focus:border-primary focus:ring-1 focus:ring-primary"
					/>
				</div>

				<div class="grid grid-cols-2 gap-4">
					<div>
						<label
							class="mb-1.5 block text-[11px] font-bold text-muted-foreground uppercase"
							for="item-target"
						>
							เป้าหมายจำนวนที่ต้องการ
						</label>
						<input
							id="item-target"
							type="number"
							min="1"
							bind:value={newItemTarget}
							required
							class="w-full rounded-xl border border-border bg-muted/20 px-3.5 py-2.5 text-xs text-foreground outline-hidden focus:border-primary focus:ring-1 focus:ring-primary"
						/>
					</div>
					<div>
						<label
							class="mb-1.5 block text-[11px] font-bold text-muted-foreground uppercase"
							for="item-location"
						>
							คลังเป้าหมาย
						</label>
						<select
							id="item-location"
							bind:value={newItemLocation}
							class="w-full rounded-xl border border-border bg-muted/20 px-3.5 py-2.5 text-xs text-foreground outline-hidden focus:border-primary focus:ring-1 focus:ring-primary"
						>
							<option value="คลังช่วยเหลือภัยพิบัติ EOC">คลัง EOC</option>
							<option value="คลังย่อยโรงเรียนเทศบาล 2">คลังโรงเรียนเทศบาล 2</option>
							<option value="คลังกลางเทศบาล">คลังกลางเทศบาล</option>
						</select>
					</div>
				</div>

				<div class="flex justify-end gap-2.5 border-t border-border/60 pt-4">
					<button
						type="button"
						onclick={() => (isModalOpen = false)}
						class="cursor-pointer rounded-xl border border-border px-4 py-2.5 text-xs font-bold text-foreground transition-colors hover:bg-muted"
					>
						ยกเลิก
					</button>
					<button
						type="submit"
						class="cursor-pointer rounded-xl bg-primary px-5 py-2.5 text-xs font-bold text-primary-foreground transition-colors hover:bg-primary/90"
					>
						เพิ่มความต้องการ
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}
