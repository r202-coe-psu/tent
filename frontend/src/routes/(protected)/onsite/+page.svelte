<script lang="ts">
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Expand from '@lucide/svelte/icons/expand';
	import Search from '@lucide/svelte/icons/search';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import { resolve } from '$app/paths';
</script>

<svelte:head>
	<title>Onsite | SmartShelter Thailand</title>
</svelte:head>

<div class="mx-auto w-full max-w-6xl px-6 py-8">
	<div class="mb-6">
		<a
			href={resolve('/portal')}
			class="inline-flex items-center gap-2 rounded-full bg-muted px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent"
		>
			<ArrowLeft class="size-3.5" />
			<span>กลับหน้าหลัก</span>
		</a>
	</div>

	<header class="mb-8">
		<h1 class="text-3xl font-bold text-foreground">ระบบส่วนหน้า ณ ศูนย์พักพิง</h1>
		<p class="mt-1 text-sm text-muted-foreground">เลือกงานที่ต้องการทำ</p>
	</header>

	<main class="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
		<a
			href={resolve('/onsite/people')}
			class="group flex min-h-[220px] flex-col justify-between rounded-2xl border border-border bg-card p-8 shadow-[0_4px_25px_rgba(0,0,0,0.03)] transition-all hover:-translate-y-1 hover:shadow-md"
		>
			<div
				class="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-xl text-foreground transition-colors group-hover:bg-primary-muted group-hover:text-primary"
			>
				<UserPlus class="size-6" />
			</div>
			<div>
				<h2 class="mb-1 text-2xl font-bold text-foreground">ลงทะเบียนใหม่</h2>
				<p class="text-xs font-medium tracking-wider text-muted-foreground uppercase">
					New Registration
				</p>
			</div>
		</a>

		<div
			class="flex min-h-[220px] flex-col justify-between rounded-2xl border border-border bg-card p-8 opacity-60"
			aria-disabled="true"
		>
			<div
				class="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-xl text-foreground"
			>
				<Search class="size-6" />
			</div>
			<div>
				<h2 class="mb-1 text-2xl font-bold text-foreground">ค้นหาและแก้ไขข้อมูล</h2>
				<p class="text-xs font-medium tracking-wider text-muted-foreground uppercase">
					Search &amp; Update
				</p>
			</div>
		</div>

		<a
			href={resolve('/onsite/scan-check-in-out')}
			class="group flex min-h-[220px] flex-col justify-between rounded-2xl border border-border bg-card p-8 shadow-[0_4px_25px_rgba(0,0,0,0.03)] transition-all hover:-translate-y-1 hover:shadow-md"
		>
			<div
				class="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-xl text-foreground transition-colors group-hover:bg-primary-muted group-hover:text-primary"
			>
				<Expand class="size-6" />
			</div>
			<div>
				<h2 class="mb-1 text-2xl font-bold text-foreground">สแกนเข้า-ออกศูนย์</h2>
				<p class="text-xs font-medium tracking-wider text-muted-foreground uppercase">
					Check-in / Out
				</p>
			</div>
		</a>
	</main>
</div>
