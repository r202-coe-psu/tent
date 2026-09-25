<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import { clearThaidStatusCache } from '$lib/api/thaid-status';
	import { useAppConfig, useUpdateAppConfig } from '../application/app-config-queries';

	const configQuery = useAppConfig();
	const updateMutation = useUpdateAppConfig();

	const enabled = $derived(configQuery.data?.config.thaid_registration_enabled ?? true);
	const busy = $derived(configQuery.isLoading || updateMutation.isPending);

	async function setThaidRegistrationEnabled(next: boolean) {
		if (next === enabled) return;
		try {
			await updateMutation.mutateAsync({ thaid_registration_enabled: next });
			clearThaidStatusCache();
			toast.success(
				next ? 'เปิดใช้งาน ThaiD Digital ID ในระบบแล้ว' : 'ปิดใช้งาน ThaiD Digital ID ในระบบแล้ว'
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
			<Label for="thaid-registration-enabled" class="text-sm font-semibold text-slate-900">
				ThaiD
			</Label>
			<p class="text-sm text-slate-500">
				ปุ่มเข้าสู่ระบบ การผูกบัญชีพนักงาน และการดึงข้อมูลบัตรบนหน้าลงทะเบียน
			</p>
		</div>
		<Switch
			id="thaid-registration-enabled"
			checked={enabled}
			onCheckedChange={(v) => void setThaidRegistrationEnabled(v === true)}
			disabled={busy}
			aria-label="เปิดใช้งาน ThaiD Digital ID"
		/>
	</div>
{/if}
