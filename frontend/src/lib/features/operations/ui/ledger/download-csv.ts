/** Hand `csv` to the browser as a UTF-8 file; the BOM makes Excel read Thai text correctly. */
export function downloadCsv(filename: string, csv: string): void {
	const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	a.rel = 'noopener';
	// Some browsers (Firefox) only fire the download when the anchor is in the DOM,
	// and revoking the blob URL synchronously can abort the download — defer it.
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}
