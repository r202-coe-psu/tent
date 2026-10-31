<script lang="ts">
	import { onMount } from 'svelte';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { toast } from 'svelte-sonner';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { FORCE_SETUP_ROUTE, LANDING_ROUTE, resolvePostLoginDestination } from '$lib/guards/auth';
	import { authStore } from '$lib/stores/auth.svelte';
	import { SECURITY_QUESTIONS } from '$lib/auth/security-questions';
	import PasswordRuleChecklist from '$lib/components/password-rule-checklist.svelte';
	import { fetchAuthStatus, forceSetupFieldErrors, submitForceSetup } from '$lib/features/users';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import Lock from '@lucide/svelte/icons/lock';
	import ShieldQuestion from '@lucide/svelte/icons/shield-question-mark';
	import Eye from '@lucide/svelte/icons/eye';
	import EyeOff from '@lucide/svelte/icons/eye-off';

	let currentUsername = $state('');
	let mustChangePassword = $state(false);
	let newPassword = $state('');
	let confirmPassword = $state('');
	let questionId = $state('');
	let answer = $state('');
	let showPassword = $state(false);
	let loading = $state(false);
	/** Errors show after the first submit and stay, live, until the field is fixed (#1065). */
	let submitted = $state(false);
	/** A server refusal, in Thai, kept on screen instead of a toast. */
	let serverError = $state<string | null>(null);

	const errors = $derived(
		submitted
			? forceSetupFieldErrors({
					questionId,
					answer,
					newPassword,
					confirmPassword,
					mustChangePassword
				})
			: {}
	);

	onMount(async () => {
		try {
			const status = await fetchAuthStatus();
			const dest = resolvePostLoginDestination(status);
			if (dest !== FORCE_SETUP_ROUTE) {
				await goto(resolve(dest));
				return;
			}
			currentUsername = status.name;
			mustChangePassword = status.must_change_password;
		} catch {
			currentUsername = authStore.user?.name ?? '';
			mustChangePassword = false;
		}
	});

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();

		submitted = true;
		serverError = null;
		if (Object.keys(errors).length > 0) return;

		loading = true;
		try {
			await submitForceSetup({
				new_password: newPassword ? newPassword : undefined,
				security_question: {
					question_id: questionId,
					answer: answer.trim()
				}
			});

			if (newPassword) {
				const username = currentUsername || authStore.user?.name;
				if (username) {
					await authStore.login({
						name: username,
						password: newPassword
					});
				}
			}

			toast.success('บันทึกการตั้งค่าความปลอดภัยเรียบร้อยแล้ว!');
			let dest: '/portal' | '/force-setup' | '/mfa-challenge' = LANDING_ROUTE;
			try {
				const status = await fetchAuthStatus();
				dest = resolvePostLoginDestination(status);
			} catch {
				/* fall through to portal */
			}
			await goto(resolve(dest));
		} catch (err) {
			// Server messages are Thai (password policy, missing answer); anything else falls back.
			const message = err instanceof Error ? err.message : '';
			serverError = /[\u0E00-\u0E7F]/.test(message)
				? message
				: 'ไม่สามารถบันทึกการตั้งค่าได้ กรุณาลองใหม่อีกครั้ง';
		} finally {
			loading = false;
		}
	}
</script>

<div class="flex min-h-[var(--app-shell-height)] w-full items-center justify-center px-4 py-8">
	<Card.Root class="w-full max-w-lg rounded-2xl border-slate-200 bg-white shadow-xl">
		<Card.Header class="space-y-2 border-b border-slate-100 pb-4 text-center">
			<div
				class="mx-auto flex size-12 items-center justify-center rounded-full bg-blue-50 text-blue-700"
			>
				<ShieldCheck class="size-6" />
			</div>
			<Card.Title class="text-xl font-bold text-slate-900">
				{mustChangePassword
					? 'ตั้งรหัสผ่านใหม่และบันทึกคำถามความปลอดภัย'
					: 'ตั้งค่าคำถามความปลอดภัยสำหรับกู้คืนบัญชี'}
			</Card.Title>
			<Card.Description class="text-xs leading-relaxed text-slate-500">
				{#if mustChangePassword}
					เนื่องจากรหัสผ่านของคุณถูกรีเซ็ตโดยผู้ดูแลระบบ
					กรุณาตั้งรหัสผ่านใหม่และเลือกคำถามความปลอดภัยก่อนเริ่มใช้งาน
				{:else}
					กรุณาเลือกคำถามความปลอดภัยสำหรับกู้คืนบัญชีในอนาคต (สามารถใช้รหัสผ่านเดิมได้เลย
					หรือเปลี่ยนรหัสผ่านใหม่ได้ตามต้องการ)
				{/if}
			</Card.Description>
		</Card.Header>

		<Card.Content class="p-6">
			<form onsubmit={handleSubmit} class="space-y-5" novalidate>
				<!-- Section 1: Security Question (Primary) -->
				<div class="space-y-3 rounded-xl border border-blue-100 bg-blue-50/50 p-4">
					<h4
						class="flex items-center gap-1.5 text-xs font-bold tracking-wider text-blue-800 uppercase"
					>
						<ShieldQuestion class="size-4 text-blue-600" />
						คำถามความปลอดภัย (สำหรับกู้คืนรหัสผ่านด้วยตนเอง) <span class="text-red-500">*</span>
					</h4>

					<div>
						<label
							for="security-question-select"
							class="mb-1 block text-xs font-bold text-slate-700"
						>
							เลือกคำถาม 1 ข้อ <span class="text-red-500">*</span>
						</label>
						<select
							id="security-question-select"
							bind:value={questionId}
							class="h-10 w-full rounded-md border border-input bg-white px-3 text-sm"
							disabled={loading}
							aria-invalid={errors.question ? true : undefined}
							aria-describedby={errors.question ? 'security-question-select-error' : undefined}
						>
							<option value="" disabled>— เลือกคำถาม —</option>
							{#each SECURITY_QUESTIONS as q (q.id)}
								<option value={q.id}>{q.label}</option>
							{/each}
						</select>
						{#if errors.question}
							<p
								id="security-question-select-error"
								class="mt-1 text-xs font-medium text-destructive"
							>
								{errors.question}
							</p>
						{/if}
					</div>

					<div>
						<label
							for="security-question-answer"
							class="mb-1 block text-xs font-bold text-slate-700"
						>
							คำตอบความปลอดภัยของคุณ <span class="text-red-500">*</span>
						</label>
						<Input
							id="security-question-answer"
							bind:value={answer}
							type="text"
							placeholder="พิมพ์คำตอบที่คุณจำได้แม่นยำ"
							class="h-10 bg-white text-sm"
							disabled={loading}
							aria-invalid={errors.answer ? true : undefined}
							aria-describedby={errors.answer ? 'security-question-answer-error' : undefined}
						/>
						{#if errors.answer}
							<p
								id="security-question-answer-error"
								class="mt-1 text-xs font-medium text-destructive"
							>
								{errors.answer}
							</p>
						{/if}
					</div>
				</div>

				<!-- Section 2: Password (Required if mustChangePassword, Optional for existing user) -->
				<div class="space-y-3 rounded-xl border border-slate-200 bg-slate-50/50 p-4">
					<div class="flex items-center justify-between">
						<h4
							class="flex items-center gap-1.5 text-xs font-bold tracking-wider text-slate-700 uppercase"
						>
							<Lock class="size-3.5 text-slate-600" />
							{mustChangePassword ? 'ตั้งรหัสผ่านใหม่' : 'เปลี่ยนรหัสผ่านใหม่ (ไม่บังคับ)'}
						</h4>
						{#if !mustChangePassword}
							<span class="text-[11px] font-normal text-slate-500"
								>เว้นว่างไว้หากต้องการใช้รหัสผ่านเดิม</span
							>
						{/if}
					</div>

					<div>
						<label
							for="force-setup-new-password"
							class="mb-1 block text-xs font-bold text-slate-700"
						>
							รหัสผ่านใหม่
							{#if mustChangePassword}
								<span class="text-red-500">*</span>
							{:else}
								(เว้นว่างได้)
							{/if}
						</label>
						<div class="relative">
							<Input
								id="force-setup-new-password"
								type={showPassword ? 'text' : 'password'}
								bind:value={newPassword}
								placeholder={mustChangePassword
									? 'อย่างน้อย 10 ตัวอักษร (A-Z, a-z, 0-9, !@#)'
									: 'เว้นว่างไว้หากใช้รหัสผ่านเดิม'}
								class="h-10 bg-white pr-10 text-sm"
								disabled={loading}
								aria-invalid={errors.newPassword ? true : undefined}
								aria-describedby={errors.newPassword ? 'force-setup-new-password-error' : undefined}
							/>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								class="absolute top-0 right-0 h-full px-3 hover:bg-transparent"
								onclick={() => (showPassword = !showPassword)}
							>
								{#if showPassword}
									<EyeOff class="size-4 text-muted-foreground" />
								{:else}
									<Eye class="size-4 text-muted-foreground" />
								{/if}
							</Button>
						</div>
						{#if errors.newPassword}
							<p
								id="force-setup-new-password-error"
								class="mt-1 text-xs font-medium text-destructive"
							>
								{errors.newPassword}
							</p>
						{/if}
						{#if newPassword.length > 0 || mustChangePassword}
							<PasswordRuleChecklist password={newPassword} class="mt-2" />
						{/if}
					</div>

					{#if newPassword.length > 0 || mustChangePassword}
						<div>
							<label
								for="force-setup-confirm-password"
								class="mb-1 block text-xs font-bold text-slate-700"
							>
								ยืนยันรหัสผ่านใหม่ <span class="text-red-500">*</span>
							</label>
							<Input
								id="force-setup-confirm-password"
								type={showPassword ? 'text' : 'password'}
								bind:value={confirmPassword}
								placeholder="กรอกรหัสผ่านใหม่อีกครั้ง"
								class="h-10 bg-white text-sm"
								disabled={loading}
								aria-invalid={errors.confirmPassword ? true : undefined}
								aria-describedby={errors.confirmPassword
									? 'force-setup-confirm-password-error'
									: undefined}
							/>
							{#if errors.confirmPassword}
								<p
									id="force-setup-confirm-password-error"
									class="mt-1 text-xs font-medium text-destructive"
								>
									{errors.confirmPassword}
								</p>
							{/if}
						</div>
					{/if}
				</div>

				{#if serverError}
					<p
						role="alert"
						class="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm font-medium text-destructive"
					>
						{serverError}
					</p>
				{/if}

				<Button
					type="submit"
					disabled={loading}
					class="h-11 w-full bg-[#0f2d5c] font-bold text-white hover:bg-[#0a1e3f]"
				>
					{#if loading}กำลังบันทึก...{:else}บันทึกและเข้าสู่ระบบ{/if}
				</Button>
			</form>
		</Card.Content>
	</Card.Root>
</div>
