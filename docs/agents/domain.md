# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

This repo is single-context with a hybrid layout. CONTEXT.md holds the thesis background. GLOSSARY.md and `docs/adr/` hold the terms and decisions that come up during the build.

## Before exploring, read these, in this order

1. **`CONTEXT.md`** at the repo root: thesis background. It owns requirements, targets, accepted thesis decisions (DEC and REC labels), unresolved questions, and the proposal glossary under "Shared glossary". Parts may lag behind the build.
2. **`GLOSSARY.md`** at the repo root: terms that come up during the build. It links to a CONTEXT.md term instead of redefining it.
3. **`docs/adr/`**: implementation decisions made during the build. Read ADRs that touch the area you're about to work in.

If GLOSSARY.md or `docs/adr/` doesn't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## Which document gets a new record

- **Changes thesis behavior, evaluation, scope, or a numerical target**: a DEC record in CONTEXT.md. Ask the user first, and follow the evidence rules in AGENTS.md. An ADR may link to the DEC record but never replaces it.
- **An implementation choice inside accepted thesis behavior**: an ADR in `docs/adr/`.
- **A new build-time term**: GLOSSARY.md. If CONTEXT.md already defines the term, link to it there.

## File structure

```
/
├── CONTEXT.md        ← thesis requirements, DEC records, proposal glossary
├── GLOSSARY.md       ← build-time terms
├── docs/adr/
│   └── 0001-<decision>.md
└── src/
```

## Use the glossary's vocabulary

Your output may name a domain concept, for example in an issue title, a refactor proposal, a hypothesis, or a test name. Use the term as CONTEXT.md's "Shared glossary" or GLOSSARY.md defines it. Don't drift to synonyms either glossary explicitly avoids.

If neither glossary has the concept you need, stop and check. Either you're inventing language the project doesn't use, so reconsider, or there's a real gap. Note a real gap for `/domain-modeling`.

## Flag conflicts with CONTEXT.md or an ADR

If your output contradicts CONTEXT.md or an existing ADR, surface it explicitly and propose an update to whichever record is stale. Never override either one silently:

> _Contradicts ADR-0003 (host-side altitude targets), but worth reopening because…_

> _CONTEXT.md DEC-11 still says the hardware review is pending. Propose updating it._
