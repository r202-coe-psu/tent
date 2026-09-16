<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { env } from '$env/dynamic/public';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { loginSchema } from '../domain/schema';
	import { toast } from 'svelte-sonner';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { authStore } from '$lib/stores/auth.svelte';
	import { LANDING_ROUTE, resolvePostLoginDestination } from '$lib/guards/auth';
	import { fetchAuthStatus, googleOAuthStartHref } from '$lib/features/users';
	import { isCaptchaKeyConfigured } from '$lib/features/public-register';
	import GoogleSignInButton from './google-sign-in-button.svelte';
	import Eye from '@lucide/svelte/icons/eye';
	import EyeOff from '@lucide/svelte/icons/eye-off';

	let {
		navigateOnSuccess = true,
		onSuccess,
		showCard = true
	}: {
		navigateOnSuccess?: boolean;
		onSuccess?: () => void;
		showCard?: boolean;
	} = $props();

	let showPassword = $state(false);

	const siteKey = env.PUBLIC_RECAPTCHA_SITE_KEY || '';
	const captchaEnabled = isCaptchaKeyConfigured(siteKey);

	const RECAPTCHA_ERROR = 'ระบบยืนยันตัวตน (reCAPTCHA) ขัดข้อง กรุณาลองใหม่อีกครั้ง';
	const CAPTCHA_FAILED = 'การยืนยันตัวตนไม่ผ่าน กรุณารีเฟรชหน้าแล้วลองใหม่';

	async function captchaToken(): Promise<string | null> {
		const injected = window.__captchaToken || '';
		if (injected) return injected;
		if (!captchaEnabled) return '';
		const win = window;
		if (win.grecaptcha) {
			try {
				const action = 'login';
				if (win.grecaptcha.enterprise) {
					await new Promise<void>((resolve) => win.grecaptcha!.enterprise!.ready(() => resolve()));
					return await win.grecaptcha.enterprise.execute(siteKey, { action });
				}
				if (win.grecaptcha.execute) {
					return await win.grecaptcha.execute(siteKey, { action });
				}
			} catch {
				return null;
			}
		}
		return '';
	}

	onMount(() => {
		const err = page.url.searchParams.get('error');
		if (!err) return;

		if (err === 'google_not_linked') {
			toast.error(
				'บัญชี Google นี้ยังไม่ได้ผูกกับระบบ — กรุณาเข้าสู่ระบบด้วยรหัสผ่านแล้วผูก Google ใน Settings'
			);
		} else if (err === 'invalid_state' || err === 'google_login_failed') {
			toast.error('ไม่สามารถเข้าสู่ระบบด้วย Google ได้ กรุณาลองอีกครั้ง');
		} else if (err.startsWith('oauth_')) {
			toast.error('ไม่สามารถเชื่อมต่อ Google ได้ กรุณาลองอีกครั้ง');
		}

		const next = new URL(page.url);
		next.searchParams.delete('error');
		void goto(`${next.pathname}${next.search}${next.hash}`, { replaceState: true, noScroll: true });
	});

	const form = superForm(defaults(zod4(loginSchema)), {
		SPA: true,
		validators: zod4(loginSchema),
		resetForm: false,
		onUpdate: async ({ form }) => {
			if (!form.valid) {
				toast.error('กรุณากรอกข้อมูลให้ครบถ้วน');
				return;
			}

			toast.promise(
				(async () => {
					if (captchaEnabled) {
						const token = await captchaToken();
						if (!token) {
							toast.error(RECAPTCHA_ERROR);
							throw new Error(RECAPTCHA_ERROR);
						}

						const captchaRes = await fetch('/api/v1/auth/captcha/verify', {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({ captchaToken: token })
						});
						if (!captchaRes.ok) {
							throw new Error(CAPTCHA_FAILED);
						}
					}

					await authStore.login({
						name: form.data.username,
						password: form.data.password
					});
					reset();
					onSuccess?.();
					let dest: '/portal' | '/force-setup' | '/mfa-challenge' = LANDING_ROUTE;
					try {
						const status = await fetchAuthStatus();
						dest = resolvePostLoginDestination(status);
					} catch {
						// Fallback if status fetch fails
					}
					// Always honor force-setup / MFA gates; only skip portal when reauth.
					if (navigateOnSuccess || dest !== LANDING_ROUTE) {
						await goto(resolve(dest));
					}
				})(),
				{
					loading: 'กำลังเข้าสู่ระบบ...',
					success: 'เข้าสู่ระบบสำเร็จ!',
					error: (err) => (err instanceof Error ? err.message : 'เข้าสู่ระบบไม่สำเร็จ')
				}
			);
		}
	});
	const { form: formData, submitting, reset } = form;
</script>

<svelte:head>
	{#if captchaEnabled}
		<script
			src="https://www.google.com/recaptcha/enterprise.js?render={siteKey}"
			async
			defer
		></script>
	{/if}
</svelte:head>

{#snippet fields()}
	<form method="POST" use:form.enhance>
		<Field.FieldGroup class="space-y-4">
			<Form.Field {form} name="username">
				<Form.Control>
					{#snippet children({ props })}
						<Form.Label class="font-bold">ชื่อผู้ใช้ / เบอร์โทรศัพท์ (Username)</Form.Label>
						<Input
							{...props}
							bind:value={$formData.username}
							placeholder="เช่น 0812345678"
							autocomplete="username"
							class="h-11"
						/>
					{/snippet}
				</Form.Control>
				<Form.FieldErrors />
			</Form.Field>
			<Form.Field {form} name="password">
				<Form.Control>
					{#snippet children({ props })}
						<div class="flex items-center justify-between">
							<Form.Label class="font-bold">รหัสผ่าน (Password)</Form.Label>
							<a
								href="/forgot-password"
								class="text-xs font-semibold text-blue-600 hover:text-blue-800 hover:underline"
							>
								ลืมรหัสผ่าน?
							</a>
						</div>
						<div class="relative">
							<Input
								{...props}
								type={showPassword ? 'text' : 'password'}
								bind:value={$formData.password}
								placeholder="กรอกรหัสผ่านของคุณ"
								autocomplete="current-password"
								class="h-11 pr-10"
							/>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								class="absolute top-0 right-0 h-full px-3 hover:bg-transparent"
								aria-label={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
								onclick={() => (showPassword = !showPassword)}
							>
								{#if showPassword}
									<EyeOff class="size-4 text-muted-foreground" />
								{:else}
									<Eye class="size-4 text-muted-foreground" />
								{/if}
							</Button>
						</div>
					{/snippet}
				</Form.Control>
				<Form.FieldErrors />
			</Form.Field>
			<Form.Button
				disabled={$submitting}
				class="h-11 w-full bg-[#0f2d5c] font-bold text-white hover:bg-[#0a1e3f]"
			>
				เข้าสู่ระบบ (Login)
			</Form.Button>

			{#if captchaEnabled}
				<p class="text-center text-2xs text-muted-foreground">
					เว็บไซต์นี้มีการป้องกันด้วย reCAPTCHA
				</p>
			{/if}

			<div class="relative py-1">
				<div class="absolute inset-0 flex items-center" aria-hidden="true">
					<div class="w-full border-t border-slate-200"></div>
				</div>
				<div class="relative flex justify-center text-xs">
					<span class="bg-white px-2 text-slate-500">หรือ</span>
				</div>
			</div>

			<GoogleSignInButton href={googleOAuthStartHref('login')} />
		</Field.FieldGroup>
	</form>
{/snippet}

{#if showCard}
	<Card.Root class="mx-auto w-full max-w-md rounded-2xl border-slate-200 shadow-lg">
		<Card.Header class="space-y-1 text-center">
			<Card.Title class="text-2xl font-bold text-slate-900">เข้าสู่ระบบ Smart Shelter</Card.Title>
			<Card.Description>ระบบบริหารจัดการศูนย์พักพิงและงานปฏิบัติการฉุกเฉิน</Card.Description>
		</Card.Header>
		<Card.Content>
			{@render fields()}
		</Card.Content>
	</Card.Root>
{:else}
	{@render fields()}
{/if}
