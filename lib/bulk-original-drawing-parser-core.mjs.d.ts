export const supportedOriginalDrawingExtensions: Set<string>;
export const ignoredOriginalDrawingExtensions: Set<string>;

export interface BulkOriginalDrawingParseInput {
  relativePath?: string | null;
  fileName?: string | null;
  folderName?: string | null;
  customerFolder?: string | null;
  size?: number | null;
}

export interface BulkOriginalDrawingParseResult {
  relativePath: string;
  fileName: string;
  customerFolder: string;
  ext: string;
  size: number;
  supported: boolean;
  ignored: boolean;
  specification: string;
  productName: string;
  source: string;
  invalidSpecificationReason: string;
  suspectedNonOriginal: boolean;
  reason: string;
  warnings: string[];
}

export function dateLikeSpecificationReason(value: string): string;
export function invalidSpecificationReason(value: string): string;
export function isInvalidSpecification(value: string): boolean;
export function cleanOriginalDrawingProductName(value: string): string;
export function extractOriginalDrawingSpec(fileName: string): {
  specification: string;
  productName: string;
  source: string;
  invalidReason: string;
};
export function extractOriginalDrawingSpecWithExisting(fileName: string, existingSpecs: string[]): {
  specification: string;
  productName: string;
  source: string;
  invalidReason: string;
};
export function parseOriginalDrawingFile(input: BulkOriginalDrawingParseInput): BulkOriginalDrawingParseResult;
