/**
 * Button sizes for the actions under a kiosk notice panel, so every notice offers the same touch
 * targets. The trailing `!` on the svg sizes beats Button's own size-4 for icons without "size-".
 */
const focusRing = 'focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2';

export const KIOSK_NOTICE_PRIMARY_ACTION = `min-h-16 w-full gap-3 bg-[#0A2647] px-6 text-xl font-bold text-white hover:bg-[#051930] ${focusRing} kiosk-portrait:min-h-24 kiosk-portrait:text-3xl kiosk-compact:min-h-14 [&_svg]:size-6! kiosk-portrait:[&_svg]:size-8!`;

export const KIOSK_NOTICE_SECONDARY_ACTION = `min-h-14 w-full border-[#CBD5E1] px-5 text-lg font-semibold text-[#0A2647] ${focusRing} kiosk-portrait:min-h-20 kiosk-portrait:text-2xl kiosk-compact:min-h-12 kiosk-compact:text-base`;
