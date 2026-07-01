# Agent Market (prototype)

A client-side prototype of an AI agents marketplace — searchable registry of
agent manifests with trust scores, permission-risk badges, and transparent
pricing. No backend; everything runs in your browser.

Read **[DESIGN.md](DESIGN.md)** for the full design: what an agent listing is
(a signed manifest), the three hard problems (trust, discovery, economics) and
how each is handled, the target architecture, and the build sequencing.

## Run locally

Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server
```

## Tests

```sh
node test.js
```

## Files

| File | What it is |
|---|---|
| `DESIGN.md` | The design: trust model, ranking, economics, architecture |
| `engine.js` | Pure mechanics: manifest validation, Bayesian trust scoring, relevance×trust ranking, fee settlement |
| `registry.js` | Seed registry of agent manifests (data stand-in for the registry API) |
| `index.html` | Browse/search UI + agent detail + manifest validator (publish flow) |
| `test.js` | Unit tests over the mechanics |
