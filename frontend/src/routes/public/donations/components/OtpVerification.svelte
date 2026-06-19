<script lang="ts">
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import { donationStore } from '../donation.svelte';

	let otpCode = $state('');

	async function submitDonation() {
		if (otpCode.length !== 6) {
			donationStore.errorMessage = 'กรุณากรอกรหัส OTP 6 หลักให้ครบถ้วน';
			return;
		}

		donationStore.isSubmitting = true;
		donationStore.errorMessage = '';

		try {
			const res = await fetch('/api/public/v1/donations', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					shelter_code: 'SH001', 
					items: donationStore.items.length > 0 ? donationStore.items.map((it, i) => ({ item_id: `item-${i}`, qty: it.amount })) : [{ item_id: 'default', qty: 1 }],
					phone: donationStore.donorPhone || '0000000000',
					otpToken: otpCode
				})
			});
			const data = await res.json();
			if (!data.success) {
				donationStore.errorMessage = data.error || 'เกิดข้อผิดพลาดในการยืนยัน OTP';
			} else {
				donationStore.trackingToken = data.trackingToken;
				donationStore.activeTab = 'ticket';
				if (donationStore.reachedStep < 5) donationStore.reachedStep = 5;
			}
		} catch (err) {
			donationStore.errorMessage = 'เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์';
		} finally {
			donationStore.isSubmitting = false;
		}
	}
</script>

<div class="rounded-3xl border border-border bg-card p-6 md:p-8 shadow-xs text-center">
	<ShieldAlert class="mx-auto h-12 w-12 text-primary/80 mb-4" />
	<h2 class="text-base font-bold text-foreground">ยืนยันรหัส OTP</h2>
	<p class="mt-1 text-xs text-muted-foreground">ระบบได้จำลองส่งรหัส OTP ไปที่เบอร์ {donationStore.donorPhone}</p>
	<p class="mt-1 text-[10px] text-primary bg-primary-muted/20 inline-block px-2 py-1 rounded">
		(Mock OTP ดูได้ที่ Terminal ฝั่ง Backend)
	</p>

	<div class="mt-6 inline-flex flex-col gap-3 text-left w-full max-w-sm">
		<label for="otp-input" class="block text-xs font-bold text-foreground mt-2 text-center">
			กรอกรหัส 6 หลัก
		</label>
		<input 
			id="otp-input"
			type="text" 
			maxlength="6"
			bind:value={otpCode}
			class="mt-1 text-center text-xl tracking-[0.5em] font-mono rounded-xl border border-border bg-card px-3.5 py-4 text-foreground outline-hidden focus:ring-1 focus:ring-primary w-full"
			placeholder="------"
		/>

		{#if donationStore.errorMessage}
			<div class="mt-4 text-xs font-bold text-danger text-center bg-danger-muted/20 border border-danger/30 p-2 rounded-lg">
				{donationStore.errorMessage}
			</div>
		{/if}

		<button 
			onclick={submitDonation} 
			disabled={donationStore.isSubmitting || otpCode.length !== 6}
			class="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-primary hover:bg-primary-dark py-3.5 text-xs font-bold text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
		>
			{donationStore.isSubmitting ? 'กำลังตรวจสอบ...' : 'ยืนยันและรับตั๋ว'}
			{#if !donationStore.isSubmitting}<span>→</span>{/if}
		</button>
		
		<button 
			onclick={() => { donationStore.activeTab = 'time'; }} 
			disabled={donationStore.isSubmitting}
			class="mt-2 flex w-full items-center justify-center rounded-xl bg-transparent hover:bg-muted py-3.5 text-xs font-bold text-muted-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
		>
			กลับไปแก้ไขข้อมูล
		</button>
	</div>
</div>
