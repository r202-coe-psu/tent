<script lang="ts">
	import ConsoleBanner from '$lib/components/console-banner.svelte';
	import { RecaptchaSettings } from '$lib/features/shared';
</script>

<svelte:head>
	<title>ความปลอดภัย — SmartShelter</title>
</svelte:head>

<div class="mx-auto w-full max-w-3xl space-y-4 p-4 sm:p-6">
	<ConsoleBanner title="ความปลอดภัย" description="ตั้งค่าการป้องกันสแปมและเกตสาธารณะของระบบ" />

	<section class="space-y-3 rounded-xl border bg-card p-4 text-card-foreground shadow-sm sm:p-6">
		<h2 class="text-base font-semibold">reCAPTCHA</h2>
		<RecaptchaSettings />
	</section>
</div>
