<script lang="ts">
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Hammer from '@lucide/svelte/icons/hammer';
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button';

	// Production board (BOM / recipe editor) is not wired to real meal_plan docs yet.
	// Gated behind a "coming soon" state until it reads/writes persisted data — the
	// previous mock (hardcoded BOM rows + fake stock warnings) was removed to avoid
	// shipping non-persisting UI into the main flow. Tracked as follow-up work.
</script>

<svelte:head>
	<title>กระดานการผลิต (เร็วๆ นี้) · SmartShelter</title>
</svelte:head>

<div class="flex min-h-full flex-col items-center justify-center gap-4 p-10 text-center">
	<div class="rounded-full bg-muted p-4">
		<Hammer class="h-8 w-8 text-muted-foreground" />
	</div>
	<div>
		<h1 class="text-lg font-bold">กระดานการผลิต (Production Board)</h1>
		<p class="mt-1 max-w-md text-sm text-muted-foreground">
			ฟีเจอร์จัดการสูตรมาตรฐาน (BOM) และการผลิตต่อมื้อกำลังพัฒนา —
			จะเปิดใช้งานเมื่อเชื่อมต่อกับข้อมูลแผนอาหารจริงแล้ว
		</p>
	</div>
	<Button variant="outline" onclick={() => history.back()}>
		<ArrowLeft class="mr-1.5 h-3.5 w-3.5" />
		กลับ
	</Button>
	<a href={resolve('/back-office/kitchen')} class="text-xs text-muted-foreground underline">
		ไปที่หน้าครัวกลาง
	</a>
</div>
