<script lang="ts">
	import Heart from '@lucide/svelte/icons/heart';
	import Compass from '@lucide/svelte/icons/compass';
	import Search from '@lucide/svelte/icons/search';
	import { getDonationStore } from '../../routes/public/donations/donation.svelte';
	import { Button } from '$lib/components/ui/button';
	const donationStore = getDonationStore();
</script>

<div class="rounded-3xl border border-border bg-card p-6 shadow-xs md:p-8">
	<div
		class="mb-6 flex flex-col justify-between gap-4 border-b border-border/60 pb-6 md:flex-row md:items-center"
	>
		<div>
			<h2 class="flex items-center gap-2 text-base font-bold text-foreground">
				<Heart class="h-5 w-5 text-primary" />
				กระดานความต้องการด่วน
			</h2>
			<p class="mt-1 text-xs text-muted-foreground">
				อัปเดตข้อมูลแบบเรียลไทม์จากทุกศูนย์พักพิง คุณสามารถช่วยเหลือเติมเต็มในส่วนที่ขาดแคลนได้ทันที
			</p>
		</div>
		<!-- Search -->
		<div class="relative w-full md:w-80">
			<input
				type="text"
				placeholder="ค้นหาสิ่งของที่ต้องการบริจาค เช่น น้ำดื่ม, ยาสามัญ..."
				class="w-full rounded-xl border border-border bg-muted/20 px-3 py-2 pl-9 text-xs text-foreground outline-hidden focus:border-primary focus:ring-1 focus:ring-primary"
			/>
			<Search class="absolute top-2.5 left-3 h-3.5 w-3.5 text-muted-foreground" />
		</div>
	</div>

	<!-- Categories -->
	<div class="mb-6 flex flex-wrap gap-2">
		<Button class="rounded-full px-4 text-xs font-bold"
			>ทั้งหมด</Button
		>
		<Button
			variant="outline"
			class="rounded-full border border-border px-4 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
			>ด่วนพิเศษ</Button
		>
		<Button
			variant="outline"
			class="rounded-full border border-border px-4 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
			>อาหาร & น้ำ</Button
		>
		<Button
			variant="outline"
			class="rounded-full border border-border px-4 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
			>ยารักษาโรค</Button
		>
	</div>

	<!-- Shelter list -->
	<div class="flex flex-col gap-6">
		<!-- Shelter Card 1 -->
		<div
			class="flex flex-col justify-between gap-6 rounded-2xl border border-border bg-muted/5 p-5 md:flex-row md:items-center"
		>
			<div class="flex-1">
				<div class="flex items-center gap-2.5">
					<span class="rounded-lg border border-shelter-border bg-shelter-blue-bg p-1 text-shelter-blue-text">
						<Compass class="h-4 w-4" />
					</span>
					<div>
						<h3 class="text-sm font-bold text-foreground">ศูนย์พักพิง เทศบาลนครหาดใหญ่</h3>
						<p class="text-xs text-muted-foreground">(โรงเรียนเทศบาล 2)</p>
					</div>
					<span
						class="ml-2 rounded-full bg-primary-muted px-2.5 py-0.5 text-xs font-bold text-primary"
						>เปิดรับบริจาค</span
					>
				</div>

				<!-- Needs list inside shelter -->
				<div class="mt-4 flex flex-col gap-2">
					<div
						class="flex items-center justify-between rounded-lg border border-danger-border/30 bg-danger-muted/20 px-3.5 py-2 text-xs"
					>
						<span class="font-bold text-danger">• ด่วน! น้ำดื่ม</span>
						<span
							class="rounded-md border border-danger/10 bg-card px-2 py-0.5 text-xs font-bold text-danger"
							>ขาด 500 แพ็ค</span
						>
					</div>
					<div
						class="flex items-center justify-between rounded-lg border border-danger-border/30 bg-danger-muted/20 px-3.5 py-2 text-xs"
					>
						<span class="font-bold text-danger">• ด่วน! ยาแก้ปวด</span>
						<span
							class="rounded-md border border-danger/10 bg-card px-2 py-0.5 text-xs font-bold text-danger"
							>ขาด 200 แผง</span
						>
					</div>
					<div
						class="flex items-center justify-between rounded-lg bg-muted/40 px-3.5 py-2 text-xs text-muted-foreground"
					>
						<span>ขอรับบริจาคเสื้อผ้ามือสอง</span>
						<span class="text-xs">ค้นสต๊อก 12...</span>
					</div>
				</div>
			</div>

			<div
				class="flex shrink-0 flex-col items-center justify-center pt-4 md:border-l md:border-border/60 md:pt-0 md:pl-6"
			>
				<Button
					onclick={() => {
						donationStore.activeTab = 'form';
						if (donationStore.reachedStep < 2) donationStore.reachedStep = 2;
					}}
					class="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary px-5 py-6 text-xs font-bold text-primary-foreground shadow-xs transition-colors hover:bg-primary-dark md:w-auto"
				>
					จองคิวบริจาค
					<span>→</span>
				</Button>
				<span class="mt-2 text-center text-xs text-muted-foreground">ช่วยลดความแออัดหน้าศูนย์</span>
			</div>
		</div>

		<!-- Shelter Card 2 -->
		<div
			class="flex flex-col justify-between gap-6 rounded-2xl border border-border bg-muted/5 p-5 md:flex-row md:items-center"
		>
			<div class="flex-1">
				<div class="flex items-center gap-2.5">
					<span class="rounded-lg border border-shelter-border bg-shelter-blue-bg p-1 text-shelter-blue-text">
						<Compass class="h-4 w-4" />
					</span>
					<div>
						<h3 class="text-sm font-bold text-foreground">ศูนย์พักพิง เทศบาลเมืองคลองแห</h3>
						<p class="text-xs text-muted-foreground">(โรงเรียนวัดคลองแห)</p>
					</div>
					<span
						class="ml-2 rounded-full bg-primary-muted px-2.5 py-0.5 text-xs font-bold text-primary"
						>เปิดรับบริจาค</span
					>
				</div>
			</div>
			<div
				class="flex shrink-0 flex-col items-center justify-center pt-4 md:border-l md:border-border/60 md:pt-0 md:pl-6"
			>
				<Button
					onclick={() => {
						donationStore.activeTab = 'form';
						if (donationStore.reachedStep < 2) donationStore.reachedStep = 2;
					}}
					class="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary px-5 py-6 text-xs font-bold text-primary-foreground shadow-xs transition-colors hover:bg-primary-dark md:w-auto"
				>
					จองคิวบริจาค
					<span>→</span>
				</Button>
			</div>
		</div>
	</div>
</div>
