const { simulate } = require('./engine.js');
let pass = 0, fail = 0;
function eq(name, got, want, tol = 1e-6) {
  if (Math.abs(got - want) <= tol) { pass++; }
  else { fail++; console.log(`FAIL ${name}: got ${got}, want ${want}`); }
}
function sumPct(stage) { return stage.holders.reduce((s, h) => s + h.pct, 0); }

// T1: canonical YC example — $500k post-money SAFE at $10M cap = 5%
let r = simulate({
  founders: [{ name: 'A', pct: 100 }], earlyPoolPct: 0,
  events: [
    { type: 'safe', name: 'SAFE', amount: 500000, cap: 10000000, capType: 'post', discount: 0 },
    { type: 'priced', name: 'Seed', amount: 2000000, preMoney: 8000000, poolPct: 0 },
  ],
  exitValue: 100000000, prefsEnabled: true,
});
let seed = r.stages[r.stages.length - 1];
const safeH = seed.holders.find(h => h.label === 'SAFE');
const invH = seed.holders.find(h => h.label === 'Seed');
const fH = seed.holders.find(h => h.label === 'A');
// SAFE = 5% pre-new-money, then diluted by investor 20% => 4%
eq('T1 safe pct', safeH.pct, 0.05 * 0.8);
eq('T1 investor pct', invH.pct, 2 / 10);
eq('T1 founder pct', fH.pct, 0.95 * 0.8);
eq('T1 sums to 1', sumPct(seed), 1);

// T2: stacked post-money SAFEs additive: 10% + 10% = 20% pre-round
r = simulate({
  founders: [{ name: 'A', pct: 60 }, { name: 'B', pct: 40 }], earlyPoolPct: 0,
  events: [
    { type: 'safe', name: 'S1', amount: 1000000, cap: 10000000, capType: 'post', discount: 0 },
    { type: 'safe', name: 'S2', amount: 2000000, cap: 20000000, capType: 'post', discount: 0 },
    { type: 'priced', name: 'A round', amount: 5000000, preMoney: 20000000, poolPct: 10 },
  ],
  exitValue: 0, prefsEnabled: true,
});
let st = r.stages[r.stages.length - 1];
const inv = 5 / 25; // 20%
eq('T2 investor', st.holders.find(h => h.label === 'A round').pct, inv);
eq('T2 pool', st.holders.find(h => h.id === 'POOL').pct, 0.10);
// safes: 10% + 10% = 20% of pre-money company; founders+safes share 70% residual
// pre: founders 80% of pre-co, safes 20%. residual = 1 - .2 - .1 = .7
eq('T2 S1', st.holders.find(h => h.label === 'S1').pct, 0.10 / 1.0 * 0.7);
eq('T2 founders A', st.holders.find(h => h.label === 'A').pct, 0.6 * 0.8 * 0.7);
eq('T2 sums to 1', sumPct(st), 1);

// T3: discount beats cap: $1M SAFE, cap $50M post, 20% discount, round pre-money $10M
// capPct = 1/50 = 2%; discPct = 1 / (0.8*10) = 12.5% -> wins
r = simulate({
  founders: [{ name: 'A', pct: 100 }], earlyPoolPct: 0,
  events: [
    { type: 'safe', name: 'S', amount: 1000000, cap: 50000000, capType: 'post', discount: 20 },
    { type: 'priced', name: 'Seed', amount: 1000000, preMoney: 10000000, poolPct: 0 },
  ],
  exitValue: 0,
});
st = r.stages[r.stages.length - 1];
eq('T3 discount wins', st.holders.find(h => h.label === 'S').pct, 0.125 * (1 - 1 / 11));

// T4: exit waterfall — low exit, investor takes preference
r = simulate({
  founders: [{ name: 'A', pct: 100 }], earlyPoolPct: 0,
  events: [{ type: 'priced', name: 'Seed', amount: 5000000, preMoney: 5000000, poolPct: 0 }],
  exitValue: 8000000, prefsEnabled: true,
});
// investor owns 50%, as-converted = $4M < $5M pref -> takes $5M, founder gets $3M
let rows = r.exit.rows;
eq('T4 inv payout', rows.find(x => x.label === 'Seed').payout, 5000000, 1);
eq('T4 founder payout', rows.find(x => x.label === 'A').payout, 3000000, 1);

// T5: high exit — investor converts
r = simulate({
  founders: [{ name: 'A', pct: 100 }], earlyPoolPct: 0,
  events: [{ type: 'priced', name: 'Seed', amount: 5000000, preMoney: 5000000, poolPct: 0 }],
  exitValue: 100000000, prefsEnabled: true,
});
rows = r.exit.rows;
eq('T5 inv payout', rows.find(x => x.label === 'Seed').payout, 50000000, 1);
eq('T5 founder payout', rows.find(x => x.label === 'A').payout, 50000000, 1);

// T6: payouts always sum to exit value (with mixed pref decisions)
r = simulate({
  founders: [{ name: 'A', pct: 70 }, { name: 'B', pct: 30 }], earlyPoolPct: 10,
  events: [
    { type: 'safe', name: 'S1', amount: 750000, cap: 8000000, capType: 'post', discount: 0 },
    { type: 'priced', name: 'Seed', amount: 3000000, preMoney: 12000000, poolPct: 10 },
    { type: 'priced', name: 'Series A', amount: 12000000, preMoney: 40000000, poolPct: 12 },
  ],
  exitValue: 30000000, prefsEnabled: true,
});
const total = r.exit.rows.reduce((s, x) => s + x.payout, 0);
eq('T6 payout conservation', total, 30000000, 1);
eq('T6 cap table sums', sumPct(r.stages[r.stages.length - 1]), 1);

// T7: pre-money cap SAFE: $1M at $9M pre-money cap, only safe: 1/(9+1)=10%
r = simulate({
  founders: [{ name: 'A', pct: 100 }], earlyPoolPct: 0,
  events: [
    { type: 'safe', name: 'S', amount: 1000000, cap: 9000000, capType: 'pre', discount: 0 },
    { type: 'priced', name: 'Seed', amount: 1, preMoney: 100000000, poolPct: 0 },
  ],
  exitValue: 0,
});
st = r.stages[r.stages.length - 1];
eq('T7 pre-money cap', st.holders.find(h => h.label === 'S').pct, 0.1, 1e-6);

// T8: unconverted SAFE warning
r = simulate({
  founders: [{ name: 'A', pct: 100 }], earlyPoolPct: 0,
  events: [{ type: 'safe', name: 'S', amount: 1000000, cap: 9000000, capType: 'post', discount: 0 }],
  exitValue: 10000000,
});
eq('T8 warning emitted', r.warnings.length >= 1 ? 1 : 0, 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
