<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import { clearRecaptchaStatusCache } from '$lib/api/recaptcha-status';
	import { useAppConfig, useUpdateAppConfig } from '../application/app-config-queries';

	const configQuery = useAppConfig();
	const updateMutation = useUpdateAppConfig();

	const enabled = $derived(configQuery.data?.config.recaptcha_enabled ?? true);
	const busy = $derived(configQuery.isLoading || updateMutation.isPending);

	async function setRecaptchaEnabled(next: boolean) {
		if (next === enabled) return;
		try {
			await updateMutation.mutateAsync({ recaptcha_enabled: next });
			clearRecaptchaStatusCache();
			toast.success(next ? 'เปิดใช้งาน reCAPTCHA แล้ว' : 'ปิดใช้งาน reCAPTCHA แล้ว');
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
			<Label for="recaptcha-enabled" class="text-sm font-semibold text-slate-900">reCAPTCHA</Label>
			<p class="text-sm text-slate-500">ป้องกันสแปมบนหน้าเข้าสู่ระบบ ลงทะเบียนสาธารณะ และบริจาค</p>
		</div>
		<Switch
			id="recaptcha-enabled"
			checked={enabled}
			onCheckedChange={(v) => void setRecaptchaEnabled(v === true)}
			disabled={busy}
			aria-label="เปิดใช้งาน reCAPTCHA"
		/>
	</div>
{/if}
