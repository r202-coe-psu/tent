<script lang="ts">
	import type { PageData } from './$types';
	import { PublicPortalConfigForm } from '$lib/features/public-portal';
	import BackofficeHeader from '$lib/components/backoffice-header.svelte';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>{data.title} - Smart Shelter</title>
</svelte:head>

<div class="mx-auto w-full max-w-6xl space-y-4 p-4 sm:p-6">
	<BackofficeHeader
		title={data.title}
		description="จัดการคำถามที่พบบ่อย (FAQ) และลิงก์ติดต่อสำหรับหน้าเว็บไซต์หลัก"
	/>

	<div class="px-4 md:px-8">
		<PublicPortalConfigForm {data} />
	</div>
</div>
