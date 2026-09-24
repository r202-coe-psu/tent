<script lang="ts">
	import { resolve } from '$app/paths';
	import { MasterDataConfigPage } from '$lib/features/master-data';
</script>

<svelte:head>
	<title>Master Data — SmartShelter</title>
	<meta name="description" content="จัดการรายการมาตรฐานที่ใช้ซ้ำในฟอร์ม" />
</svelte:head>

<MasterDataConfigPage
	basePath={resolve('/system-management/master-data')}
	scope="global"
	title="Master Data"
	description="จัดการรายการมาตรฐานที่ใช้ซ้ำในฟอร์ม · แก้ไขแล้วมีผลทันที"
/>
