<script lang="ts">
	import Heart from '@lucide/svelte/icons/heart';
	import Compass from '@lucide/svelte/icons/compass';
	import Search from '@lucide/svelte/icons/search';
	import { donationStore } from '../donation.svelte';
</script>

<div class="rounded-3xl border border-border bg-card p-6 md:p-8 shadow-xs">
	<div class="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border/60 pb-6 mb-6">
		<div>
			<h2 class="flex items-center gap-2 text-base font-bold text-foreground">
				<Heart class="h-5 w-5 text-primary" />
				กระดานความต้องการด่วน
			</h2>
			<p class="mt-1 text-[11px] text-muted-foreground">
				อัปเดตข้อมูลแบบเรียลไทม์จากทุกศูนย์พักพิง คุณสามารถช่วยเหลือเติมเต็มในส่วนที่ขาดแคลนได้ทันที
			</p>
		</div>
		<!-- Search -->
		<div class="relative w-full md:w-80">
			<input 
				type="text" 
				placeholder="ค้นหาสิ่งของที่ต้องการบริจาค เช่น น้ำดื่ม, ยาสามัญ..."
				class="w-full rounded-xl border border-border bg-muted/20 px-3 py-2 pl-9 text-xs outline-hidden focus:ring-1 focus:ring-primary focus:border-primary text-foreground"
			/>
			<Search class="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
		</div>
	</div>

	<!-- Categories -->
	<div class="flex flex-wrap gap-2 mb-6">
		<button class="rounded-full bg-foreground text-background px-4 py-1.5 text-xs font-bold">ทั้งหมด</button>
		<button class="rounded-full border border-border hover:bg-muted px-4 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground">ด่วนพิเศษ</button>
		<button class="rounded-full border border-border hover:bg-muted px-4 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground">อาหาร & น้ำ</button>
		<button class="rounded-full border border-border hover:bg-muted px-4 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground">ยารักษาโรค</button>
	</div>

	<!-- Shelter list -->
	<div class="flex flex-col gap-6">
		<!-- Shelter Card 1 -->
		<div class="rounded-2xl border border-border p-5 flex flex-col md:flex-row md:items-center justify-between gap-6 bg-muted/5">
			<div class="flex-1">
				<div class="flex items-center gap-2.5">
					<span class="rounded-lg bg-blue-50 text-blue-600 border border-blue-100 p-1">
						<Compass class="h-4 w-4" />
					</span>
					<div>
						<h3 class="text-sm font-bold text-foreground">ศูนย์พักพิง เทศบาลนครหาดใหญ่</h3>
						<p class="text-[10px] text-muted-foreground">(โรงเรียนเทศบาล 2)</p>
					</div>
					<span class="ml-2 rounded-full bg-primary-muted text-primary px-2.5 py-0.5 text-[10px] font-bold">เปิดรับบริจาค</span>
				</div>

				<!-- Needs list inside shelter -->
				<div class="mt-4 flex flex-col gap-2">
					<div class="flex items-center justify-between rounded-lg bg-danger-muted/20 border border-danger-border/30 px-3.5 py-2 text-xs">
						<span class="font-bold text-danger">• ด่วน! น้ำดื่ม</span>
						<span class="rounded-md bg-white px-2 py-0.5 text-[10px] font-bold text-danger border border-danger/10">ขาด 500 แพ็ค</span>
					</div>
					<div class="flex items-center justify-between rounded-lg bg-danger-muted/20 border border-danger-border/30 px-3.5 py-2 text-xs">
						<span class="font-bold text-danger">• ด่วน! ยาแก้ปวด</span>
						<span class="rounded-md bg-white px-2 py-0.5 text-[10px] font-bold text-danger border border-danger/10">ขาด 200 แผง</span>
					</div>
					<div class="flex items-center justify-between rounded-lg bg-muted/40 px-3.5 py-2 text-xs text-muted-foreground">
						<span>ขอรับบริจาคเสื้อผ้ามือสอง</span>
						<span class="text-[10px]">ค้นสต๊อก 12...</span>
					</div>
				</div>
			</div>

			<div class="flex flex-col items-center justify-center shrink-0 md:border-l md:border-border/60 md:pl-6 pt-4 md:pt-0">
				<button 
					onclick={() => { donationStore.activeTab = 'form'; if (donationStore.reachedStep < 2) donationStore.reachedStep = 2; }} 
					class="flex items-center justify-center gap-2 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-xs px-5 py-3 shadow-xs transition-colors cursor-pointer w-full md:w-auto"
				>
					จองคิวบริจาค
					<span>→</span>
				</button>
				<span class="mt-2 text-[10px] text-muted-foreground text-center">ช่วยลดความแออัดหน้าศูนย์</span>
			</div>
		</div>

		<!-- Shelter Card 2 -->
		<div class="rounded-2xl border border-border p-5 flex flex-col md:flex-row md:items-center justify-between gap-6 bg-muted/5">
			<div class="flex-1">
				<div class="flex items-center gap-2.5">
					<span class="rounded-lg bg-blue-50 text-blue-600 border border-blue-100 p-1">
						<Compass class="h-4 w-4" />
					</span>
					<div>
						<h3 class="text-sm font-bold text-foreground">ศูนย์พักพิง เทศบาลเมืองคลองแห</h3>
						<p class="text-[10px] text-muted-foreground">(โรงเรียนวัดคลองแห)</p>
					</div>
					<span class="ml-2 rounded-full bg-primary-muted text-primary px-2.5 py-0.5 text-[10px] font-bold">เปิดรับบริจาค</span>
				</div>
			</div>
			<div class="flex flex-col items-center justify-center shrink-0 md:border-l md:border-border/60 md:pl-6 pt-4 md:pt-0">
				<button 
					onclick={() => { donationStore.activeTab = 'form'; if (donationStore.reachedStep < 2) donationStore.reachedStep = 2; }} 
					class="flex items-center justify-center gap-2 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-xs px-5 py-3 shadow-xs transition-colors cursor-pointer w-full md:w-auto"
				>
					จองคิวบริจาค
					<span>→</span>
				</button>
			</div>
		</div>
	</div>
</div>
