<script lang="ts">
	import { KIOSK_SCREENS, type KioskScreenType } from '$lib/features/shared';
	import {
		bannerColorSchema,
		emptyKioskBannerTemplate,
		type KioskBannerTemplate
	} from '../domain/kiosk-banner-template';
	import { fitScale } from './kiosk-banner-preview-frame';

	/**
	 * Live preview of a template banner: a box of the real screen size, scaled down to fit. `node`
	 * is the full-size inner box, which `exportTemplatePng` turns into the banner PNG. Text is only
	 * ever interpolated (never `{@html}`), so staff input cannot inject markup.
	 */
	let {
		template,
		screen,
		logoUrl = null,
		node = $bindable(null)
	}: {
		template: KioskBannerTemplate;
		screen: KioskScreenType;
		/** Object URL of a newly chosen logo, or the stored logo's URL. */
		logoUrl?: string | null;
		node?: HTMLElement | null;
	} = $props();

	/** Tallest the on-screen preview may be; a portrait screen would otherwise fill the page. */
	const MAX_PREVIEW_HEIGHT = 480;
	const FALLBACK = emptyKioskBannerTemplate();
	const FLEX_ALIGN = { left: 'flex-start', center: 'center', right: 'flex-end' } as const;

	let availableWidth = $state(0);

	const frame = $derived(KIOSK_SCREENS[screen]);
	const scale = $derived(fitScale(frame, { width: availableWidth, height: MAX_PREVIEW_HEIGHT }));
	// A colour that is still being typed (not yet `#rrggbb`) keeps the last sensible default.
	const bg = $derived(
		bannerColorSchema.safeParse(template.bg_color).success ? template.bg_color : FALLBACK.bg_color
	);
	const text = $derived(
		bannerColorSchema.safeParse(template.text_color).success
			? template.text_color
			: FALLBACK.text_color
	);
	// Sizes follow the shorter side so one layout reads well on 1024x600 and 1080x1920 alike.
	const unit = $derived(Math.min(frame.width, frame.height));
</script>

<div bind:clientWidth={availableWidth} class="w-full">
	<div
		role="group"
		aria-label="ตัวอย่างประกาศ"
		data-testid="banner-template-canvas"
		class="mx-auto overflow-hidden rounded-lg border border-slate-300"
		style:width="{frame.width * scale}px"
		style:height="{frame.height * scale}px"
	>
		<div
			bind:this={node}
			data-testid="banner-template-node"
			style:width="{frame.width}px"
			style:height="{frame.height}px"
			style:transform="scale({scale})"
			style:transform-origin="top left"
			style:box-sizing="border-box"
			style:display="flex"
			style:flex-direction="column"
			style:justify-content="center"
			style:align-items={FLEX_ALIGN[template.align]}
			style:gap="{unit * 0.04}px"
			style:padding="{unit * 0.08}px"
			style:background-color={bg}
			style:color={text}
			style:text-align={template.align}
			style:font-family="'IBM Plex Sans Thai Looped', sans-serif"
			style:overflow="hidden"
		>
			{#if logoUrl}
				<img
					src={logoUrl}
					alt=""
					style:max-width="100%"
					style:max-height="{unit * 0.3}px"
					style:object-fit="contain"
				/>
			{/if}
			{#if template.heading}
				<div
					style:font-size="{unit * 0.1}px"
					style:font-weight="700"
					style:line-height="1.25"
					style:overflow-wrap="anywhere"
				>
					{template.heading}
				</div>
			{/if}
			{#if template.body}
				<div
					style:font-size="{unit * 0.055}px"
					style:line-height="1.5"
					style:white-space="pre-line"
					style:overflow-wrap="anywhere"
				>
					{template.body}
				</div>
			{/if}
		</div>
	</div>
</div>
