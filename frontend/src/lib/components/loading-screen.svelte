<script lang="ts">
	let { message = 'กำลังโหลดข้อมูล...' }: { message?: string } = $props();
</script>

<div
	class="flex flex-col items-center justify-center gap-3 rounded-xl border border-slate-200/80 bg-white py-20 shadow-2xs"
>
	<div
		class="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent"
	></div>
	<p class="text-sm font-medium text-slate-500">{message}</p>
</div>
