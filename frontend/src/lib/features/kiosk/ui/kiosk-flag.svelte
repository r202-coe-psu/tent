<script lang="ts">
	import type { LanguageCode } from '$lib/stores/language.svelte';
	import { KIOSK_LANGUAGE_I18N } from './_constants/kiosk-language.i18n';

	interface Props {
		/** `th` draws the Thai flag, `en` the Union Jack. */
		code: LanguageCode;
		class?: string;
		/** Hide from assistive tech when a label next to the flag already says it. */
		decorative?: boolean;
	}

	// Inline SVG, not a flag emoji: the kiosk's Chromium on Linux renders those as two letters.
	let { code, class: className = '', decorative = false }: Props = $props();

	const uid = $props.id();
	const label = $derived(
		code === 'th' ? KIOSK_LANGUAGE_I18N.thai.flagLabel : KIOSK_LANGUAGE_I18N.english.flagLabel
	);
</script>

{#if code === 'th'}
	<svg
		viewBox="0 0 9 6"
		role="img"
		aria-label={decorative ? undefined : label}
		aria-hidden={decorative ? 'true' : undefined}
		class={className}
	>
		<rect width="9" height="6" fill="#A51931" />
		<rect y="1" width="9" height="4" fill="#F4F5F8" />
		<rect y="2" width="9" height="2" fill="#2D2A4A" />
	</svg>
{:else}
	<svg
		viewBox="0 0 60 30"
		preserveAspectRatio="xMidYMid slice"
		role="img"
		aria-label={decorative ? undefined : label}
		aria-hidden={decorative ? 'true' : undefined}
		class={className}
	>
		<clipPath id={`${uid}-box`}><path d="M0,0 v30 h60 v-30 z" /></clipPath>
		<clipPath id={`${uid}-cross`}>
			<path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z" />
		</clipPath>
		<g clip-path={`url(#${uid}-box)`}>
			<path d="M0,0 v30 h60 v-30 z" fill="#012169" />
			<path d="M0,0 L60,30 M60,0 L0,30" stroke="#FFFFFF" stroke-width="6" />
			<path
				d="M0,0 L60,30 M60,0 L0,30"
				clip-path={`url(#${uid}-cross)`}
				stroke="#C8102E"
				stroke-width="4"
			/>
			<path d="M30,0 v30 M0,15 h60" stroke="#FFFFFF" stroke-width="10" />
			<path d="M30,0 v30 M0,15 h60" stroke="#C8102E" stroke-width="6" />
		</g>
	</svg>
{/if}
