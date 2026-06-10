import type {
  ApplyResult,
  TransformKind,
} from '@server/domains/transform/handlers.impl.transform-base';
import {
  DEAD_CODE_IF_FALSE,
  DEAD_CODE_IF_FALSE_WITH_ELSE,
  NUMERIC_BINARY_EXPR,
  STRING_CONCAT_EXPR,
  STRING_LITERAL_EXPR,
  TransformLimit,
  TransformToolHandlersBase,
} from '@server/domains/transform/handlers.impl.transform-base';
import { buildFallbackLineDiff, buildLineDiff } from './handlers/diff';

export class TransformToolHandlersOps extends TransformToolHandlersBase {
  protected resolveTransformsForApply(chainName: string, transformsRaw: unknown): TransformKind[] {
    if (chainName.length > 0) {
      const chain = this.chains.get(chainName);
      if (!chain) {
        throw new Error(`Transform chain not found: ${chainName}`);
      }
      return [...chain.transforms];
    }
    return this.parseTransforms(transformsRaw);
  }

  protected applyTransforms(code: string, transforms: TransformKind[]): ApplyResult {
    let transformed = code;
    const appliedTransforms: TransformKind[] = [];

    for (const transform of transforms) {
      const before = transformed;
      transformed = this.applySingleTransform(transformed, transform);
      if (transformed !== before) {
        appliedTransforms.push(transform);
      }
    }

    return { transformed, appliedTransforms };
  }

  protected applySingleTransform(code: string, transform: TransformKind): string {
    switch (transform) {
      case 'constant_fold':
        return this.transformConstantFold(code);
      case 'string_decrypt':
        return this.transformStringDecrypt(code);
      case 'dead_code_remove':
        return this.transformDeadCodeRemove(code);
      case 'control_flow_flatten':
        return this.transformControlFlowFlatten(code);
      case 'rename_vars':
        return this.transformRenameVars(code);
      default:
        return code;
    }
  }

  protected transformConstantFold(code: string): string {
    let current = code;
    for (let round = 0; round < 4; round++) {
      const numericFolded = current.replace(
        NUMERIC_BINARY_EXPR,
        (_full, leftRaw: string, operator: string, rightRaw: string) => {
          const left = Number(leftRaw);
          const right = Number(rightRaw);

          if (!Number.isFinite(left) || !Number.isFinite(right)) {
            return `${leftRaw}${operator}${rightRaw}`;
          }

          let value: number | null = null;
          switch (operator) {
            case '+':
              value = left + right;
              break;
            case '-':
              value = left - right;
              break;
            case '*':
              value = left * right;
              break;
            case '/':
              if (right !== 0) value = left / right;
              break;
            case '%':
              if (right !== 0) value = left % right;
              break;
            default:
              value = null;
          }

          if (value === null || !Number.isFinite(value)) {
            return `${leftRaw}${operator}${rightRaw}`;
          }

          return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(12)));
        },
      );

      const stringFolded = numericFolded.replace(
        STRING_CONCAT_EXPR,
        (_full, q1: string, left: string, q2: string, right: string) => {
          const quote = q1 === q2 ? q1 : "'";
          const merged = `${left}${right}`;
          return `${quote}${this.escapeStringContent(merged, quote)}${quote}`;
        },
      );

      if (stringFolded === current) {
        break;
      }
      current = stringFolded;
    }
    return current;
  }

  protected transformStringDecrypt(code: string): string {
    return code.replace(STRING_LITERAL_EXPR, (_full, quote: string, inner: string) => {
      const decoded = this.decodeEscapedString(inner);
      if (decoded === inner) {
        return `${quote}${inner}${quote}`;
      }
      return `${quote}${this.escapeStringContent(decoded, quote)}${quote}`;
    });
  }

  protected transformDeadCodeRemove(code: string): string {
    const withElseSimplified = code.replace(
      DEAD_CODE_IF_FALSE_WITH_ELSE,
      (_full, _ifBody: string, elseBody: string) => elseBody,
    );
    return withElseSimplified.replace(DEAD_CODE_IF_FALSE, '');
  }

  protected transformControlFlowFlatten(code: string): string {
    const flattenedPattern =
      /var\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*['"]([^'"]+)['"]\.split\(\s*['"]\|['"]\s*\)\s*;\s*var\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*0\s*;\s*while\s*\(\s*!!\[\]\s*\)\s*\{\s*switch\s*\(\s*\1\[\s*\3\+\+\s*\]\s*\)\s*\{([\s\S]*?)\}\s*break;\s*\}/g;

    return code.replace(
      flattenedPattern,
      (_full, _dispatcher: string, orderRaw: string, _cursor: string, switchBody: string) => {
        const caseRegex = /case\s*['"]([^'"]+)['"]\s*:\s*([\s\S]*?)(?=case\s*['"]|default\s*:|$)/g;
        const caseMap = new Map<string, string>();
        let match: RegExpExecArray | null;

        while ((match = caseRegex.exec(switchBody)) !== null) {
          const caseKey = match[1];
          const body = match[2] ?? '';
          const cleaned = body
            .replace(/\bcontinue\s*;?/g, '')
            .replace(/\bbreak\s*;?/g, '')
            .trim();

          if (caseKey && cleaned.length > 0) {
            caseMap.set(caseKey, cleaned);
          }
        }

        const order = orderRaw.split('|').map((item) => item.trim());
        const rebuilt = order
          .map((token) => caseMap.get(token))
          .filter((part): part is string => typeof part === 'string' && part.length > 0)
          .join('\n');

        return rebuilt.length > 0 ? rebuilt : _full;
      },
    );
  }

  protected transformRenameVars(code: string): string {
    const declaredSingleLetterVars = new Set<string>();
    const declarationRegex = /\b(?:var|let|const)\s+([A-Za-z])\b/g;
    let match: RegExpExecArray | null;

    while ((match = declarationRegex.exec(code)) !== null) {
      const name = match[1];
      if (name) {
        declaredSingleLetterVars.add(name);
      }
    }

    if (declaredSingleLetterVars.size === 0) {
      return code;
    }

    const renameMap = new Map<string, string>();
    let counter = 1;
    for (const name of declaredSingleLetterVars) {
      renameMap.set(name, `var_${counter}`);
      counter += 1;
    }

    return code.replace(
      /\b([A-Za-z])\b/g,
      (token: string, identifier: string, offset: number, full: string) => {
        const replacement = renameMap.get(identifier);
        if (!replacement) {
          return token;
        }

        const prev = offset > 0 ? full[offset - 1] : '';
        if (prev === '.' || prev === "'" || prev === '"' || prev === '`' || prev === '$') {
          return token;
        }

        return replacement;
      },
    );
  }

  protected buildDiff(original: string, transformed: string): string {
    return buildLineDiff(original, transformed, {
      maxLcsCells: TransformLimit.MAX_LCS_CELLS,
      fallback: (oldLines, newLines) => this.buildFallbackDiff(oldLines, newLines),
    });
  }

  protected buildFallbackDiff(oldLines: string[], newLines: string[]): string {
    return buildFallbackLineDiff(oldLines, newLines);
  }
}
