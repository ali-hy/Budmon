---
name: build-module
description: Run the Budmon build pipeline for a module whose LLD is approved. The software-engineer agent implements and tests it and opens a PR, the code-reviewer agent reviews it against the LLD, and the qa agent tests it as a user would, looping back to the engineer until it's clean. Use when the user asks to build or implement a designed module. Usage: /build-module <module>
disable-model-invocation: true
---

# Build a module: `$ARGUMENTS`

You (the main conversation) orchestrate this pipeline. The agents do the work; you pass results between them and keep the user informed. Resume an agent with SendMessage when it should keep its context, such as the engineer fixing its own PR.

## 0. Preconditions

- `docs/design/$ARGUMENTS/lld.md` exists and has `status: approved`. If it doesn't, stop. Tell the user what's missing; the planner agent is the next step, not this pipeline.

## 1. Implement

Invoke the **software-engineer** agent: "Implement module `$ARGUMENTS` from its approved LLD, write and run the tests, commit, push and open a PR."

When it returns, tell the user, in a few lines: the PR link, the test results, and any amendments, with those marked *needs user confirmation* listed first.

## 2. Code review loop

1. Invoke the **code-reviewer** agent on the PR.
2. If the verdict is `changes-required`:
   - Send the **design gaps** to the **planner** agent as implementation-time amendments.
   - Send the **blocking** findings, plus the new amendment IDs, to the **software-engineer** agent to fix. Resume the same engineer agent if possible.
   - Re-run the code-reviewer. Repeat until the verdict is `approve`.
3. Non-blocking findings go to the engineer too, but they never hold up the pipeline.

## 3. QA loop

1. Invoke the **qa** agent on the PR.
2. If the verdict is `fail`: route design gaps to the planner and failures to the software-engineer (as above). Then, because the code changed, re-run the **code-reviewer** on the new commits, and re-run **qa**. QA re-runs the happy path plus the scenarios that failed.
3. Repeat until QA passes.

## Stop and ask the user when

- any loop has gone **3 rounds** without converging,
- the planner flags a decision as *needs user confirmation* and it affects the HLD's big decisions (tables, screens, protocols/integrations, money or authorization rules),
- an agent reports it is blocked (for example, no database available, or the app won't start).

## Done

Report to the user: the PR link, the final review and QA verdicts, the test results, and every amendment made to the LLD/HLD (with the ones needing confirmation first). The user reviews and merges the PR; no agent merges.
