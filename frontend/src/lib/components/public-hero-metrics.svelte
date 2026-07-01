<script lang="ts">
	import Search from '@lucide/svelte/icons/search';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import Input from './ui/input/input.svelte';
	import Button from './ui/button/button.svelte';
	import Card from './ui/card/card.svelte';

	let {
		summary,
		flags,
		lastUpdated,
		isStale
	}: {
		summary: { shelters_open: number; shelters_total: number; occupancy_total: number };
		flags: { public_metrics_occupancy: boolean };
		lastUpdated: number;
		isStale: boolean;
	} = $props();
</script>

<div class="mb-12 px-16 py-12 overflow-hidden rounded-2xl bg-primary text-white shadow-lg relative">
	<div class="absolute inset-0 opacity-10" style="background-image: radial-gradient(#fff 1px, transparent 1px); background-size: 24px 24px;"></div>
	<div class="relative  flex flex-col md:flex-row gap-10">
		<!-- Text Content -->
		<div class="flex flex-col justify-center">
			<div class="mb-4 inline-flex items-center w-fit gap-2 rounded-lg bg-white/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/90 backdrop-blur-sm border border-white/20">
				<span class="relative flex h-2 w-2">
				  <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75"></span>
				  <span class="relative inline-flex rounded-full h-2 w-2 bg-success"></span>
				</span>
				LIVE DISASTER COORDINATION LINK
			</div>
			<h2 class="text-3xl font-bold tracking-tight text-white md:text-4xl lg:text-5xl leading-tight mb-4">
				ระบบข้อมูลผู้ประสบภัยและสืบค้นสถานะเข้าพักฉุกเฉิน
			</h2>
			<p class="mt-2 text-sm text-white/80 leading-relaxed max-w-lg mb-8">
				เชื่อมต่อ อำนวยความสะดวก และรายงานความช่วยเหลือสาธารณะเพื่อความโปร่งใสแบบตามเวลาจริง (Real-Time Transparency) สามารถสืบหาญาติ ติดตามผู้ประสบภัย หรือร่วมแจกจ่ายเสบียงผ่านเครือข่ายของเรา
			</p>

			<!-- Mock search field -->
			
		</div>

		<!-- Metrics Panel -->
		<div class="flex flex-col justify-center">
			<div class="rounded-2xl bg-card p-6 shadow-xl relative border border-border">
				<!-- Stale Warning -->
				{#if isStale}
					<div class="absolute -top-3 right-6 rounded-full bg-warning px-3 py-1 text-[10px] font-bold text-white shadow-sm flex items-center gap-1 border-2 border-white">
						<AlertCircle class="h-3 w-3" /> ข้อมูลอาจไม่เป็นปัจจุบัน
					</div>
				{/if}

				<div class=" flex items-center justify-between border-b border-slate-100 pb-4">
					<h3 class="font-bold text-card-foreground uppercase text-xs tracking-wider">สถานการณ์ปัจจุบัน ณ ขณะนี้ (Real-Time Metrics)</h3>
					<span class="text-[10px] text-muted-foreground">อัปเดตล่าสุด: {new Date(lastUpdated).toLocaleTimeString('th-TH')}</span>
				</div>

				<div class="grid grid-cols-2 gap-4">
					<!-- Metric 1 -->
					<div class="flex flex-col justify-center rounded-xl bg-muted/30 p-4 border border-border/50">
						<span class="text-xs font-semibold text-muted-foreground mb-2">ศูนย์อพยพหลัก</span>
						<div class="flex items-baseline gap-1">
							<span class="text-3xl font-bold text-card-foreground">{summary.shelters_open}</span>
							<span class="text-sm font-medium text-muted-foreground">/{summary.shelters_total} แห่ง</span>
						</div>
					</div>

					<!-- Metric 2 (Occupancy) -->
					{#if flags.public_metrics_occupancy}
						<div class="flex flex-col justify-center rounded-xl bg-muted/30 p-4 border border-border/50">
							<span class="text-xs font-semibold text-muted-foreground mb-2">ผู้ประสบภัยปลอดภัย</span>
							<div class="flex items-baseline gap-1">
								<span class="text-3xl font-bold text-card-foreground">{summary.occupancy_total}</span>
								<span class="text-sm font-medium text-muted-foreground">คน</span>
							</div>
						</div>
					{/if}
				</div>
			</div>
		</div>
	</div>
	<Card class="flex px-4 py-2 w-full! justify-between flex-col sm:flex-row sm:items-center gap-4">
			<div class="relative flex w-full flex-1 items-center gap-3">
				<Search class="size-6 shrink-0 text-bold text-primary ml-2" />
				<Input
					type="text"
					placeholder="ค้นหาญาติด้วย ชื่อ-นามสกุล หรือ รหัสประจำตัว..."
					class="w-full rounded-xl h-12 border-0 bg-background px-4 py-3 text-sm text-foreground placeholder-muted-foreground shadow-md outline-hidden focus:ring-2 focus:ring-chart-2"
				/>
			</div>
			<Button
				class="flex h-12 cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-bold text-primary-foreground shadow-md transition-colors hover:bg-primary/80"
			>
				ค้นหาญาติเดี๋ยวนี้
			</Button>
		</Card>
</div>
