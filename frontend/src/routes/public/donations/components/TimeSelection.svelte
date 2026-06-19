<script lang="ts">
	import MapPin from '@lucide/svelte/icons/map-pin';
	import { env } from '$env/dynamic/public';
	import { donationStore } from '../donation.svelte';

	function renderRecaptcha(node: HTMLElement) {
		const initCaptcha = () => {
			if (window.grecaptcha && window.grecaptcha.render) {
				try {
					window.grecaptcha.render(node, {
						sitekey: env.PUBLIC_RECAPTCHA_SITE_KEY || '6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI',
						callback: 'onCaptchaSuccess'
					});
				} catch (e) {
					console.error('reCAPTCHA render error:', e);
				}
			} else {
				setTimeout(initCaptcha, 100);
			}
		};
		initCaptcha();
	}

	async function requestOtp() {
		// Read token from global variable
		// @ts-expect-error global variable from recaptcha callback
		donationStore.captchaToken = window.__captchaToken || '';

		if (!donationStore.captchaToken) {
			donationStore.errorMessage = 'กรุณายืนยันว่าคุณไม่ใช่โปรแกรมอัตโนมัติ';
			return;
		}

		donationStore.isSubmitting = true;
		donationStore.errorMessage = '';

		try {
			const res = await fetch('/api/public/v1/donations/otp', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					phone: donationStore.donorPhone,
					captchaToken: donationStore.captchaToken
				})
			});
			const data = await res.json();
			if (!data.success) {
				donationStore.errorMessage = data.error || 'ไม่สามารถส่ง OTP ได้';
			} else {
				// Proceed to OTP step
				donationStore.activeTab = 'otp';
				if (donationStore.reachedStep < 4) donationStore.reachedStep = 4;
			}
		} catch (err) {
			donationStore.errorMessage = 'เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์';
		} finally {
			donationStore.isSubmitting = false;
		}
	}
</script>

<div class="rounded-3xl border border-border bg-card p-6 md:p-8 shadow-xs text-center">
	<MapPin class="mx-auto h-12 w-12 text-primary/80 mb-4" />
	<h2 class="text-base font-bold text-foreground">เลือกวันเวลา และสถานที่จัดส่ง</h2>
	<p class="mt-1 text-xs text-muted-foreground">กําหนดเวลานําส่งสิ่งของบริจาคเพื่อลดความหนาแน่นในจุดบริการ</p>

	<div class="mt-6 inline-flex flex-col gap-3 text-left w-full max-w-sm">
		<label for="destination-select" class="block text-xs font-bold text-foreground">
			จุดส่งมอบปลายทาง
		</label>
		<select id="destination-select" class="rounded-xl border border-border bg-card px-3.5 py-3 text-xs text-foreground outline-hidden focus:ring-1 focus:ring-primary w-full">
			<option>ศูนย์พักพิง เทศบาลนครหาดใหญ่ (โรงเรียนเทศบาล 2)</option>
			<option>ศูนย์พักพิง เทศบาลเมืองคลองแห (โรงเรียนวัดคลองแห)</option>
		</select>

		<label for="datetime-input" class="block text-xs font-bold text-foreground mt-2">
			วันที่และเวลาที่จะส่งของ
		</label>
		<input 
			id="datetime-input"
			type="datetime-local" 
			class="mt-1 rounded-xl border border-border bg-card px-3.5 py-3 text-xs text-foreground outline-hidden focus:ring-1 focus:ring-primary w-full"
		/>

		<div class="mt-4 flex justify-center">
			<div use:renderRecaptcha></div>
		</div>

		{#if donationStore.errorMessage}
			<div class="mt-4 text-xs font-bold text-danger text-center bg-danger-muted/20 border border-danger/30 p-2 rounded-lg">
				{donationStore.errorMessage}
			</div>
		{/if}

		<button 
			onclick={requestOtp} 
			disabled={donationStore.isSubmitting}
			class="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-primary hover:bg-primary-dark py-3.5 text-xs font-bold text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
		>
			{donationStore.isSubmitting ? 'กำลังดำเนินการ...' : 'ขอรหัส OTP เพื่อยืนยัน'}
			{#if !donationStore.isSubmitting}<span>→</span>{/if}
		</button>
	</div>
</div>
