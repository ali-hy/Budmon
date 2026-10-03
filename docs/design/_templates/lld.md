---
module: <module-name>
doc: lld
status: draft # draft | in-review | approved
version: 0.1
hld_version: <approved HLD version this LLD implements>
author: planner
approved_by:
approved_on:
---

# <Module name>: Low-Level Design

Implements [HLD](./hld.md) v<x.y>.

## Changelog

| Version | Date | Change |
| ------- | ---- | ------ |
| 0.1     |      | Initial draft |

## 1. Deviations from the HLD
<!-- "None", or each deviation with its reason. Each one must be accepted by the reviewer. -->

## 2. File plan

| File | Create / modify | Responsibility |
| ---- | --------------- | -------------- |

## 3. Database

### 3.1 Table definitions
<!-- Exact Drizzle definitions: types, nullability, defaults, unique and check constraints,
     indexes, foreign keys with onDelete. -->

### 3.2 Changes to existing tables

### 3.3 Migration and seed data

## 4. API contract
<!-- Repeat per endpoint/procedure. -->

### <METHOD /path> or <trpc.procedure>
- **Transport:** REST / tRPC query / tRPC mutation / …
- **Auth:**
- **Request (zod):**
- **Response:**
- **Errors:**

| Error key | Status | When |
| --------- | ------ | ---- |

## 5. Service logic
<!-- Per function: signature, validation, algorithm, transaction boundary, authorization
     checks, edge cases. -->

## 6. Error catalog

| Class | Key | Status | Thrown when |
| ----- | --- | ------ | ----------- |

## 7. Integrations
<!-- Payloads, auth, retries/backoff, idempotency, timeouts, schedules. "None" if not applicable. -->

## 8. Frontend
<!-- Routes, components, state and data fetching, form validation, error display.
     "None" if not applicable. -->

## 9. Test plan

| ID | Target | Case | Expected |
| -- | ------ | ---- | -------- |

## 10. Implementation tasks
<!-- Ordered. Each task: small, independently verifiable, with acceptance criteria. -->

- [ ] **T-1: <title>**
  - Depends on: none
  - Acceptance criteria:

## 11. Open questions
<!-- Must be empty before approval. -->
