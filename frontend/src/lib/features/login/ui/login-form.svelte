<script lang="ts">
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
	import { LANDING_ROUTE } from '$lib/guards/auth';
	import { fetchAuthStatus } from '$lib/features/users/data/users.api';
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
					await authStore.login({
						name: form.data.username,
						password: form.data.password
					});
					reset();
					onSuccess?.();
					if (navigateOnSuccess) {
						try {
							const status = await fetchAuthStatus();
							if (status.must_change_password || !status.has_security_question) {
								await goto(resolve('/force-setup'));
								return;
							}
						} catch {
							// Fallback if status fetch fails
						}
						await goto(resolve(LANDING_ROUTE));
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
