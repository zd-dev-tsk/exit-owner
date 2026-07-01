/* ============================================================
   AI Agents Marketplace — core mechanics (prototype)
   Pure functions, no I/O. Model assumptions:
   1. Trust score (0–100): Bayesian-smoothed rating mapped to 0–60,
      plus verification/sandbox/scan bonuses, minus permission-risk
      and staleness penalties. Prior = 3.5 stars with weight C = 20
      ratings, so tiny samples are pulled toward the prior.
   2. Permission risk: scopes are tiered low/medium/high by their
      blast radius (read < act-on-your-behalf < money/credentials).
   3. Ranking: relevance is a weighted token match over name (×3),
      tags (×2), capabilities + description (×1). Final score =
      relevance × (0.5 + trust/100); zero relevance never ranks.
      Empty query ranks by trust × log10(installs + 10).
   4. Settlement: platform fee is a % of gross after passing model
      inference cost through at cost — the platform never profits
      from token burn. publisherNet + platformFee + inferenceCost
      always reconstruct gross.
   ============================================================ */

const PERMISSION_RISK = {
  'repo:read': 'low', 'files:read': 'low', 'calendar:read': 'low',
  'net:fetch': 'low', 'contacts:read': 'low', 'crm:read': 'low',
  'repo:write': 'medium', 'files:write': 'medium', 'email:read': 'medium',
  'calendar:write': 'medium', 'crm:write': 'medium', 'browser:control': 'medium',
  'email:send': 'high', 'payments:charge': 'high', 'credentials:access': 'high',
  'shell:exec': 'high', 'contacts:write': 'high',
};
const RISK_ORDER = { low: 0, medium: 1, high: 2 };

function permissionRisk(scope) {
  return PERMISSION_RISK[scope] || 'high'; // unknown scopes are treated as high
}

function overallRisk(permissions) {
  if (!permissions || !permissions.length) return 'low';
  return permissions.reduce((worst, p) =>
    RISK_ORDER[permissionRisk(p)] > RISK_ORDER[worst] ? permissionRisk(p) : worst, 'low');
}

const PRICING_MODELS = ['free', 'per_call', 'subscription', 'revshare'];

function validateManifest(m) {
  const errors = [];
  if (!m || typeof m !== 'object') return { ok: false, errors: ['manifest must be an object'] };
  if (!m.id || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(m.id)) errors.push('id: required, lowercase slug (a-z, 0-9, hyphens)');
  if (!m.name || typeof m.name !== 'string') errors.push('name: required string');
  if (!m.version || !/^\d+\.\d+\.\d+$/.test(m.version)) errors.push('version: required semver (x.y.z)');
  if (!m.publisher || !m.publisher.name) errors.push('publisher.name: required');
  if (!m.description || m.description.length < 20) errors.push('description: required, at least 20 characters');
  if (!m.category) errors.push('category: required');
  if (!Array.isArray(m.capabilities) || !m.capabilities.length) errors.push('capabilities: required non-empty array');
  if (!Array.isArray(m.permissions)) errors.push('permissions: required array (may be empty)');
  if (!m.pricing || !PRICING_MODELS.includes(m.pricing.model)) {
    errors.push(`pricing.model: required, one of ${PRICING_MODELS.join('|')}`);
  } else {
    if (m.pricing.model === 'per_call' && !(m.pricing.pricePerCall > 0)) errors.push('pricing.pricePerCall: required > 0 for per_call');
    if (m.pricing.model === 'subscription' && !(m.pricing.monthly > 0)) errors.push('pricing.monthly: required > 0 for subscription');
    if (m.pricing.model === 'revshare' && !(m.pricing.sharePct > 0 && m.pricing.sharePct < 100)) errors.push('pricing.sharePct: required 0–100 exclusive for revshare');
  }
  return { ok: errors.length === 0, errors };
}

function bayesianRating(avg, count, prior = 3.5, C = 20) {
  if (!count) return prior;
  return (C * prior + count * avg) / (C + count);
}

function trustScore(agent, now = '2026-07-01') {
  const ratings = (agent.stats && agent.stats.ratings) || { avg: 0, count: 0 };
  const bayes = bayesianRating(ratings.avg, ratings.count);
  let score = ((bayes - 1) / 4) * 60; // 1★→0, 5★→60

  if (agent.publisher && agent.publisher.verified) score += 15;
  const sec = agent.security || {};
  if (sec.sandboxed) score += 10;
  if (sec.scanPassed) score += 10;

  const highPerms = (agent.permissions || []).filter(p => permissionRisk(p) === 'high').length;
  score -= Math.min(highPerms * 5, 15);

  const updatedAt = agent.stats && agent.stats.updatedAt;
  if (updatedAt) {
    const days = (Date.parse(now) - Date.parse(updatedAt)) / 86400000;
    if (days > 180) score -= 10;
  }
  return Math.max(0, Math.min(100, score));
}

function relevance(agent, query) {
  const tokens = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return 0;
  const name = (agent.name || '').toLowerCase();
  const tags = (agent.tags || []).join(' ').toLowerCase();
  const body = ((agent.capabilities || []).join(' ') + ' ' + (agent.description || '') + ' ' + (agent.category || '')).toLowerCase();
  let r = 0;
  for (const t of tokens) {
    if (name.includes(t)) r += 3;
    if (tags.includes(t)) r += 2;
    if (body.includes(t)) r += 1;
  }
  return r;
}

function rankAgents(agents, { query = '', category = '', pricing = '', minTrust = 0, now } = {}) {
  const scored = agents
    .filter(a => !category || a.category === category)
    .filter(a => !pricing || (a.pricing && a.pricing.model) === pricing)
    .map(a => {
      const trust = trustScore(a, now);
      const rel = relevance(a, query);
      const installs = (a.stats && a.stats.installs) || 0;
      const score = query.trim()
        ? rel * (0.5 + trust / 100)
        : trust * Math.log10(installs + 10);
      return { agent: a, trust, relevance: rel, score };
    })
    .filter(x => x.trust >= minTrust)
    .filter(x => !query.trim() || x.relevance > 0);
  scored.sort((a, b) => b.score - a.score || b.trust - a.trust);
  return scored;
}

function settle({ gross, inferenceCost = 0, platformFeePct = 15 }) {
  if (!(gross >= 0)) throw new Error('gross must be >= 0');
  const cost = Math.min(inferenceCost, gross); // pass-through capped at gross
  const feeBase = gross - cost;
  const platformFee = feeBase * (platformFeePct / 100);
  const publisherNet = feeBase - platformFee;
  return { gross, inferenceCost: cost, platformFee, publisherNet };
}

function estimateMonthlyCost(agent, callsPerMonth) {
  const p = agent.pricing || {};
  if (p.model === 'free') return 0;
  if (p.model === 'per_call') return (callsPerMonth || 0) * p.pricePerCall;
  if (p.model === 'subscription') return p.monthly;
  return null; // revshare: depends on transaction volume, not calls
}

if (typeof module !== 'undefined') {
  module.exports = {
    validateManifest, permissionRisk, overallRisk, bayesianRating,
    trustScore, relevance, rankAgents, settle, estimateMonthlyCost,
    PERMISSION_RISK, PRICING_MODELS,
  };
}
