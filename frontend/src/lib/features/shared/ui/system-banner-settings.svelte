<script lang="ts">
	import { useAppConfig } from '../application/app-config-queries';
	import SystemBannerForm from './system-banner-form.svelte';

	const configQuery = useAppConfig();
</script>

{#if configQuery.isLoading}
	<p class="text-sm text-slate-500">กำลังโหลดการตั้งค่า…</p>
{:else if configQuery.isError}
	<p class="text-sm text-red-700">
		{configQuery.error instanceof Error ? configQuery.error.message : 'โหลดการตั้งค่าไม่สำเร็จ'}
	</p>
{:else if configQuery.data}
	<SystemBannerForm config={configQuery.data.config} />
{/if}
