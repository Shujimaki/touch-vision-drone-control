# Instructions for project agents

## Before you start

Read the document that owns the information needed for the task:

| Task | Document and role |
|---|---|
| Build, configure, run, or test the software | [README.md](README.md) owns the software overview, implementation plan, setup, usage, and testing guidance. |
| Interpret or change thesis behavior, evaluation, or scope | [CONTEXT.md](CONTEXT.md) owns requirements, targets, accepted decisions, unresolved questions, glossary, and thesis sources. |
| Change the messages between the tablet and the host | [protocol/README.md](protocol/README.md) owns the message fields, units, limits, and examples. |
| Change agent procedures | This file owns shared project procedures, evidence rules, and delivery checks. |
| Apply personal communication or writing preferences | Read `.local/AGENTS.personal.md` if it exists. It owns local preferences and personal skill references. |

Personal preferences supplement shared rules. Project requirements and higher-priority instructions still apply.

## Project changes

- Prefer simple, feasible implementations that preserve the accepted behavior in CONTEXT.md.
- Use the glossary terms consistently.
- Preserve unrelated files, repository history, and configuration. Keep local research, personal preferences, and generated output in their existing ignored locations.
- Keep application code, tests, dependency definitions, lockfiles, and example configuration eligible for Git tracking.
- Preserve proposal exports. If the user requests proposal edits, change only the requested content.
- If a diagram helps explain the design, use Mermaid and the glossary terms. Render it with the Mermaid tool when available.

## Documentation and evidence

- Keep thesis requirements, decisions, and their sources in CONTEXT.md. Preserve its requirement, target, decision, and open-question labels.
- Keep the source baseline, review date, source differences, and review limits with the review in CONTEXT.md.
- Keep software architecture, dependencies, installation, usage, and testing guidance in README.md. Distinguish planned features from implemented and tested behavior.
- Keep each requirement or decision in its owning document. Link to it instead of copying a second definition.
- When a thesis decision changes implementation, update its record in CONTEXT.md and the affected software guidance in README.md.
- Keep personal writing conventions and skill paths in `.local/AGENTS.personal.md`. Keep shared project procedures in this file.
- Use the evidence labels defined in CONTEXT.md to distinguish requirements, decisions, recommendations, interpretations, unknowns, and results.
- Cite behavior requirements and numerical targets with physical PDF pages or document section headings.
- For software compatibility and version claims, check official documentation and release records. Record research dates and source URLs beside recommendations.
- Use numbered source links and a References section for research claims. Include source names and dates.
- If sources conflict, record the conflict and recommend a resolution. Preserve accepted behavior until the project decides otherwise.
- Describe hardware compatibility or measured performance only when project test evidence supports the claim. A published release alone provides neither.

## Before delivery

Run checks appropriate to the change. Check every changed requirement, target, decision, and source link against its supporting material.
Check that each changed section fits its document’s role and that cross-document links still resolve.
Report the changes, check results, and any unavailable tools or incomplete checks.
