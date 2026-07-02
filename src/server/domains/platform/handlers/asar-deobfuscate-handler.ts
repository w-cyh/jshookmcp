/**
 * asar_deobfuscate — batch obfuscation inventory + extraction for ASAR JS files.
 *
 * Scans every .js entry inside an ASAR archive for obfuscation indicators
 * (string-array arrays, webpack bundles, control-flow flattening, dynamic
 * code, minification heuristics), classifies each file, and optionally
 * extracts flagged files to a directory for downstream deobfuscation.
 */

import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, resolve } from 'node:path';
import type { ToolResponse } from '@server/types';
import { parseAsarBuffer } from '@server/domains/platform/handlers/electron-asar-helpers';
import {
  parseStringArg,
  parseBooleanArg,
  pathExists,
  resolveOutputDirectory,
  resolveSafeOutputPath,
  toDisplayPath,
  toErrorResponse,
  toTextResponse,
} from '@server/domains/platform/handlers/platform-utils';

export type ObfuscationClassification =
  | 'clean'
  | 'minified'
  | 'webpack-bundle'
  | 'obfuscated'
  | 'heavy-obfuscation';

export interface AsarFileObfuscationReport {
  path: string;
  size: number;
  classification: ObfuscationClassification;
  score: number;
  indicators: Record<string, number | boolean | string>;
}

export interface AsarDeobfuscateResult {
  success: boolean;
  tool: 'asar_deobfuscate';
  inputPath: string;
  filesScanned: number;
  summary: Record<ObfuscationClassification, number>;
  flaggedFiles: AsarFileObfuscationReport[];
  outputDir: string | null;
  extractedCount: number;
}

const MIN_FLAG_SCORE = 30;

export async function handleAsarDeobfuscate(args: Record<string, unknown>): Promise<ToolResponse> {
  try {
    const inputPath = parseStringArg(args, 'inputPath', true);
    if (!inputPath) throw new Error('inputPath is required');

    const fileGlob = parseStringArg(args, 'fileGlob') || '*.js';
    const extract = parseBooleanArg(args, 'extract', true);
    const outputDirArg = parseStringArg(args, 'outputDir');
    const maxFiles = typeof args.maxFiles === 'number' && args.maxFiles > 0 ? args.maxFiles : 500;

    const absInputPath = resolve(inputPath);
    if (!(await pathExists(absInputPath))) {
      return toTextResponse({
        success: false,
        tool: 'asar_deobfuscate',
        error: `File does not exist: ${inputPath}`,
      });
    }

    const asarBuffer = await readFile(absInputPath);
    const parsedAsar = parseAsarBuffer(asarBuffer);

    const globExt = fileGlob.startsWith('*.') ? fileGlob.slice(1).toLowerCase() : null;

    const jsEntries = parsedAsar.files.filter((entry) => {
      if (entry.unpacked || entry.size <= 0) return false;
      if (globExt) return extname(entry.path).toLowerCase() === globExt;
      return extname(entry.path).toLowerCase() === '.js';
    });

    const reports: AsarFileObfuscationReport[] = [];
    let scanned = 0;

    for (const entry of jsEntries) {
      if (scanned >= maxFiles) break;
      const start = parsedAsar.dataOffset + entry.offset;
      const end = start + entry.size;
      if (start < 0 || end > asarBuffer.length || end < start) continue;

      const content = asarBuffer.subarray(start, end).toString('utf-8');
      reports.push(analyzeFile(entry.path, entry.size, content));
      scanned += 1;
    }

    // Flag files that warrant extraction: anything that is not clean or merely
    // minified. Webpack bundles, obfuscated, and heavy-obfuscation files are
    // extracted even at low numeric scores so they reach downstream deobf tools.
    const flagged = reports.filter(
      (report) =>
        report.score >= MIN_FLAG_SCORE ||
        report.classification === 'webpack-bundle' ||
        report.classification === 'obfuscated' ||
        report.classification === 'heavy-obfuscation',
    );
    flagged.sort((a, b) => b.score - a.score);

    let outputDir: { absolutePath: string; displayPath: string } | null = null;
    let extractedCount = 0;

    if (extract && flagged.length > 0) {
      outputDir = await resolveOutputDirectory(
        'asar-deobfuscate',
        basename(absInputPath, extname(absInputPath)),
        outputDirArg,
      );

      for (const report of flagged) {
        const entry = parsedAsar.files.find((file) => file.path === report.path);
        if (!entry || entry.unpacked) continue;
        const start = parsedAsar.dataOffset + entry.offset;
        const end = start + entry.size;
        if (end > asarBuffer.length) continue;
        const data = asarBuffer.subarray(start, end);
        const outputPath = resolveSafeOutputPath(outputDir.absolutePath, report.path);
        await mkdir(dirname(outputPath), { recursive: true });
        await writeFile(outputPath, data);
        extractedCount += 1;
      }
    }

    const summary: Record<ObfuscationClassification, number> = {
      clean: 0,
      minified: 0,
      'webpack-bundle': 0,
      obfuscated: 0,
      'heavy-obfuscation': 0,
    };
    for (const report of reports) {
      summary[report.classification] += 1;
    }

    const result: AsarDeobfuscateResult = {
      success: true,
      tool: 'asar_deobfuscate',
      inputPath: toDisplayPath(absInputPath),
      filesScanned: scanned,
      summary,
      flaggedFiles: flagged,
      outputDir: outputDir?.displayPath ?? null,
      extractedCount,
    };

    return toTextResponse(result);
  } catch (error) {
    return toErrorResponse('asar_deobfuscate', error);
  }
}

/**
 * Analyze a single JS file's source for obfuscation indicators and return a
 * classification + numeric score. Indicators are intentionally cheap regex /
 * counting heuristics — they flag files for deeper analysis, not produce a
 * deobfuscated output directly.
 */
function analyzeFile(path: string, size: number, content: string): AsarFileObfuscationReport {
  const indicators: Record<string, number | boolean | string> = {};
  let score = 0;

  // String-array obfuscation: high density of _0x[0-9a-f]{4,} identifiers.
  const hexNameMatches = content.match(/_0x[0-9a-fA-F]{4,8}/g);
  const hexNameCount = hexNameMatches ? hexNameMatches.length : 0;
  indicators.hexNameCount = hexNameCount;
  if (hexNameCount > 50) {
    score += 45;
  } else if (hexNameCount > 20) {
    score += 30;
  }

  // Webpack bundling.
  const webpackRequireCount = countOccurrences(content, '__webpack_require__');
  const webpackModulesCount = countOccurrences(content, '__webpack_modules__');
  indicators.webpackRequireCount = webpackRequireCount;
  indicators.webpackModulesCount = webpackModulesCount;
  if (webpackRequireCount > 0 || webpackModulesCount > 0) {
    score += 10;
  }

  // Dynamic code execution.
  const evalAtob = /\beval\s*\(\s*atob\s*\(/.test(content);
  const newFunction = /\bnew\s+Function\s*\(/.test(content);
  const evalBase64 = /\beval\s*\(\s*(?:window\.|global\.)?atob\s*\(/.test(content);
  indicators.dynamicCode = evalAtob || newFunction || evalBase64;
  if (indicators.dynamicCode) {
    score += 25;
  }

  // Minification heuristic: average line length + long-line ratio.
  const lines = content.split('\n');
  const lineCount = lines.length;
  const longLines = lines.filter((line) => line.length > 500).length;
  const avgLineLength = lineCount > 0 ? Math.round(content.length / lineCount) : 0;
  const longLineRatio = lineCount > 0 ? longLines / lineCount : 0;
  indicators.lineCount = lineCount;
  indicators.avgLineLength = avgLineLength;
  indicators.longLineRatio = Number(longLineRatio.toFixed(2));
  if (avgLineLength > 500 && longLineRatio > 0.3) {
    score += 20;
    indicators.minified = true;
  } else {
    indicators.minified = false;
  }

  // Control-flow flattening: large switch inside a while/for loop.
  const switchInLoop = detectSwitchInLoop(content);
  indicators.switchInLoop = switchInLoop;
  if (switchInLoop) {
    score += 25;
  }

  // Numeric/string literal flood (common in packed payloads).
  const numericLiteralMatches = content.match(/\b0x[0-9a-fA-F]{4,}\b/g);
  const hexLiteralCount = numericLiteralMatches ? numericLiteralMatches.length : 0;
  indicators.hexLiteralCount = hexLiteralCount;
  if (hexLiteralCount > 100) {
    score += 10;
  }

  const classification = classify(score, indicators);
  if (score > 100) score = 100;

  return {
    path,
    size,
    classification,
    score,
    indicators,
  };
}

function classify(
  score: number,
  indicators: Record<string, number | boolean | string>,
): ObfuscationClassification {
  if (score >= 60) return 'heavy-obfuscation';
  if (score >= 30) return 'obfuscated';
  if ((indicators.webpackRequireCount as number) > 0) return 'webpack-bundle';
  if (indicators.minified === true) return 'minified';
  return 'clean';
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

/**
 * Detect control-flow flattening: a `while`/`for` loop containing a `switch`
 * with many sequential numeric case labels (the dispatcher pattern).
 */
function detectSwitchInLoop(content: string): boolean {
  const loopSwitchPattern =
    /(?:while\s*\([^)]*\)\s*\{|for\s*\([^)]*\)\s*\{)[\s\S]{0,2000}?\bswitch\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = loopSwitchPattern.exec(content)) !== null) {
    const switchStart = match.index + match[0].length;
    const switchBody = content.slice(switchStart, switchStart + 4000);
    const caseLabels = switchBody.match(/case\s+0x[0-9a-fA-F]+:/g);
    if (caseLabels && caseLabels.length >= 5) {
      return true;
    }
    const decimalCases = switchBody.match(/case\s+\d+:/g);
    if (decimalCases && decimalCases.length >= 5) {
      return true;
    }
  }
  return false;
}
