<script lang="ts">
	import { page } from '$app/state';
	import Home from '@lucide/svelte/icons/home';
	import Compass from '@lucide/svelte/icons/compass';
	import Search from '@lucide/svelte/icons/search';
	import Heart from '@lucide/svelte/icons/heart';
	import FileText from '@lucide/svelte/icons/file-text';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';

	// Function to check if route is active
	function isActive(path: string) {
		if (path === '/public') {
			return page.url.pathname === '/public' || page.url.pathname === '/public/';
		}
		return page.url.pathname.startsWith(path);
	}
</script>

<header class="sticky top-0 z-50 w-full border-b border-border bg-card/95 px-6 py-3 shadow-xs backdrop-blur-md">
	<div class="mx-auto flex max-w-7xl items-center justify-between">
		<!-- Logo and Title -->
		<div class="flex items-center gap-3">
			<a href="/public" class="flex items-center gap-2">
				<div class="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-muted text-primary">
					<Compass class="h-5 w-5" />
				</div>
				<div class="flex flex-col">
					<span class="text-base font-bold tracking-tight text-foreground">Smart Shelter</span>
					<span class="text-[10px] font-semibold tracking-wider text-primary uppercase">Public & RFL Portal</span>
				</div>
			</a>
		</div>

		<!-- Navbar Links -->
		<nav class="hidden items-center gap-1 md:flex">
			<a
				href="/public"
				class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-muted/50 {isActive('/public') && !isActive('/public/') ? 'bg-primary-muted text-primary' : 'text-muted-foreground'}"
			>
				<Home class="h-4 w-4" />
				หน้าแรก
			</a>

			<a
				href="/public/shelters"
				class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-muted/50 text-muted-foreground pointer-events-none opacity-45 select-none"
				title="เร็วๆ นี้"
			>
				<Compass class="h-4 w-4" />
				ตรวจสอบศูนย์พักพิง
			</a>

			<a
				href="/public/family-search"
				class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-muted/50 text-muted-foreground pointer-events-none opacity-45 select-none"
				title="เร็วๆ นี้"
			>
				<Search class="h-4 w-4" />
				สืบค้นญาติ 
			</a>

			<a
				href="/public/donations"
				class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-muted/50 {isActive('/public/donations') ? 'bg-primary-muted text-primary' : 'text-muted-foreground'}"
			>
				<Heart class="h-4 w-4" />
				บริจาคและจองคิว
			</a>

			<a
				href="/public/transparency"
				class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-muted/50 text-muted-foreground pointer-events-none opacity-45 select-none"
				title="เร็วๆ นี้"
			>
				<FileText class="h-4 w-4" />
				รายงานความโปร่งใส <span class="text-[9px] font-bold text-muted-foreground/60">(เร็วๆ นี้)</span>
			</a>

			<!-- Dropdown for Volunteers -->
			<div class="relative group">
				<a
					href="/public/volunteers"
					class="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/50 group-hover:text-foreground {isActive('/public/volunteers') ? 'bg-primary-muted text-primary' : ''}"
				>
					<UserPlus class="h-4 w-4" />
					อาสาสมัคร / พี่เลี้ยง
					<ChevronDown class="h-3.5 w-3.5 text-muted-foreground/75 transition-transform group-hover:rotate-180" />
				</a>
				<div class="absolute right-0 mt-1 hidden w-48 rounded-xl border border-border bg-card p-1 shadow-lg group-hover:block">
					<a href="/public/volunteers" class="block rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
						ลงทะเบียนอาสาสมัคร
					</a>
					<a href="/public/volunteers/shifts" class="block rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
						ตรวจสอบตารางกะงาน
					</a>
				</div>
			</div>
		</nav>
	</div>
</header>
