/**
 * Public API of the `poc-image` feature (Proof of Concept).
 * Cross-feature and route code imports ONLY from here.
 */

export type { ImageDoc, ImageSummary } from './domain/poc-image';
export { isImageDoc } from './domain/poc-image';
export { pocImageRepository, POC_DB } from './data/poc-image.pouch';

