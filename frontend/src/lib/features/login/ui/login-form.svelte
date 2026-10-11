<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { page } from '$app/state';
	import { env } from '$env/dynamic/public';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { loginSchema } from '../domain/schema';
	import { resolveLoginIdentifier } from '../data/resolve-login';
	import { toast } from 'svelte-sonner';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { authStore } from '$lib/stores/auth.svelte';
	import {
		LANDING_ROUTE,
		resolvePostLoginDestination,
		type PostLoginDestination
	} from '$lib/guards/auth';
	import { fetchAuthStatus, googleOAuthStartHref, thaidOAuthStartHref } from '$lib/features/users';
	import { fetchRecaptchaEnabled } from '$lib/api/recaptcha-status';
	import { fetchLoginMethods } from '$lib/api/login-methods';
	import { executeLoginCaptcha } from '../data/recaptcha';
	import GoogleSignInButton from './google-sign-in-button.svelte';
	import ThaIdSignInButton from './thaid-sign-in-button.svelte';
	import Eye from '@lucide/svelte/icons/eye';
	import EyeOff from '@lucide/svelte/icons/eye-off';

	let {
		navigateOnSuccess = true,
		onSuccess,
		showCard = true,
		passwordMode = 'auto',
		defaultUsername = '',
		lockUsername = false,
		submitLabel = 'เข้าสู่ระบบ (Login)'
	}: {
		navigateOnSuccess?: boolean;
		/** Fires after login AND post-login destination resolution, before any navigation. */
		onSuccess?: (result: { destination: PostLoginDestination }) => void;
		showCard?: boolean;
		/** Prefill the username (re-auth: the expired user). */
		defaultUsername?: string;
		/** Render the username read-only (re-auth must not silently switch accounts). */
		lockUsername?: boolean;
		submitLabel?: string;
		/**
		 * `auto` — username/password only when `config:app.password_login_enabled` (CR-141);
		 * `always` — `/admin-login` and re-auth.
		 */
		passwordMode?: 'auto' | 'always';
	} = $props();

	let showPassword = $state(false);

	const siteKey = env.PUBLIC_RECAPTCHA_SITE_KEY || '';
	/** Stay false until GET /api/public/v1/recaptcha confirms ON — avoids injecting enterprise.js early. */
	let captchaEnabled = $state(false);
	/** Stay false until GET /api/public/v1/login-methods confirms ON. */
	let passwordLoginEnabled = $state(false);
	let googleEnabled = $state(false);
	let thaidEnabled = $state(false);
	const showPasswordForm = $derived(passwordMode === 'always' || passwordLoginEnabled);

	const RECAPTCHA_ERROR = 'ระบบยืนยันตัวตน (reCAPTCHA) ขัดข้อง กรุณาลองใหม่อีกครั้ง';
	const CAPTCHA_FAILED = 'การยืนยันตัวตนไม่ผ่าน กรุณารีเฟรชหน้าแล้วลองใหม่';

	function captchaToken(): Promise<string | null> {
		return executeLoginCaptcha(siteKey, captchaEnabled);
	}

	onMount(() => {
		void fetchRecaptchaEnabled().then((enabled) => {
			captchaEnabled = enabled;
		});
		void fetchLoginMethods().then((m) => {
			passwordLoginEnabled = m.password;
			googleEnabled = m.google;
			thaidEnabled = m.thaid;
		});

		const err = page.url.searchParams.get('error');
		if (!err) return;

		// CR-141 FR-26 — never point at the hidden password route from here.
		if (err === 'google_not_linked' || err === 'thaid_not_linked') {
			toast.error('บัญชีนี้ยังไม่ได้เชื่อมกับระบบ กรุณาติดต่อผู้ดูแลระบบ');
		} else if (err === 'link_expired') {
			toast.error('หมดเวลาการเชื่อมบัญชี กรุณาเข้าสู่ระบบใหม่อีกครั้ง');
		} else if (err === 'thaid_login_failed') {
			toast.error('ไม่สามารถเข้าสู่ระบบด้วย ThaID ได้ กรุณาลองอีกครั้ง');
		} else if (err === 'thaid_disabled') {
			toast.error('ระบบ ThaiD Digital ID ถูกปิดใช้งานชั่วคราว');
		} else if (err === 'invalid_state' || err === 'google_login_failed') {
			toast.error('ไม่สามารถเข้าสู่ระบบได้ กรุณาลองอีกครั้ง');
		} else if (err.startsWith('oauth_')) {
			toast.error('ไม่สามารถเชื่อมต่อระบบยืนยันตัวตนภายนอกได้ กรุณาลองอีกครั้ง');
		}

		const next = new URL(page.url);
		next.searchParams.delete('error');
		void goto(`${next.pathname}${next.search}${next.hash}`, { replaceState: true, noScroll: true });
	});

	const form = superForm(
		defaults({ username: untrack(() => defaultUsername), password: '' }, zod4(loginSchema)),
		{
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
						const enabled = await fetchRecaptchaEnabled();
						captchaEnabled = enabled;
						if (enabled) {
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

						const name = await resolveLoginIdentifier(form.data.username);
						await authStore.login({
							name,
							password: form.data.password
						});
						let dest: PostLoginDestination = LANDING_ROUTE;
						try {
							const status = await fetchAuthStatus();
							dest = resolvePostLoginDestination(status);
						} catch {
							// Fallback if status fetch fails
						}
						reset();
						onSuccess?.({ destination: dest });
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
		}
	);
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
	<form method="POST" use:form.enhance class="flex flex-col gap-4">
		{#if showPasswordForm}
			<div class="flex flex-col gap-3.5">
				<Form.Field {form} name="username">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label class="text-sm font-semibold text-slate-700"
								>Username หรือเบอร์โทรศัพท์</Form.Label
							>
							<Input
								{...props}
								bind:value={$formData.username}
								placeholder="เช่น staff01 หรือ 0812345678"
								autocomplete="username"
								readonly={lockUsername}
								class={['h-11', lockUsername && 'bg-slate-50 text-slate-700']}
							/>
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
				</Form.Field>

				<Form.Field {form} name="password">
					<Form.Control>
						{#snippet children({ props })}
							<div class="flex items-center justify-between">
								<Form.Label class="text-sm font-semibold text-slate-700"
									>รหัสผ่าน (Password)</Form.Label
								>
								<a
									href={resolve('/forgot-password')}
									class="inline-flex min-h-11 items-center text-xs font-semibold text-blue-600 hover:text-blue-800 hover:underline"
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
									class="absolute top-0 right-0 h-full min-w-11 px-3 hover:bg-transparent"
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
			</div>

			<div class="flex flex-col gap-2 pt-0.5">
				<Form.Button
					disabled={$submitting}
					class="h-11 w-full rounded-xl bg-[#0A2647] font-semibold text-white transition-colors hover:bg-[#051930]"
				>
					{submitLabel}
				</Form.Button>

				{#if captchaEnabled}
					<p class="text-center text-xs text-muted-foreground">
						เว็บไซต์นี้มีการป้องกันด้วย reCAPTCHA
					</p>
				{/if}
			</div>

			<div class="relative my-0.5">
				<div class="absolute inset-0 flex items-center" aria-hidden="true">
					<div class="w-full border-t border-slate-200"></div>
				</div>
				<div class="relative flex justify-center text-xs">
					<span class="bg-white px-2 font-medium text-slate-500">หรือ</span>
				</div>
			</div>
		{/if}

		<div class="flex flex-col gap-2.5">
			{#if googleEnabled}
				<GoogleSignInButton href={googleOAuthStartHref('login')} class="h-11 text-sm font-medium" />
			{/if}
			{#if thaidEnabled}
				<ThaIdSignInButton href={thaidOAuthStartHref('login')} class="h-11 text-sm font-medium" />
			{/if}
		</div>
	</form>
{/snippet}

{#if showCard}
	<Card.Root
		class="mx-auto w-full max-w-md gap-4 rounded-2xl border border-slate-200/80 bg-white py-5 shadow-xs sm:py-6"
	>
		<Card.Header class="gap-1 pb-0 text-center">
			<Card.Title class="text-xl font-bold text-[#0A2647] sm:text-2xl"
				>เข้าสู่ระบบหลังบ้าน</Card.Title
			>
			<Card.Description class="text-xs text-slate-500 sm:text-sm"
				>ระบบบริหารจัดการศูนย์พักพิงและงานปฏิบัติการฉุกเฉิน</Card.Description
			>
		</Card.Header>
		<Card.Content class="space-y-4">
			<div
				role="note"
				class="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
			>
				<p class="font-semibold">สำหรับเจ้าหน้าที่และผู้ดูแลระบบเท่านั้น</p>
				<p class="mt-0.5 text-xs">
					ผู้ประสบภัยไม่ต้องเข้าสู่ระบบ —
					<a href={resolve('/pre-register')} class="font-semibold underline underline-offset-2"
						>ลงทะเบียนล่วงหน้า</a
					>
					หรือ
					<a href={resolve('/search')} class="font-semibold underline underline-offset-2"
						>ค้นหาผู้พักพิง</a
					>
					ได้เลย · จิตอาสา
					<a href={resolve('/volunteers/portal')} class="font-semibold underline underline-offset-2"
						>เข้าที่นี่</a
					>
				</p>
			</div>
			{@render fields()}
		</Card.Content>
	</Card.Root>
{:else}
	{@render fields()}
{/if}
