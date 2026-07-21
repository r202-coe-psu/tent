<script lang="ts">
	import { resolve } from '$app/paths';
	import { MasterDataConfigPage, REGISTRATION_MASTER_TYPES } from '$lib/features/master-data';
</script>

<svelte:head>
	<title>ข้อมูลหลักบุคคล — SmartShelter</title>
	<meta name="description" content="จัดการค่ามาตรฐานสำหรับฟอร์มลงทะเบียนบุคคล" />
</svelte:head>

<MasterDataConfigPage
	allowedTypes={REGISTRATION_MASTER_TYPES}
	basePath={resolve('/portal/system-management/registration-config')}
	title="1. ข้อมูลหลักบุคคล (Person Master Data)"
	description="จัดการค่ามาตรฐานสำหรับฟอร์มลงทะเบียนบุคคล — เพิ่ม แก้ไข หรือลบตัวเลือกที่ใช้ในแต่ละหมวดหมู่"
/>
