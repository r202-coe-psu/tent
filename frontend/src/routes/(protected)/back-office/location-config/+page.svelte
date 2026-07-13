<script lang="ts">
	import { LocationManager } from '$lib/features/locations';
	import ConsoleBanner from '$lib/components/console-banner.svelte';
</script>

<svelte:head>
	<title>ข้อมูลที่อยู่ประเทศไทย — SmartShelter</title>
	<meta name="description" content="จัดการข้อมูลจังหวัด/อำเภอ/ตำบล และรหัสไปรษณีย์" />
</svelte:head>

<div class="mx-auto w-full max-w-6xl space-y-4 p-4 sm:p-6">
	<ConsoleBanner
		title="8. ข้อมูลที่อยู่ประเทศไทย (Thailand Location)"
		description="จัดการจังหวัด → อำเภอ → ตำบล และรหัสไปรษณีย์ (ข้อมูลอ้างอิงกลางใน CouchDB registry) — เลือกจากซ้ายไปขวาเพื่อเจาะระดับ. ชื่อคือคีย์ของเอกสาร: การเปลี่ยนชื่อทำโดยลบแล้วเพิ่มใหม่; ลบจังหวัด/อำเภอที่ยังมีข้อมูลลูกไม่ได้."
	/>

	<LocationManager />
</div>
