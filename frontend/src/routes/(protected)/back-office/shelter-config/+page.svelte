<script lang="ts">
	import { resolve } from '$app/paths';
	import { MasterDataConfigPage, SHELTER_MASTER_TYPES } from '$lib/features/master-data';
</script>

<svelte:head>
	<title>ตั้งค่าศูนย์พักพิง — SmartShelter</title>
	<meta name="description" content="จัดการค่ามาตรฐานสำหรับตั้งค่าศูนย์พักพิง" />
</svelte:head>

<MasterDataConfigPage
	allowedTypes={SHELTER_MASTER_TYPES}
	basePath={resolve('/back-office/shelter-config')}
	title="2. ตั้งค่าศูนย์พักพิง (Shelter Master Data)"
	description="จัดการค่ามาตรฐานสำหรับตั้งค่าศูนย์พักพิง — เพิ่ม แก้ไข หรือลบตัวเลือกที่ใช้ในแต่ละหมวดหมู่"
/>
