# Design documents

Every module is designed before it's built, then implemented, reviewed and tested by agents in `.claude/agents/`:

```
requirements ─► planner: HLD ─► user approves ─► planner: LLD ─► user approves
                                                                     │
           /build-module <module>                                    ▼
           software-engineer: code + unit/integration tests + PR ◄──────────┐
                 │  ▲                                                       │
   questions ────┘  └──── planner amends LLD (and HLD if it conflicts)      │ fixes
                 ▼                                                          │
           code-reviewer: LLD conformance, correctness, test coverage ──────┤
                 ▼                                                          │
           qa: runs the app; browser happy path + unhappy scenarios ────────┘
                 ▼
           user reviews and merges the PR
```

1. **HLD** (`<module>/hld.md`): the big decisions, i.e. tables, screens, protocols and integrations. Written by the `planner` agent from business requirements.
2. **LLD** (`<module>/lld.md`): the implementation contract, i.e. exact schemas, API contracts, service logic, tests and an ordered task list. Written by the `planner` once the HLD is approved.
3. **Build**: `/build-module <module>` runs `software-engineer` → `code-reviewer` → `qa`, looping back to the engineer on findings.

Each document has a `status` in its front matter: `draft` → `in-review` → `approved`. Only a person approves a document. An LLD may not be started until its HLD is `approved`, and implementation may not start until the LLD is `approved`. Revising an approved document after review bumps its version and sends it back to `draft`.

The exception is **amendments during implementation**. When the engineer, reviewer or QA hits a case the LLD doesn't define, the planner defines it in place: an `A-n` row in the LLD's *Amendments* table, plus an HLD update if the answer conflicts with the HLD. Approval stands, and implementation carries on. Amendments are listed in the PR description for the user to review, with those marked *needs user confirmation* first.

Templates are in [`_templates/`](./_templates).

## Index

| Module | HLD | LLD |
| ------ | --- | --- |
