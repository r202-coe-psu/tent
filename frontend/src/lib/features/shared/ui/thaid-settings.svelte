<script lang="ts">
	import { toast } from 'svelte-sonner';
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

<div class="space-y-4">
	{#if configQuery.isLoading}
		<p class="text-sm text-muted-foreground">กำลังโหลดการตั้งค่า…</p>
	{:else if configQuery.isError}
		<p class="text-sm text-destructive">
			{configQuery.error instanceof Error ? configQuery.error.message : 'โหลดการตั้งค่าไม่สำเร็จ'}
		</p>
	{:else}
		<div
			class="flex items-start justify-between gap-4 rounded-lg border border-border bg-background p-4"
		>
			<div class="min-w-0 flex-1 space-y-1">
				<label for="thaid-registration-enabled" class="text-sm font-medium text-card-foreground">
					เปิดใช้งาน ThaiD Digital ID
				</label>
				<p class="text-xs text-muted-foreground">
					ควบคุมการแสดง ThaiD ทั้งระบบ: ปุ่มเข้าสู่ระบบด้วย ThaiD, การผูกบัญชีในหน้าโปรไฟล์พนักงาน
					(/me), และการดึงข้อมูลบัตรประชาชน/ที่อยู่ในหน้าลงทะเบียนล่วงหน้าสาธารณะ
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
</div>
