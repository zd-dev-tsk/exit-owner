/* ============================================================
   Exit Owner — cap table simulation engine
   Percentage-method model. Assumptions (documented in UI):
   1. Post-money SAFE: holder's ownership at conversion = amount / cap,
      measured on the cap table AFTER all SAFEs convert but BEFORE the
      new round's money and option-pool increase (YC post-money SAFE
      semantics: SAFE percentages are additive and dilute existing
      holders only).
   2. Pre-money SAFE: cap-based ownership = amount / (cap + total SAFE
      amounts converting), an approximation of share-count mechanics.
   3. Discount: discount-based ownership = amount / ((1 - d) * preMoney).
      The SAFE converts at whichever basis gives MORE ownership.
   4. Priced round: new investors own amount / (preMoney + amount) of
      the post-round company. Pre-money valuation is inclusive of
      converted SAFEs and the expanded option pool (standard term).
   5. Option pool top-up: raised to target % of POST-round fully
      diluted, created pre-money (dilutes existing holders + SAFEs,
      not the new investors). Never shrinks below its current size.
   6. Exit: every investor (priced + converted SAFEs) holds 1x
      non-participating preference = invested amount (toggleable).
      Each chooses max(preference, as-converted). Solved iteratively.
   ============================================================ */

function simulate(scenario) {
  // scenario: { founders:[{name, pct}], earlyPoolPct, events:[...], exitValue, prefsEnabled }
  // event: {type:'safe', name, amount, cap, capType:'post'|'pre', discount}
  //        {type:'priced', name, amount, preMoney, poolPct}
  const stages = [];
  // holders: id -> {label, kind:'founder'|'pool'|'investor', pct, invested}
  let holders = [];
  const totalFounderPct = scenario.founders.reduce((s, f) => s + f.pct, 0);
  const earlyPool = scenario.earlyPoolPct || 0;
  const founderScale = (100 - earlyPool) / (totalFounderPct || 1);
  scenario.founders.forEach((f, i) => {
    holders.push({ id: 'F' + i, label: f.name || 'Founder ' + (i + 1), kind: 'founder', pct: f.pct * founderScale / 100, invested: 0 });
  });
  if (earlyPool > 0) holders.push({ id: 'POOL', label: 'Option pool', kind: 'pool', pct: earlyPool / 100, invested: 0 });
  else holders.push({ id: 'POOL', label: 'Option pool', kind: 'pool', pct: 0, invested: 0 });

  stages.push(snap('Founding', holders, null));

  let pendingSafes = [];
  const warnings = [];

  for (const ev of scenario.events) {
    if (ev.type === 'safe') {
      pendingSafes.push(ev);
      stages.push(snap(ev.name || 'SAFE', holders, { note: 'SAFE signed — converts at next priced round', pending: pendingSafes.slice() }));
    } else if (ev.type === 'priced') {
      // 1. Convert pending SAFEs (percentage method)
      const totalSafeAmt = pendingSafes.reduce((s, x) => s + x.amount, 0);
      const safePcts = pendingSafes.map(s => {
        let capPct = 0;
        if (s.cap > 0) {
          capPct = s.capType === 'pre'
            ? s.amount / (s.cap + totalSafeAmt)
            : s.amount / s.cap; // post-money cap
        }
        let discPct = 0;
        if (s.discount > 0 && ev.preMoney > 0) {
          discPct = s.amount / ((1 - s.discount / 100) * ev.preMoney);
        }
        let pct = Math.max(capPct, discPct);
        if (pct === 0) pct = s.amount / (ev.preMoney + 0.0000001); // uncapped, no discount: converts at round price
        return Math.min(pct, 0.95);
      });
      const safeTotal = safePcts.reduce((a, b) => a + b, 0);
      if (safeTotal > 0.6) warnings.push(`SAFEs converting at "${ev.name}" claim ${(safeTotal * 100).toFixed(1)}% — likely a down-round / cram-down situation.`);
      // existing holders diluted pro-rata by SAFE conversion
      holders.forEach(h => { h.pct *= (1 - safeTotal); });
      pendingSafes.forEach((s, i) => {
        holders.push({ id: 'S' + holders.length, label: s.name || 'SAFE investor', kind: 'investor', pct: safePcts[i], invested: s.amount });
      });
      pendingSafes = [];

      // 2. New investor %
      const invPct = ev.amount / (ev.preMoney + ev.amount);
      // 3. Pool top-up to target % of post (pre-money shuffle)
      const pool = holders.find(h => h.id === 'POOL');
      const targetPool = (ev.poolPct || 0) / 100;
      // pool's % after this round if untouched: current * (1 - invPct)
      const poolAfterIfUntouched = pool.pct * (1 - invPct);
      let poolFinal = Math.max(targetPool, poolAfterIfUntouched);
      // non-pool existing holders share: 1 - invPct - poolFinal, scaled pro-rata
      const nonPoolPre = holders.filter(h => h.id !== 'POOL').reduce((s, h) => s + h.pct, 0);
      const residual = 1 - invPct - poolFinal;
      if (residual < 0) warnings.push(`Round "${ev.name}": investor stake + pool exceed 100%. Check inputs.`);
      holders.forEach(h => {
        if (h.id === 'POOL') h.pct = poolFinal;
        else h.pct = nonPoolPre > 0 ? h.pct / nonPoolPre * Math.max(residual, 0) : 0;
      });
      holders.push({ id: 'R' + holders.length, label: ev.name || 'Investors', kind: 'investor', pct: invPct, invested: ev.amount });
      stages.push(snap(ev.name || 'Priced round', holders, {
        postMoney: ev.preMoney + ev.amount,
        safeConverted: safeTotal,
      }));
    }
  }

  if (pendingSafes.length) {
    warnings.push(`${pendingSafes.length} SAFE(s) never converted — add a priced round after them to see their dilution.`);
  }

  // Exit waterfall
  const exit = waterfall(holders, scenario.exitValue, scenario.prefsEnabled !== false);
  return { stages, holders, exit, warnings };
}

function waterfall(holders, exitValue, prefsEnabled) {
  const rows = holders.filter(h => h.pct > 1e-12 || h.invested > 0).map(h => ({
    label: h.label, kind: h.kind, pct: h.pct, invested: h.invested, payout: 0, tookPref: false,
  }));
  if (!exitValue || exitValue <= 0) return { rows, exitValue: 0 };
  if (!prefsEnabled) {
    rows.forEach(r => { r.payout = r.pct * exitValue; });
    return { rows, exitValue };
  }
  // iterate: investors take max(1x preference, pro-rata as-converted)
  let changed = true; let guard = 0;
  while (changed && guard++ < 50) {
    changed = false;
    const prefTotal = rows.filter(r => r.tookPref).reduce((s, r) => s + r.invested, 0);
    const remaining = Math.max(exitValue - prefTotal, 0);
    const convPct = rows.filter(r => !r.tookPref).reduce((s, r) => s + r.pct, 0);
    for (const r of rows) {
      if (r.kind !== 'investor' || r.invested <= 0) continue;
      const asConverted = convPct > 0 ? (r.tookPref ? 0 : r.pct / convPct * remaining)
        : 0;
      // evaluate flipping decision
      if (!r.tookPref) {
        // would they rather take pref? compare current as-converted vs pref
        if (r.invested > asConverted + 1e-9) { r.tookPref = true; changed = true; }
      } else {
        // would converting beat pref? simulate them back in
        const remainingIf = Math.max(exitValue - (prefTotal - r.invested), 0);
        const convPctIf = convPct + r.pct;
        const asConvIf = convPctIf > 0 ? r.pct / convPctIf * remainingIf : 0;
        if (asConvIf > r.invested + 1e-9) { r.tookPref = false; changed = true; }
      }
    }
  }
  const prefTotal = rows.filter(r => r.tookPref).reduce((s, r) => s + r.invested, 0);
  const prefPaid = Math.min(prefTotal, exitValue);
  const remaining = Math.max(exitValue - prefTotal, 0);
  const convPct = rows.filter(r => !r.tookPref).reduce((s, r) => s + r.pct, 0);
  rows.forEach(r => {
    if (r.tookPref) r.payout = prefTotal > 0 ? r.invested / prefTotal * prefPaid : 0;
    else r.payout = convPct > 0 ? r.pct / convPct * remaining : 0;
  });
  return { rows, exitValue };
}

function snap(name, holders, meta) {
  return { name, meta, holders: holders.map(h => ({ id: h.id, label: h.label, kind: h.kind, pct: h.pct })) };
}

if (typeof module !== 'undefined') module.exports = { simulate, waterfall };
