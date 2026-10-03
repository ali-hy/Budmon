# Design documents

Every module is designed before it's built:

1. **HLD** (`<module>/hld.md`): the big decisions, i.e. tables, screens, protocols and integrations. Written by the `planner` agent from business requirements.
2. **LLD** (`<module>/lld.md`): the implementation contract, i.e. exact schemas, API contracts, service logic, tests and an ordered task list. Written by the `planner` agent once the HLD is approved.
3. **Implementation**: the software engineer agent builds from the approved LLD.

Each document has a `status` in its front matter: `draft` → `in-review` → `approved`. Only a person approves a document. An LLD may not be started until its HLD is `approved`, and implementation may not start until the LLD is `approved`. Revising an approved document bumps its version and sends it back to `draft`.

Templates are in [`_templates/`](./_templates).

## Index

| Module | HLD | LLD |
| ------ | --- | --- |
