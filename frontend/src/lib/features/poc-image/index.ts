/**
 * Public API of the `poc-image` feature (Proof of Concept).
 * Cross-feature and route code imports ONLY from here.
 */

export type { ImageDoc, ImageSummary } from './data/poc-image.pouch';
export { pocImageRepository, POC_DB, isImageDoc } from './data/poc-image.pouch';
