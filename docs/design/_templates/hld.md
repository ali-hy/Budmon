---
module: <module-name>
doc: hld
status: draft # draft | in-review | approved
version: 0.1
author: planner
approved_by:
approved_on:
---

# <Module name>: High-Level Design

## Changelog

| Version | Date | Change |
| ------- | ---- | ------ |
| 0.1     |      | Initial draft |

## 1. Context and requirements

### 1.1 Business requirements
<!-- The requirements as given, restated clearly. Number them: R-1, R-2, ... -->

### 1.2 Goals

### 1.3 Non-goals

## 2. Actors and use cases
<!-- User stories: "As a <actor>, I want <action> so that <outcome>." Reference R-n. -->

## 3. Data model

### 3.1 Tables

| Table | New / changed | Purpose | Key columns | Relationships |
| ----- | ------------- | ------- | ----------- | ------------- |

### 3.2 Entity-relationship diagram

```mermaid
erDiagram
```

### 3.3 Data lifecycle
<!-- What happens on delete (cascade / soft delete / blocked)? History, audit, retention. -->

## 4. Screens

| Screen | Purpose | Key information | Key actions |
| ------ | ------- | --------------- | ----------- |

### 4.1 Navigation

```mermaid
flowchart LR
```

## 5. Interfaces, protocols and integrations
<!-- tRPC vs REST, real-time (WebSocket/SSE), background jobs, webhooks, file import/export,
     notifications, third-party APIs. Justify each choice and describe its failure modes. -->

## 6. Key flows

```mermaid
sequenceDiagram
```

## 7. Cross-cutting concerns

### 7.1 Authorization
### 7.2 Money and currency
### 7.3 Consistency and transactions
### 7.4 Time and time zones
### 7.5 Privacy and security
### 7.6 Scale, performance and observability

## 8. Decisions

### D-1: <title>
- **Options considered:**
- **Decision:**
- **Rationale:**

## 9. Risks

## 10. Assumptions

## 11. Open questions

## 12. Out of scope / future work
