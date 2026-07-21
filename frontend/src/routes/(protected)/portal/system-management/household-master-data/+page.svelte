<script lang="ts">
	import { resolve } from '$app/paths';
	import { MasterDataConfigPage, HOUSEHOLD_MASTER_TYPES } from '$lib/features/master-data';
</script>

<svelte:head>
	<title>ตั้งค่าครัวเรือน — SmartShelter</title>
	<meta name="description" content="จัดการค่ามาตรฐานสำหรับตั้งค่าครัวเรือน" />
</svelte:head>

<MasterDataConfigPage
	allowedTypes={HOUSEHOLD_MASTER_TYPES}
	basePath={resolve('/portal/system-management/household-master-data')}
	title="3. ตั้งค่าครัวเรือน (Household Master Data)"
	description="จัดการค่ามาตรฐานสำหรับตั้งค่าครัวเรือน — เพิ่ม แก้ไข หรือลบตัวเลือกที่ใช้ในแต่ละหมวดหมู่"
/>
