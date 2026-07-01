# AI Agents Marketplace — design

How I would build a marketplace where developers publish AI agents and users
discover, install, and pay for them. This document is the "how"; the sibling
files (`engine.js`, `registry.js`, `index.html`, `test.js`) are a working
client-side prototype of the core mechanics.

## 1. What is being sold

An **agent** is not a model — it's a packaged capability: a system prompt +
tool set + permission scopes + pricing, versioned and signed by a publisher.
The unit of exchange is the **manifest**:

```json
{
  "id": "code-reviewer",
  "name": "Code Reviewer Pro",
  "version": "2.1.0",
  "publisher": { "name": "DevTools Inc", "verified": true },
  "description": "Reviews pull requests for bugs and style.",
  "category": "coding",
  "tags": ["review", "git"],
  "capabilities": ["review pull requests", "suggest fixes"],
  "model": "claude-sonnet-5",
  "permissions": ["repo:read", "net:fetch"],
  "pricing": { "model": "per_call", "pricePerCall": 0.05 },
  "security": { "sandboxed": true, "scanPassed": true }
}
```

A machine-readable manifest is the keystone decision. Everything else —
search, trust scoring, permission review, billing, version upgrades — becomes
a function over manifests instead of a manual process.

## 2. The three hard problems (in order)

Marketplaces don't fail on CRUD; they fail on trust, discovery, and economics.

### Trust
Agents act on users' behalf with real permissions, so trust is the product.

- **Declared permissions, enforced at runtime.** An agent lists scopes
  (`repo:read`, `email:send`, `payments:charge`); the runtime sandbox grants
  only those. Undeclared access is a kill, not a warning.
- **Risk-tiered review.** Scopes map to low/medium/high risk. High-risk
  scopes (write access, payments, credentials) trigger human review before
  listing and are surfaced prominently to installers.
- **Trust score, not raw stars.** Ratings are Bayesian-smoothed (a 5.0 from
  3 reviews must not outrank a 4.6 from 3,000), then adjusted for publisher
  verification, sandboxing, security-scan status, permission breadth, and
  staleness. The exact formula is in `engine.js` and unit-tested.
- **Versions are immutable.** Upgrades that add permissions require explicit
  user re-consent — this is the supply-chain-attack chokepoint.

### Discovery
- Ranking = **query relevance × quality**, never engagement alone. Relevance
  from name/tags/capabilities matching; quality from the trust score. Paid
  placement, if ever, is labeled and capped.
- Categories + pricing-model + minimum-trust filters; empty query falls back
  to trust-and-adoption ranking.
- Every listing shows an **evals badge**: publishers submit task suites, the
  platform runs them on listing and on every version bump. "Works" claims
  become reproducible numbers.

### Economics
- **Usage-based first** (per-call or metered), because agent value is
  delivered per invocation; subscriptions for high-frequency agents; rev-share
  for agents that close transactions.
- Platform take ~15% — low enough that publishers don't route around you,
  enough to fund review and hosting. Settlement math is pure and tested
  (`settle()` in the engine): gross → platform fee → publisher net, with
  model-inference cost passed through at cost so the platform never profits
  from token burn.
- Free tier per agent (N calls) so discovery isn't paywalled.

## 3. Architecture

```
 publisher CLI ──▶ Registry (manifests, versions, signatures)
                        │
        ┌───────────────┼────────────────┐
        ▼               ▼                ▼
  Review pipeline   Search/rank     Billing/metering
  (scan, evals,     (relevance ×    (per-call events,
   human for        trust)          settlement)
   high-risk)           │
                        ▼
                  Runtime sandbox ◀── user installs / invokes
                  (scoped tools, egress control, audit log)
```

- **Registry**: append-only versioned store of signed manifests. Start with
  Postgres + object storage; the API is boring on purpose.
- **Runtime**: agents run in the platform sandbox (or bring-your-own-runtime
  with attestation later). The sandbox is what makes declared permissions
  real, and it's also the metering point for billing.
- **Protocol**: expose agents over open standards (MCP for tools,
  agent-to-agent invocation) so an agent is callable from any client — the
  marketplace competes on distribution and trust, not lock-in.

## 4. Sequencing

1. **v0 — curated registry** (this prototype's scope): manifest schema,
   validation, trust scoring, search/rank, listing UI. Hand-pick ~50 agents;
   curation is the moat while volume is low.
2. **v1 — self-serve publishing**: publisher CLI, automated scan + eval
   pipeline, per-call billing, sandbox runtime.
3. **v2 — network effects**: agent-to-agent composition (agents invoking
   marketplace agents, fees flow down the chain), enterprise private
   registries, revenue-share pricing.

## 5. What the prototype demonstrates

- `engine.js` — manifest validation, permission risk tiers, Bayesian trust
  scoring, relevance×trust ranking, and fee settlement as pure functions.
- `registry.js` — a seed registry of agents as data.
- `index.html` — browse/search/filter UI with trust and permission-risk
  surfaced on every card, plus a live manifest validator (the publish flow).
- `test.js` — unit tests over the mechanics (`node test.js`).
