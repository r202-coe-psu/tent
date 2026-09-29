<script lang="ts">
	import { onMount } from 'svelte';
	import { env } from '$env/dynamic/public';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { toast } from 'svelte-sonner';
	import { fetchRecaptchaEnabled } from '$lib/api/recaptcha-status';
	import { LANDING_ROUTE } from '$lib/guards/auth';
	import { loginSchema } from '../domain/schema';
	import {
		cancelPendingLink,
		LINK_TERMINAL_CODES,
		LinkAccountError,
		linkAccount,
		type PendingLinkInfo
	} from '../data/link-account';
	import { executeLoginCaptcha } from '../data/recaptcha';
	import Eye from '@lucide/svelte/icons/eye';
	import EyeOff from '@lucide/svelte/icons/eye-off';

	let { pending }: { pending: PendingLinkInfo } = $props();

	const providerLabel = $derived(pending.provider === 'google' ? 'Google' : 'ThaiD');

	let showPassword = $state(false);
	const siteKey = env.PUBLIC_RECAPTCHA_SITE_KEY || '';
	let captchaEnabled = $state(false);

	const RECAPTCHA_ERROR = 'ระบบยืนยันตัวตน (reCAPTCHA) ขัดข้อง กรุณาลองใหม่อีกครั้ง';

	onMount(() => {
		void fetchRecaptchaEnabled().then((enabled) => {
			captchaEnabled = enabled;
		});
	});

	async function cancel() {
		await cancelPendingLink();
		await goto(resolve('/login'));
	}

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
					let captcha_token = '';
					if (captchaEnabled) {
						const token = await executeLoginCaptcha(siteKey, true);
						if (!token) throw new Error(RECAPTCHA_ERROR);
						captcha_token = token;
					}
					try {
						await linkAccount({
							login: form.data.username,
							password: form.data.password,
							captcha_token
						});
					} catch (err) {
						if (err instanceof LinkAccountError && LINK_TERMINAL_CODES.has(err.code)) {
							await goto(resolve('/login'));
						}
						throw err;
					}
					// Full reload: the server just minted AuthSession; guards route to force-setup.
					window.location.assign(resolve(LANDING_ROUTE));
				})(),
				{
					loading: 'กำลังเชื่อมบัญชี...',
					success: 'เชื่อมบัญชีสำเร็จ!',
					error: (err) => (err instanceof Error ? err.message : 'เชื่อมบัญชีไม่สำเร็จ')
				}
			);
		}
	});
	const { form: formData, submitting } = form;
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

<Card.Root
	class="mx-auto w-full max-w-md gap-4 rounded-2xl border border-slate-200/80 bg-white py-5 shadow-xs sm:py-6"
>
	<Card.Header class="gap-1 pb-0 text-center">
		<Card.Title class="text-xl font-bold text-[#0A2647] sm:text-2xl">เชื่อมบัญชีผู้ใช้</Card.Title>
		<Card.Description class="text-xs text-slate-500 sm:text-sm">
			เข้าสู่ระบบด้วย {providerLabel} สำเร็จ
			{#if pending.display}
				(<span class="font-medium text-slate-700">{pending.display}</span>)
			{/if}
			— กรอกชื่อผู้ใช้และรหัสผ่านที่ได้รับจากผู้ดูแลระบบ เพื่อเชื่อม {providerLabel} เข้ากับบัญชีของคุณ
		</Card.Description>
	</Card.Header>
	<Card.Content>
		<form method="POST" use:form.enhance class="flex flex-col gap-4">
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
								class="h-11"
							/>
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
				</Form.Field>

				<Form.Field {form} name="password">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label class="text-sm font-semibold text-slate-700"
								>รหัสผ่านชั่วคราว (Password)</Form.Label
							>
							<div class="relative">
								<Input
									{...props}
									type={showPassword ? 'text' : 'password'}
									bind:value={$formData.password}
									placeholder="กรอกรหัสผ่านที่ได้รับ"
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
			</div>

			<div class="flex flex-col gap-2 pt-0.5">
				<Form.Button
					disabled={$submitting}
					class="h-11 w-full rounded-xl bg-[#0A2647] font-semibold text-white transition-colors hover:bg-[#051930]"
				>
					เชื่อมบัญชีและเข้าสู่ระบบ
				</Form.Button>
				<Button type="button" variant="ghost" class="h-11 w-full" onclick={() => void cancel()}>
					ยกเลิก
				</Button>

				{#if captchaEnabled}
					<p class="text-center text-xs text-muted-foreground">
						เว็บไซต์นี้มีการป้องกันด้วย reCAPTCHA
					</p>
				{/if}
			</div>
		</form>
	</Card.Content>
</Card.Root>
