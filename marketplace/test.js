const E = require('./engine.js');
const { REGISTRY } = require('./registry.js');
let pass = 0, fail = 0;
function eq(name, got, want, tol = 1e-9) {
  const ok = typeof want === 'number' ? Math.abs(got - want) <= tol : got === want;
  if (ok) { pass++; }
  else { fail++; console.log(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
}

// T1: registry manifests all validate
eq('T1 registry valid', REGISTRY.every(a => E.validateManifest(a).ok), true);

// T2: validation catches missing/bad fields
let v = E.validateManifest({ id: 'Bad Slug!', name: 'X', version: '1.0', description: 'short', capabilities: [], pricing: { model: 'per_call' } });
eq('T2 invalid rejected', v.ok, false);
eq('T2 flags id', v.errors.some(e => e.startsWith('id:')), true);
eq('T2 flags version', v.errors.some(e => e.startsWith('version:')), true);
eq('T2 flags pricePerCall', v.errors.some(e => e.includes('pricePerCall')), true);

// T3: Bayesian smoothing — few ratings pulled toward the 3.5 prior
eq('T3 no ratings = prior', E.bayesianRating(0, 0), 3.5);
eq('T3 3×5.0 stays near prior', E.bayesianRating(5, 3), (20 * 3.5 + 15) / 23);
const small = E.bayesianRating(5.0, 3), big = E.bayesianRating(4.6, 3000);
eq('T3 volume beats tiny perfect score', big > small, true);

// T4: trust score ordering — Meeting Scribe (7 ratings, unscanned, unverified)
// must not outrank Deep Researcher (540 ratings, verified, scanned)
const now = '2026-07-01';
const scribe = REGISTRY.find(a => a.id === 'meeting-scribe');
const researcher = REGISTRY.find(a => a.id === 'deep-researcher');
eq('T4 trust ordering', E.trustScore(researcher, now) > E.trustScore(scribe, now), true);

// T5: high-risk permissions and staleness penalize trust
const base = { publisher: { verified: true }, security: { sandboxed: true, scanPassed: true }, permissions: [], stats: { ratings: { avg: 4.5, count: 500 }, updatedAt: '2026-06-01' } };
const risky = { ...base, permissions: ['shell:exec', 'payments:charge', 'credentials:access', 'email:send'] };
eq('T5 high-risk perms cost 15', E.trustScore(base, now) - E.trustScore(risky, now), 15);
const stale = { ...base, stats: { ...base.stats, updatedAt: '2025-06-01' } };
eq('T5 staleness costs 10', E.trustScore(base, now) - E.trustScore(stale, now), 10);
eq('T5 clamped to [0,100]', E.trustScore({ permissions: [], stats: { ratings: { avg: 1, count: 9999 } } }, now) >= 0, true);

// T6: permission risk tiers, unknown scope defaults to high
eq('T6 read is low', E.permissionRisk('repo:read'), 'low');
eq('T6 send is high', E.permissionRisk('email:send'), 'high');
eq('T6 unknown is high', E.permissionRisk('quantum:entangle'), 'high');
eq('T6 overall = worst', E.overallRisk(['repo:read', 'email:send']), 'high');
eq('T6 empty = low', E.overallRisk([]), 'low');

// T7: ranking — query relevance required, trust breaks quality
let ranked = E.rankAgents(REGISTRY, { query: 'review pull requests', now });
eq('T7 top match', ranked[0].agent.id, 'code-reviewer');
eq('T7 no zero-relevance results', ranked.every(r => r.relevance > 0), true);
ranked = E.rankAgents(REGISTRY, { query: 'zzz-no-such-thing', now });
eq('T7 no match = empty', ranked.length, 0);

// T8: filters compose
ranked = E.rankAgents(REGISTRY, { category: 'research', pricing: 'free', now });
eq('T8 filtered to paper-digest', ranked.length === 1 && ranked[0].agent.id === 'paper-digest', true);
eq('T8 minTrust filters', E.rankAgents(REGISTRY, { minTrust: 101, now }).length, 0);

// T9: settlement conserves gross; inference cost passed through at cost
let s = E.settle({ gross: 1000, inferenceCost: 200, platformFeePct: 15 });
eq('T9 fee', s.platformFee, 120);
eq('T9 publisher net', s.publisherNet, 680);
eq('T9 conservation', s.publisherNet + s.platformFee + s.inferenceCost, 1000);
s = E.settle({ gross: 100, inferenceCost: 150 }); // cost exceeds gross: capped, no negative payout
eq('T9 cost capped at gross', s.inferenceCost, 100);
eq('T9 no negative net', s.publisherNet, 0);

// T10: monthly cost estimates per pricing model
eq('T10 per_call', E.estimateMonthlyCost(REGISTRY.find(a => a.id === 'code-reviewer'), 2000), 100);
eq('T10 subscription', E.estimateMonthlyCost(REGISTRY.find(a => a.id === 'sql-analyst'), 999), 29);
eq('T10 free', E.estimateMonthlyCost(REGISTRY.find(a => a.id === 'paper-digest'), 999), 0);
eq('T10 revshare = null', E.estimateMonthlyCost(REGISTRY.find(a => a.id === 'deal-closer'), 999), null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
