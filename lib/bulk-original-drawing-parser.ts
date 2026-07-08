// The CLI imports the .mjs core directly. This typed wrapper keeps Next.js
// client/server code on the same runtime parser without duplicating rules.
// @ts-expect-error Next's TS pass does not resolve declarations for local .mjs modules.
import * as parserCore from './bulk-original-drawing-parser-core.mjs';

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

type CoreModule = {
  supportedOriginalDrawingExtensions: Set<string>;
  ignoredOriginalDrawingExtensions: Set<string>;
  dateLikeSpecificationReason(value: string): string;
  invalidSpecificationReason(value: string): string;
  isInvalidSpecification(value: string): boolean;
  cleanOriginalDrawingProductName(value: string): string;
  extractOriginalDrawingSpec(fileName: string): {
    specification: string;
    productName: string;
    source: string;
    invalidReason: string;
  };
  extractOriginalDrawingSpecWithExisting(fileName: string, existingSpecs: string[]): {
    specification: string;
    productName: string;
    source: string;
    invalidReason: string;
  };
  parseOriginalDrawingFile(input: BulkOriginalDrawingParseInput): BulkOriginalDrawingParseResult;
};

const core = parserCore as CoreModule;

export const supportedOriginalDrawingExtensions = core.supportedOriginalDrawingExtensions;
export const ignoredOriginalDrawingExtensions = core.ignoredOriginalDrawingExtensions;
export const dateLikeSpecificationReason = core.dateLikeSpecificationReason;
export const invalidSpecificationReason = core.invalidSpecificationReason;
export const isInvalidSpecification = core.isInvalidSpecification;
export const cleanOriginalDrawingProductName = core.cleanOriginalDrawingProductName;
export const extractOriginalDrawingSpec = core.extractOriginalDrawingSpec;
export const extractOriginalDrawingSpecWithExisting = core.extractOriginalDrawingSpecWithExisting;
export const parseOriginalDrawingFile = core.parseOriginalDrawingFile;
