<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import { clearLoginMethodsCache } from '$lib/api/login-methods';
	import { useAppConfig, useUpdateAppConfig } from '../application/app-config-queries';

	const configQuery = useAppConfig();
	const updateMutation = useUpdateAppConfig();

	const enabled = $derived(configQuery.data?.config.password_login_enabled ?? false);
	const busy = $derived(configQuery.isLoading || updateMutation.isPending);

	async function setPasswordLoginEnabled(next: boolean) {
		if (next === enabled) return;
		try {
			await updateMutation.mutateAsync({ password_login_enabled: next });
			clearLoginMethodsCache();
			toast.success(
				next
					? 'แสดงช่องชื่อผู้ใช้/รหัสผ่านบนหน้าเข้าสู่ระบบแล้ว'
					: 'ซ่อนช่องชื่อผู้ใช้/รหัสผ่านบนหน้าเข้าสู่ระบบแล้ว'
			);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'บันทึกการตั้งค่าไม่สำเร็จ');
		}
	}
</script>

{#if configQuery.isLoading}
	<p class="text-sm text-slate-500">กำลังโหลดการตั้งค่า…</p>
{:else if configQuery.isError}
	<p class="text-sm text-red-700">
		{configQuery.error instanceof Error ? configQuery.error.message : 'โหลดการตั้งค่าไม่สำเร็จ'}
	</p>
{:else}
	<div class="flex items-center justify-between gap-4">
		<div class="min-w-0 space-y-1">
			<Label for="password-login-enabled" class="text-sm font-semibold text-slate-900">
				เข้าสู่ระบบด้วยชื่อผู้ใช้/รหัสผ่าน
			</Label>
			<p class="text-sm text-slate-500">
				แสดงช่องชื่อผู้ใช้และรหัสผ่านบนหน้าเข้าสู่ระบบหลัก — เมื่อปิด จะแสดงเฉพาะ Google และ ThaiD
			</p>
		</div>
		<Switch
			id="password-login-enabled"
			checked={enabled}
			onCheckedChange={(v) => void setPasswordLoginEnabled(v === true)}
			disabled={busy}
			aria-label="แสดงช่องชื่อผู้ใช้/รหัสผ่านบนหน้าเข้าสู่ระบบ"
		/>
	</div>
{/if}
