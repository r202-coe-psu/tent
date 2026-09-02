<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { toast } from 'svelte-sonner';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { authStore } from '$lib/stores/auth.svelte';
	import { LANDING_ROUTE } from '$lib/guards/auth';
	import {
		getSecurityQuestionChallenge,
		verifySecurityQuestionAndReset
	} from '$lib/features/users';
	import { KeyRound, ArrowLeft, ShieldQuestion, ShieldAlert } from '@lucide/svelte';
	import Eye from '@lucide/svelte/icons/eye';
	import EyeOff from '@lucide/svelte/icons/eye-off';

	let step = $state<1 | 2>(1);
	let phone = $state('');
	let questionId = $state<string | null>(null);
	let questionLabel = $state<string | null>(null);
	let hasNoSecurityQuestion = $state(false);

	let answer = $state('');
	let newPassword = $state('');
	let confirmPassword = $state('');
	let showPassword = $state(false);
	let loading = $state(false);

	async function handleCheckPhone(e: SubmitEvent) {
		e.preventDefault();
		const cleanPhone = phone.trim();
		if (!cleanPhone || cleanPhone.length < 3) {
			toast.error('กรุณากรอกเบอร์โทรศัพท์หรือ Username');
			return;
		}

		loading = true;
		hasNoSecurityQuestion = false;
		try {
			const res = await getSecurityQuestionChallenge(cleanPhone);
			if (!res.found) {
				toast.error('ไม่พบบัญชีผู้ใช้นี้ในระบบ');
				return;
			}
			if (!res.question_id || !res.question_label) {
				hasNoSecurityQuestion = true;
				return;
			}

			questionId = res.question_id;
			questionLabel = res.question_label;
			step = 2;
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการตรวจสอบบัญชี');
		} finally {
			loading = false;
		}
	}

	async function handleResetSubmit(e: SubmitEvent) {
		e.preventDefault();
		if (!answer.trim()) {
			toast.error('กรุณากรอกคำตอบความปลอดภัย');
			return;
		}
		if (!newPassword) {
			toast.error('กรุณากรอกรหัสผ่านใหม่');
			return;
		}
		if (newPassword !== confirmPassword) {
			toast.error('รหัสผ่านใหม่และการยืนยันรหัสผ่านไม่ตรงกัน');
			return;
		}

		if (!questionId) {
			toast.error('ไม่พบคำถามความปลอดภัย');
			return;
		}

		loading = true;
		try {
			await verifySecurityQuestionAndReset({
				phone: phone.trim(),
				question_id: questionId,
				answer: answer.trim(),
				new_password: newPassword
			});

			toast.success('รีเซ็ตรหัสผ่านสำเร็จ! กำลังเข้าสู่ระบบ...');

			// Auto login
			await authStore.login({
				name: phone.trim(),
				password: newPassword
			});

			await goto(resolve(LANDING_ROUTE));
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'คำตอบไม่ถูกต้องหรือไม่สามารถรีเซ็ตได้');
		} finally {
			loading = false;
		}
	}
</script>

<div class="flex min-h-[var(--app-shell-height)] w-full items-center justify-center px-4 py-8">
	<Card.Root class="w-full max-w-md rounded-2xl border-slate-200 bg-white shadow-xl">
		<Card.Header class="space-y-2 border-b border-slate-100 pb-4 text-center">
			<div
				class="mx-auto flex size-12 items-center justify-center rounded-full bg-blue-50 text-blue-700"
			>
				<KeyRound class="size-6" />
			</div>
			<Card.Title class="text-xl font-bold text-slate-900"
				>กู้คืนรหัสผ่าน (Forgot Password)</Card.Title
			>
			<Card.Description class="text-xs text-slate-500">
				{step === 1
					? 'กรอกเบอร์โทรศัพท์เพื่อตอบคำถามความปลอดภัย'
					: 'ตอบคำถามความปลอดภัยและตั้งรหัสผ่านใหม่'}
			</Card.Description>
		</Card.Header>

		<Card.Content class="p-6">
			{#if step === 1}
				<form onsubmit={handleCheckPhone} class="space-y-4">
					<div>
						<label class="mb-1.5 block text-sm font-bold text-slate-800">
							เบอร์โทรศัพท์ / Username <span class="text-red-500">*</span>
						</label>
						<Input
							bind:value={phone}
							type="text"
							placeholder="เช่น 0812345678"
							autocomplete="username"
							class="h-11 bg-slate-50"
							disabled={loading}
							required
						/>
					</div>

					{#if hasNoSecurityQuestion}
						<div
							class="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900"
						>
							<div class="flex items-center gap-2 font-bold text-amber-800">
								<ShieldAlert class="size-4" />
								<span>ยังไม่ได้ตั้งคำถามความปลอดภัย</span>
							</div>
							<p class="leading-relaxed">
								บัญชีนี้ยังไม่ได้ตั้งค่าคำถามความปลอดภัยไว้ในระบบ กรุณาติดต่อผู้จัดการศูนย์พักพิง
								หรือผู้ดูแลระบบ เพื่อขอรับ <strong>รหัสผ่านชั่วคราว (Temporary Passphrase)</strong>
							</p>
						</div>
					{/if}

					<Button
						type="submit"
						disabled={loading || !phone.trim()}
						class="h-11 w-full bg-[#0f2d5c] font-bold text-white hover:bg-[#0a1e3f]"
					>
						{#if loading}กำลังตรวจสอบ...{:else}ตรวจสอบคำถามความปลอดภัย{/if}
					</Button>

					<div class="pt-2 text-center">
						<a
							href="/login"
							class="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-900"
						>
							<ArrowLeft class="size-3.5" /> กลับสู่หน้าเข้าสู่ระบบ
						</a>
					</div>
				</form>
			{:else}
				<form onsubmit={handleResetSubmit} class="space-y-4">
					<!-- Question card -->
					<div class="space-y-1.5 rounded-xl border border-blue-100 bg-blue-50/60 p-4">
						<div class="flex items-center gap-1.5 text-xs font-bold text-blue-800">
							<ShieldQuestion class="size-4" />
							<span>คำถามความปลอดภัยของคุณ</span>
						</div>
						<p class="text-sm font-semibold text-slate-900">
							{questionLabel}
						</p>
					</div>

					<!-- Answer -->
					<div>
						<label class="mb-1.5 block text-sm font-bold text-slate-800">
							คำตอบความปลอดภัย <span class="text-red-500">*</span>
						</label>
						<Input
							bind:value={answer}
							type="text"
							placeholder="พิมพ์คำตอบที่คุณเคยบันทึกไว้"
							class="h-11 bg-slate-50"
							disabled={loading}
							required
						/>
					</div>

					<!-- New Password -->
					<div>
						<label class="mb-1.5 block text-sm font-bold text-slate-800">
							รหัสผ่านใหม่ <span class="text-red-500">*</span>
						</label>
						<div class="relative">
							<Input
								type={showPassword ? 'text' : 'password'}
								bind:value={newPassword}
								placeholder="อย่างน้อย 10 ตัวอักษร (A-Z, a-z, 0-9, !@#)"
								class="h-11 bg-slate-50 pr-10"
								disabled={loading}
								required
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
					</div>

					<!-- Confirm Password -->
					<div>
						<label class="mb-1.5 block text-sm font-bold text-slate-800">
							ยืนยันรหัสผ่านใหม่ <span class="text-red-500">*</span>
						</label>
						<Input
							type={showPassword ? 'text' : 'password'}
							bind:value={confirmPassword}
							placeholder="กรอกรหัสผ่านใหม่อีกครั้ง"
							class="h-11 bg-slate-50"
							disabled={loading}
							required
						/>
					</div>

					<Button
						type="submit"
						disabled={loading || !answer.trim() || !newPassword}
						class="h-11 w-full bg-emerald-700 font-bold text-white hover:bg-emerald-800"
					>
						{#if loading}กำลังบันทึก...{:else}รีเซ็ตรหัสผ่านและเข้าสู่ระบบ{/if}
					</Button>

					<div class="flex items-center justify-between pt-1 text-xs">
						<button
							type="button"
							class="text-slate-500 hover:text-slate-800"
							onclick={() => {
								step = 1;
								answer = '';
								newPassword = '';
								confirmPassword = '';
							}}
						>
							เปลี่ยนเบอร์โทร
						</button>
						<a href="/login" class="font-semibold text-blue-600 hover:underline">
							กลับหน้าเข้าสู่ระบบ
						</a>
					</div>
				</form>
			{/if}
		</Card.Content>
	</Card.Root>
</div>
