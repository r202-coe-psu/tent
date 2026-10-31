export type KioskLabelSheetItem = {
	key: string;
	/** QR data URL; the card shows its placeholder while this is still being prepared. */
	qrSrc: string | undefined;
	qrSizeMm: number | undefined;
	name: string;
	/** Current zone name; missing or null leaves a dotted line to write the zone on. */
	zone?: string | null;
	/** Intake stations passed: this many checklist boxes are ticked. */
	checkedCount?: number;
	/** Staff cards: large bold badge at the bottom, above the link (e.g. เจ้าหน้าที่). */
	badge?: string;
	/** Staff cards: bold lines under the name, no zone row and no station checklist. */
	lines?: readonly string[];
	alt?: string;
};
