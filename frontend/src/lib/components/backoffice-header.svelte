<script lang="ts">
	// Destructure Svelte 5 props
	let {
		title,
		subtitle = 'ศูนย์จัดการข้อมูลหลังบ้าน (BACKEND MASTER CONSOLE)',
		description
	}: {
		title: string;
		subtitle?: string;
		description?: string;
	} = $props();
</script>

<div class="rounded-2xl bg-[#002f6c] p-6 text-white shadow-sm transition-all duration-300">
	<div class="flex flex-col gap-1.5">
		{#if subtitle}
			<span class="text-[10px] font-semibold tracking-wider text-sky-400 uppercase">
				{subtitle}
			</span>
		{/if}

		<h1 class="text-lg leading-tight font-bold md:text-2xl">
			{title}
		</h1>

		{#if description}
			<p class="text-[11px] leading-relaxed font-normal text-slate-300 opacity-90 md:text-xs">
				{description}
			</p>
		{/if}
	</div>
</div>
