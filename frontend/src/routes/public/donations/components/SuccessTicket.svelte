<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import { donationStore } from '../donation.svelte';
</script>

<div class="rounded-3xl border border-border bg-card p-6 md:p-8 shadow-xs text-center max-w-md mx-auto">
	<div class="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-success-muted text-success border border-success/25 mb-4">
		<Check class="h-8 w-8" />
	</div>
	
	<h2 class="text-lg font-bold text-foreground">จองสิทธิ์บริจาคสําเร็จ!</h2>
	<p class="mt-1 text-xs text-muted-foreground">กรุณาแคปหน้าจอเพื่อเก็บตั๋วและรหัสการจองไว้ใช้ยืนยัน ณ จุดส่งมอบ</p>

	<div class="my-6 rounded-2xl border-2 border-dashed border-border bg-muted/20 p-5">
		<!-- Mock QR & Token info -->
		<div class="mx-auto bg-white p-3 border border-border/80 w-32 h-32 flex items-center justify-center rounded-xl mb-4">
			<span class="text-xs text-slate-400">QR Code</span>
		</div>

		<div class="text-xs font-bold text-foreground">Tracking Token</div>
		<div class="mt-1 text-sm font-black text-primary font-mono tracking-wider select-all">{donationStore.trackingToken}</div>

		<div class="mt-4 border-t border-border/60 pt-4 text-left space-y-2 text-[11px] text-muted-foreground">
			<div class="flex justify-between">
				<span>ผู้บริจาค:</span>
				<span class="font-bold text-foreground">{donationStore.donorName || 'ไม่ระบุชื่อ'}</span>
			</div>
			<div class="flex justify-between">
				<span>จุดส่งมอบ:</span>
				<span class="font-bold text-foreground">โรงเรียนเทศบาล 2</span>
			</div>
			<div class="flex justify-between">
				<span>เวลาส่งมอบ:</span>
				<span class="font-bold text-foreground">18 มิ.ย. 2026 - 15:00 น.</span>
			</div>
		</div>
	</div>

	<button 
		onclick={() => { donationStore.reset(); }}
		class="w-full rounded-xl border border-border hover:bg-muted py-3 text-xs font-bold text-foreground transition-colors"
	>
		กลับหน้าแรกกระดานความต้องการ
	</button>
</div>
