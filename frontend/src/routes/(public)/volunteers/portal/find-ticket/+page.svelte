<script lang="ts">
	import { PublicPageShell } from '$lib/features/public-portal';
	import { TicketFinder } from '$lib/features/volunteer-portal';
</script>

<svelte:head>
	<title>ค้นหาตั๋วอาสาสมัคร — Smart Shelter</title>
</svelte:head>

<!--
	The same finder the board's second tab renders, on its own URL so it can be linked
	to directly (CR-092 §5) — a volunteer who lost their pass link is told to come here,
	not "open the board and switch tabs".
-->
<PublicPageShell class="space-y-6 py-6">
	<header class="space-y-1 text-center">
		<h1 class="text-2xl font-bold">ค้นหาตั๋วของฉัน</h1>
		<p class="text-sm text-muted-foreground">กรอกเบอร์โทรศัพท์ที่ใช้สมัครเพื่อดูตั๋วดิจิทัล</p>
	</header>

	<TicketFinder />
</PublicPageShell>
