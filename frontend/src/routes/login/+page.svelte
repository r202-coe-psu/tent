<script lang="ts">
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import { resolve } from '$app/paths';
	import { LoginForm } from '$lib/features/login';
</script>

<div class="flex h-[var(--app-shell-height)] w-full items-center justify-center px-4">
	<div class="flex w-full max-w-md flex-col gap-4">
		<a
			href={resolve('/')}
			class="inline-flex cursor-pointer items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground hover:underline"
		>
			<ArrowLeft class="size-4" />
			<span>กลับหน้าหลัก</span>
		</a>
		<LoginForm />
	</div>
</div>
