<script lang="ts">
	import { toast } from 'svelte-sonner';
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
				<label for="recaptcha-enabled" class="text-sm font-medium text-card-foreground">
					เปิดใช้งาน reCAPTCHA
				</label>
				<p class="text-xs text-muted-foreground">
					ป้องกันสแปมบนหน้าเข้าสู่ระบบ ลงทะเบียนสาธารณะ และบริจาค เมื่อเปิด ต้องมีคีย์ใน env (<code
						class="rounded bg-muted px-1">PUBLIC_RECAPTCHA_SITE_KEY</code
					>
					/
					<code class="rounded bg-muted px-1">RECAPTCHA_PROJECT_ID</code>) ด้วย
				</p>
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
</div>
