---
doc: project-brief
version: 0.1
updated: 2026-10-04
---

# Budmon: Project Brief

Source: the user's initial description, kept verbatim in [`notes/2026-10-04-initial-idea.md`](./notes/2026-10-04-initial-idea.md).

## Changelog

| Version | Date | Change |
| ------- | ---- | ------ |
| 0.1     | 2026-10-04 | Initial draft (interview round 1) |

## 1. The problem

Managing a budget means recording every payment, transfer, cash withdrawal and refund. That much data entry is frustrating. People either spend long sessions catching up on it or stop doing it altogether, and then the budget no longer reflects reality.

Most of the information they would type in already exists. Banks, payment gateways and vendors send an email or SMS for nearly every card or online payment. That information is spread across inboxes and phones, though, and often comes as several messages about the same payment (one from the bank, one from the vendor, a few minutes apart). Each message uses a different name for the same merchant ("AMZN Mktp", "Amazon.eg", "Amazon"). Cash is the opposite case: once withdrawn, it leaves no trail at all unless the person records it.

Some things that matter to people are also badly served by typical budgeting tools:

- money they've lent or borrowed, and when it's due back;
- refunds and returns, linked back to the original purchase;
- mixed purchases (one order containing food and electronics) that belong to different purposes;
- how much they spend on optional extras such as tips, which matters especially outside the US, where tipping is optional.

**How people cope today:** manual entry in a budgeting app or spreadsheet, catching up in occasional bulk sessions, or giving up. [NEEDS INPUT: Which tools have you, or the people you're building this for, actually used and abandoned, and why? This fills section 7.]

## 2. Target users

**Primary:** an individual who wants an accurate picture of their own money but won't keep up with manual entry. They pay mostly by card and online, receive bank and vendor notifications by email and/or SMS, and also handle some cash. They care about privacy and want control over what the app reads.

**Secondary:** people this individual shares money with: a partner or family member on a shared account, or a friend they lend money to or borrow from who also uses Budmon.

[NEEDS INPUT: Is Budmon a product for the public (anyone can sign up), for you and a small invited group, or for you alone at first? This changes security, compliance (Gmail access in particular, see Risks), hosting and onboarding. See question 1.]

[NEEDS INPUT: Which country or countries, and which banks, are the first users in? Bank message formats, SMS vs email habits, currencies and tipping norms all depend on it.]

## 3. The product in one paragraph

Budmon is a personal budgeting and money-monitoring app (backend, web app and mobile app first, desktop later) that removes most of the data entry from budgeting. It covers the essentials: accounts of every kind (bank, online wallet, cash), shared accounts, transactions with payees, purposes, tags and splits, transfers, refunds, and debts and loans between people. On top of that, it can read the user's transaction notifications from email (Gmail first) and SMS and turn them into transactions. The user decides which senders and messages it may read, and whether that's done by user-defined templates or by AI. Bank messages are treated as the source of truth, and vendor messages add detail. The user then confirms the results in a fast review flow instead of typing them in. Where automation can't help (cash, forgotten entries), the app reminds them, based on when they last recorded something and on their preferences.

## 4. Goals and success measures

Goals the user has stated:

1. **Make data entry cheap.** Reviewing captured transactions replaces typing them.
2. **Respect privacy and boundaries.** Every automated feature has a manual alternative, and AI is never used without the user opting in.
3. **Cover the essential budgeting features** well enough that the app is useful even with no automation turned on.

Proposed measures, all pending your confirmation. [NEEDS INPUT: confirm, change or replace these, and give target numbers.]

| Measure | Proposed target |
| ------- | --------------- |
| Share of card/online transactions that reach the review queue without manual entry, for connected sources | [NEEDS INPUT: target %] |
| Median time to review one captured transaction | [NEEDS INPUT: e.g. under 5 seconds] |
| Captured transactions accepted without any edit (extraction accuracy) | [NEEDS INPUT: target %] |
| Duplicate transactions created from multiple messages about one payment | [NEEDS INPUT: e.g. under 1%] |
| Days the user goes without the ledger being up to date | [NEEDS INPUT] |
| Personal: "I've used it for my own money for N consecutive months and my balances match my bank" | [NEEDS INPUT: N] |

## 5. Scope

The split between first version and later below is **the analyst's recommendation, pending your decision** (question 3). The spec summary's MVP cut gives the per-module detail.

### 5.1 In the first version (recommended)

- Platforms: backend, web app and mobile app (decided).
- User sign-up, sign-in, profile and preferences (currency, time zone).
- Accounts: bank, online wallet, cash, other. Shared accounts with other Budmon users.
- Payees, including the many names one payee appears under in messages.
- Purposes (categories) and tags, with defaults (for example "subscription", "tip") and custom ones.
- Transactions: income and expense, payee, account, purpose, tags, notes, splits; transfers between accounts; refunds linked to the original purchase. Tips recorded as a split with the "tip" purpose or tag.
- Debts and loans: recorded against someone who isn't a Budmon user, with a due date and check-in reminders.
- Reminders to record data, based on the last entry and the user's preferences, with a specific prompt after a cash withdrawal.
- Automated capture, stage 1: connect Gmail; scan-scope rules (allowlist, denylist, everything); sender setup done manually; template-based extraction for the main message types (debit, credit, card payment, cash withdrawal); merging several messages about one payment; payee name taken from the message by default; review queue.
- Basic reports, including spending by purpose and by tag (for example total tips). [NEEDS INPUT: which reports you need on day one.]

### 5.2 Later (recommended)

- SMS capture. On Android this is technically possible; on iOS, apps can't read SMS (see Risks).
- AI-assisted setup and extraction: an LLM, or smaller models, to identify transactional senders, extract fields, and suggest payees and purposes.
- Automatic categorisation (purpose suggestions from all available information).
- Loans with other Budmon users, including the acceptance flow.
- Subscription detection.
- Email providers other than Gmail.
- Desktop (Electron) app based on the web app (decided as "later").
- Budgets with limits per purpose and period. [NEEDS INPUT: see question 2. Budgets may belong in the first version.]

### 5.3 Never (explicit non-goals)

[NEEDS INPUT: confirm or change these proposed non-goals.]

- Moving money: Budmon records and monitors, it never initiates payments or transfers at a bank.
- Investment and portfolio tracking (stocks, crypto valuations). Proposed non-goal, to confirm.
- Tax preparation and business accounting.
- Reading messages outside the scope the user has allowed, even when the OS or email permission would technically allow it.

## 6. Constraints

- **Platforms (decided):** backend, web app and mobile app first; an Electron desktop app based on the web app later.
- **Architecture (stated preference):** the backend is mainly a monolith, with the option of splitting out a few services if needed. This is recorded as the user's preference. The design itself belongs to the planner.
- **Privacy (decided):** every automation has a manual alternative. AI use is opt-in, because users may opt out of automation for privacy reasons. The app reads only what the user's scan-scope rules allow.
- **Third-party access rules:**
  - Gmail read access is a Google "restricted scope". A public app needs Google verification and an annual third-party security assessment. Personal or testing use is limited to a small number of named test users.
  - iOS doesn't let apps read SMS. Android allows it, but Google Play restricts apps that request SMS permissions.
- **Budget, timeline, hosting, regulations:** [NEEDS INPUT: Is there a deadline, a hosting budget, or an LLM usage budget? Any data-residency or financial regulation to respect in your country?]

## 7. Alternatives

[NEEDS INPUT: Which apps do you know or have you tried (for example YNAB, Monarch, Wallet by BudgetBakers, Money Manager, Spendee, local bank apps, spreadsheets)? Which bank-connection services exist in your country? Pointers are enough; the analyst will write this section up.]

What Budmon intends to do differently, from your description:

- It captures transactions from the notifications people already receive, instead of relying on bank-API aggregators (often unavailable outside the US and EU) or on manual entry.
- The user controls exactly which messages are read, and whether AI is involved.
- Debts and loans are first-class, including between two Budmon users.
- Refunds are linked to purchases, and splits work at the line-item level.

## 8. Risks

| Risk | Why it matters | Mitigation to consider |
| ---- | -------------- | ---------------------- |
| Gmail restricted-scope verification | A public launch that reads Gmail needs Google verification plus a yearly security assessment (cost and time). | Start invite-only or in testing mode; also support forwarding emails to a Budmon address, which needs no Gmail scope. |
| No SMS access on iOS | The "most important" platform can't read SMS on iPhone. | Android-only SMS capture; on iOS, rely on email, or on the user forwarding or sharing a message into the app. |
| Google Play SMS permission policy | Apps that read SMS must qualify for an exception or may be rejected from the store. | Check policy eligibility early; consider sideloaded or notification-listener approaches. |
| Extraction accuracy | Wrong amounts or duplicate transactions destroy trust faster than missing ones. | Bank message is the source of truth; nothing posts without review until the user trusts a template; strict duplicate merging. |
| Sensitive data | Email and SMS content plus financial data make an attractive target. | Store as little raw message content as possible, encrypt, define retention, make AI opt-in, let users delete everything. |
| LLM cost and privacy | Sending message contents to a third-party LLM costs money and moves data off the platform. | Templates first; LLM opt-in only; send only messages already in scope. |
| Scope size | Core ledger, debts, sharing and automation are each large. | Staged MVP (see spec summary build order). |

## 9. Assumptions

These are inferred, not stated. Each is to be confirmed.

- A1. "Purpose" means what most apps call a category, and each transaction or split line has exactly one purpose.
- A2. Budmon records money; it never moves money at a bank.
- A3. The first user is you, and the product should still be built so that others can sign up.
- A4. "System one models" means small, fast, specialised models (classifiers or extractors) as an alternative to large LLMs. Which one is used is a design decision for later. The product requirement is only that "templates only" must work without any AI.
- A5. "Budget management" includes setting limits (budgets) per purpose and period, even though the description doesn't detail them.
