<script lang="ts">
	interface Props {
		subtitle?: string;
		title: string;
		description?: string;
		class?: string;
	}

	let {
		subtitle = 'ศูนย์จัดการฐานข้อมูลหลังบ้าน (Backend Master Console)',
		title,
		description,
		class: className = ''
	}: Props = $props();
</script>

<div class="animate-in font-sans duration-300 zoom-in-95 fade-in {className}">
	<!-- Upper premium cover card -->
	<div
		class="relative overflow-hidden rounded-[24px] border border-indigo-900 bg-[#013365] p-6 text-white shadow-md md:p-8 dark:bg-[#051b34]"
	>
		<!-- Ambient light aura for premium look -->
		<div
			class="pointer-events-none absolute top-0 right-0 h-64 w-64 rounded-full bg-blue-400/10 blur-3xl"
		></div>

		<div class="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
			<div>
				{#if subtitle}
					<span
						class="inline-block rounded-md border border-indigo-900/50 bg-[#013365]/30 px-2.5 py-1 font-mono text-[10px] font-bold tracking-wider text-blue-400 uppercase"
					>
						{subtitle}
					</span>
				{/if}

				<h2 class="mt-2.5 text-2xl font-extrabold tracking-tight text-slate-100 md:text-3xl">
					{title}
				</h2>

				{#if description}
					<p class="mt-2 max-w-2xl text-xs leading-relaxed font-medium text-slate-400">
						{description}
					</p>
				{/if}
			</div>
		</div>
	</div>
</div>
