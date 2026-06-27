export const meta = {
  name: 'military-grade-audit-v2',
  description: 'Per-domain military-grade audit — one agent per domain, high quality',
  phases: [
    {
      title: 'Batch 1: Core Domains',
      detail:
        'memory, process, binary-instrument, native-emulator, analysis, browser, network, exploit-dev, webgpu, v8-inspector',
    },
    {
      title: 'Batch 2: Platform Domains',
      detail:
        'debugger, trace, instrumentation, protocol-analysis, syscall-hook, platform, adb-bridge, native-bridge, dart-inspector, canvas',
    },
    {
      title: 'Batch 3: Utility Domains',
      detail:
        'encoding, graphql, wasm, mojo-ipc, coordination, workflow, maintenance, streaming, transform, cross-domain',
    },
    {
      title: 'Batch 4: Meta Domains',
      detail:
        'state-board, evidence, extension-registry, hooks, antidebug, secrets, sourcemap, proxy',
    },
    { title: 'Synthesis', detail: 'Aggregate all findings, rank gaps, generate final report' },
  ],
};

function auditBatch(batchNum, domains) {
  phase('Batch ' + batchNum);
  const results = parallel(
    domains.map(function (d) {
      return function () {
        return agent(
          'You are a military-grade reverse engineering tools auditor. Read ALL files for domain "' +
            d +
            '" and produce a rigorous audit.\n\n' +
            'DOMAIN FILES TO READ (use Read tool):\n' +
            '- src/server/domains/' +
            d +
            '/CLAUDE.md\n' +
            '- src/server/domains/' +
            d +
            '/definitions.ts\n' +
            '- src/server/domains/' +
            d +
            '/manifest.ts\n\n' +
            (batchNum <= 2
              ? 'WEB SEARCH (call WebSearch yourself):\n1. Search for the INDUSTRY STANDARD tool(s) in this domain\n2. Search for LATEST RESEARCH PAPERS (2024-2025) from NDSS, Usenix Security, CCS, Black Hat, DEF CON\n3. Search for known GAPS or LIMITATIONS\n\n'
              : '') +
            'YOUR JOB:\n' +
            '1. Inventory every tool in this domain (list name + purpose)\n' +
            '2. For each capability cluster, identify the INDUSTRY STANDARD equivalent\n' +
            '3. Score each capability: MET / PARTIAL / MISSING\n' +
            '4. Identify SPECIFIC gaps with concrete details\n' +
            '5. Rate the domain 1-10 military-grade with justification\n\n' +
            'OUTPUT FORMAT (strict):\n' +
            '## Domain: ' +
            d +
            '\n' +
            '### Tool Inventory (N tools)\n' +
            '| # | Tool Name | Purpose |\n' +
            '### Capability Map vs Industry Standards\n' +
            '| Capability | This Domain | Industry Standard | Gap |\n' +
            '### Findings: MET / PARTIAL / MISSING\n' +
            '### Military-Grade Score: X/10\n' +
            '### Top 3 Priority Gaps',
          {
            label: 'audit-b' + batchNum + ':' + d,
            phase: 'Batch ' + batchNum + ': Domains',
            effort: 'high',
            schema: {
              type: 'object',
              properties: {
                domain: { type: 'string' },
                toolCount: { type: 'number' },
                capabilityMap: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      capability: { type: 'string' },
                      thisDomain: { type: 'string' },
                      industryStandard: { type: 'string' },
                      gap: { type: 'string' },
                    },
                  },
                },
                findings: {
                  type: 'object',
                  properties: {
                    met: { type: 'array', items: { type: 'string' } },
                    partial: { type: 'array', items: { type: 'string' } },
                    missing: { type: 'array', items: { type: 'string' } },
                  },
                },
                score: { type: 'number' },
                topGaps: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      priority: { type: 'string', enum: ['HIGH', 'MED', 'LOW'] },
                      description: { type: 'string' },
                      why: { type: 'string' },
                    },
                  },
                },
              },
              required: ['domain', 'toolCount', 'capabilityMap', 'findings', 'score', 'topGaps'],
            },
          },
        );
      };
    }),
  );
  return results.filter(Boolean);
}

const batch1 = auditBatch(1, [
  'memory',
  'process',
  'binary-instrument',
  'native-emulator',
  'analysis',
  'browser',
  'network',
  'exploit-dev',
  'webgpu',
  'v8-inspector',
]);
log('Batch 1 done: ' + batch1.length + '/10');

const batch2 = auditBatch(2, [
  'debugger',
  'trace',
  'instrumentation',
  'protocol-analysis',
  'syscall-hook',
  'platform',
  'adb-bridge',
  'native-bridge',
  'dart-inspector',
  'canvas',
]);
log('Batch 2 done: ' + batch2.length + '/10');

const batch3 = auditBatch(3, [
  'encoding',
  'graphql',
  'wasm',
  'mojo-ipc',
  'coordination',
  'workflow',
  'maintenance',
  'streaming',
  'transform',
  'cross-domain',
]);
log('Batch 3 done: ' + batch3.length + '/10');

const batch4 = auditBatch(4, [
  'state-board',
  'evidence',
  'extension-registry',
  'hooks',
  'antidebug',
  'secrets',
  'sourcemap',
  'proxy',
]);
log('Batch 4 done: ' + batch4.length + '/8');

phase('Synthesis');
const allResults = batch1.concat(batch2).concat(batch3).concat(batch4);
const totalScore = allResults.reduce(function (a, r) {
  return a + r.score;
}, 0);
const avgScore = totalScore / allResults.length;
const allMissing = allResults.flatMap(function (r) {
  return r.findings.missing.map(function (m) {
    return { domain: r.domain, item: m };
  });
});
var seen = new Set();
var uniqueMissing = allMissing.filter(function (x) {
  var k = x.item.substring(0, 60);
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});

log(
  'Synthesis: avg=' + avgScore.toFixed(1) + ', ' + uniqueMissing.length + ' unique missing items',
);

return {
  totalDomains: allResults.length,
  avgScore: avgScore.toFixed(1),
  perDomain: allResults.map(function (r) {
    return { domain: r.domain, score: r.score };
  }),
  uniqueMissingItems: uniqueMissing.slice(0, 50),
  topGaps: allResults
    .flatMap(function (r) {
      return r.topGaps.map(function (g) {
        return { priority: g.priority, description: g.description, domain: r.domain };
      });
    })
    .slice(0, 30),
};
