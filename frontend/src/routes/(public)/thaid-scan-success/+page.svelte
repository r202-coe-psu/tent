<script lang="ts">
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button/index.js';

	const errorParam = $derived(page.url.searchParams.get('error'));
	const isError = $derived(Boolean(errorParam));

	const errorMessage = $derived.by(() => {
		if (errorParam === 'thaid_disabled') return 'ระบบยืนยันตัวตน ThaiD ถูกปิดใช้งานชั่วคราว';
		if (errorParam === 'session_expired') return 'QR Code นี้หมดอายุแล้ว กรุณาแจ้งผู้ลงทะเบียนหลักเพื่อสร้าง QR Code ใหม่';
		if (errorParam === 'missing_session') return 'ไม่พบรหัสการเชื่อมต่อ (Invalid Session)';
		return 'การยืนยันตัวตนไม่สำเร็จ กรุณาลองใหม่อีกครั้ง';
	});
</script>

<svelte:head>
	<title>{isError ? 'เกิดข้อผิดพลาดในการยืนยันตัวตน' : 'ยืนยันตัวตนสำเร็จ'} | SmartShelter</title>
</svelte:head>

<div class="flex min-h-[70vh] items-center justify-center px-4 py-12">
	<div class="w-full max-w-md rounded-2xl border border-border/80 bg-card p-6 text-center shadow-lg sm:p-8">
		{#if isError}
			<div class="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-destructive/10 text-destructive">
				<AlertTriangle class="size-8" />
			</div>
			<h2 class="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
				ยืนยันตัวตนไม่สำเร็จ
			</h2>
			<p class="mt-2 text-sm text-muted-foreground">
				{errorMessage}
			</p>
			<div class="mt-6">
				<a href={resolve('/')} class="inline-block w-full">
					<Button variant="outline" class="w-full">
						<ArrowLeft class="mr-2 size-4" />
						กลับสู่หน้าหลัก
					</Button>
				</a>
			</div>
		{:else}
			<div class="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-primary/10 text-primary animate-in zoom-in-50 duration-300">
				<CheckCircle2 class="size-9" />
			</div>
			<h2 class="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
				ยืนยันตัวตนสำเร็จ!
			</h2>
			<p class="mt-2 text-sm text-muted-foreground">
				ข้อมูลของคุณถูกส่งไปยังหน้าจอลงทะเบียนหลักแล้ว
			</p>
			<div class="mt-4 rounded-xl border border-primary/20 bg-primary/5 p-3.5 text-xs text-primary font-medium">
				✓ บันทึกข้อมูลส่วนตัวและที่อยู่เรียบร้อย<br />
				ท่านสามารถปิดหน้าต่างเบราว์เซอร์นี้ได้ทันที
			</div>
		{/if}
	</div>
</div>
