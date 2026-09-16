<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { authStore } from '$lib/stores/auth.svelte';
	import {
		LANDING_ROUTE,
		LOGIN_ROUTE,
		FORCE_SETUP_ROUTE,
		resolvePostLoginDestination
	} from '$lib/guards/auth';
	import { fetchAuthStatus, googleOAuthStartHref } from '$lib/features/users';
	import { ShieldCheck } from '@lucide/svelte';

	let loading = $state(true);
	let providerEmail = $state<string | null>(null);

	onMount(async () => {
		await authStore.ensureInitialized();
		if (!authStore.isAuthenticated) {
			await goto(resolve(LOGIN_ROUTE));
			return;
		}

		const err = page.url.searchParams.get('error');
		if (err === 'mismatch') {
			toast.error('บัญชี Google ไม่ตรงกับที่ผูกไว้ กรุณาเลือกบัญชีที่ถูกต้อง');
		} else if (err === 'invalid_state') {
			toast.error('การยืนยันตัวตนหมดอายุหรือไม่ถูกต้อง กรุณาลองอีกครั้ง');
		} else if (err?.startsWith('oauth_')) {
			toast.error('ไม่สามารถเชื่อมต่อ Google ได้ กรุณาลองอีกครั้ง');
		} else if (err === 'not_enrolled') {
			toast.error('ยังไม่ได้ผูกบัญชี Google สำหรับ MFA');
		}

		try {
			const status = await fetchAuthStatus();
			const dest = resolvePostLoginDestination(status);
			if (dest === FORCE_SETUP_ROUTE) {
				await goto(resolve(FORCE_SETUP_ROUTE));
				return;
			}
			if (!status.pending_mfa) {
				await goto(resolve(LANDING_ROUTE));
				return;
			}
			providerEmail = status.mfa_provider_email ?? null;
		} catch {
			toast.error('ไม่สามารถตรวจสอบสถานะ MFA ได้ — ต้องเข้าถึงเซิร์ฟเวอร์กลางและ Google');
		} finally {
			loading = false;
		}
	});
</script>

<div class="flex min-h-screen items-center justify-center bg-slate-50 p-4">
	<Card.Root class="mx-auto w-full max-w-md rounded-2xl border-slate-200 shadow-lg">
		<Card.Header class="space-y-2 text-center">
			<div
				class="mx-auto flex size-12 items-center justify-center rounded-full bg-blue-50 text-blue-800"
			>
				<ShieldCheck class="size-6" />
			</div>
			<Card.Title class="text-2xl font-bold text-slate-900">ยืนยันตัวตนขั้นที่สอง</Card.Title>
			<Card.Description>
				บัญชีของคุณผูกกับ Google แล้ว กรุณายืนยันด้วยบัญชี Google ที่เชื่อมโยงก่อนเข้าใช้งาน
				{#if providerEmail}
					<span class="mt-2 block font-medium text-slate-700">{providerEmail}</span>
				{/if}
			</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-4">
			{#if loading}
				<p class="text-center text-sm text-muted-foreground">กำลังตรวจสอบสถานะ...</p>
			{:else}
				<Button
					href={googleOAuthStartHref('stepup')}
					class="h-11 w-full bg-[#0f2d5c] font-bold text-white hover:bg-[#0a1e3f]"
				>
					ยืนยันด้วย Google
				</Button>
				<p class="text-center text-xs text-muted-foreground">
					หาก Google หรือเซิร์ฟเวอร์กลางเข้าไม่ถึง จะไม่สามารถข้ามขั้นตอนนี้ได้
				</p>
			{/if}
		</Card.Content>
	</Card.Root>
</div>
