---
doc: project-brief
version: 0.2
updated: 2026-10-04
---

# Budmon: Project Brief

Sources: the user's initial description ([`notes/2026-10-04-initial-idea.md`](./notes/2026-10-04-initial-idea.md)) and their round 2 answers ([`notes/2026-10-04-round-2-answers.md`](./notes/2026-10-04-round-2-answers.md), cited below as R2-Qn).

## Changelog

| Version | Date | Change |
| ------- | ---- | ------ |
| 0.1     | 2026-10-04 | Initial draft (interview round 1) |
| 0.2     | 2026-10-04 | Round 2 answers folded in. The MVP now includes Gmail capture and review (R2-Q3). Budgets are a core MVP feature with a flexible, nested, overlapping model (R2-Q2). Native Android comes first (R2-Q3). Sharing is per account with admin, member and viewer roles (R2-Q4). Accounts are multi-currency, with daily exchange rates (R2-Q5). Raw messages aren't kept after processing (R2-Q7). AI rolls out in three stages: a third-party service, then Budmon-hosted, then the user's own endpoint (R2-Q7). |

## 1. The problem

Managing a budget means recording every payment, transfer, cash withdrawal and refund. That much data entry is frustrating. People either spend long sessions catching up on it or stop doing it altogether, and then the budget no longer reflects reality.

Most of the information they would type in already exists. Banks, payment gateways and vendors send an email or SMS for nearly every card or online payment. That information is spread across inboxes and phones, though, and often comes as several messages about the same payment (one from the bank, one from the vendor, a few minutes apart). Each message uses a different name for the same merchant ("AMZN Mktp", "Amazon.eg", "Amazon"). Cash is the opposite case: once withdrawn, it leaves no trail at all unless the person records it.

Some things that matter to people are also badly served by typical budgeting tools:

- money lent or borrowed, and when it's due back;
- refunds linked back to the original purchase;
- mixed purchases that belong to different purposes;
- the cost of optional extras such as tips, which matters especially outside the US;
- money shared within a household, such as a common "house money" cash pot (R2-Q4);
- budgets that reflect how a person actually thinks: overlapping, nested, and set as amounts or percentages (R2-Q2).

**How people cope today:** manual entry in a budgeting app or spreadsheet, catching up in occasional bulk sessions, or giving up. [NEEDS INPUT: Which tools have you, or the people you're building this for, actually used and abandoned, and why? This fills section 7.]

## 2. Target users

**Primary:** an individual who wants an accurate picture of their own money but won't keep up with manual entry. They pay mostly by card and online, receive bank and vendor notifications by email and/or SMS, and also handle some cash. They care about privacy and want control over what the app reads and what is kept.

**Secondary:** the people they share money with. Housemates or family members share accounts such as "house money" (R2-Q4). Someone who has moved out keeps view-only access. Friends lend or borrow money and may also use Budmon.

**Geography:** not limited to one country or set of banks. Templates are built per user for whatever banks they use, so the product must not depend on a hard-coded bank list (R2-Q5).

[NEEDS INPUT: Is Budmon a product for the public (anyone can sign up), for you and a small invited group, or for you alone at first? This changes security, compliance (Gmail access in particular, see Risks), hosting and onboarding. Re-asked as question 1.]

## 3. The product in one paragraph

Budmon is a personal and household budgeting app that removes most of the data entry from budgeting. It runs on a backend with a web app and a native Android app first; other platforms, including desktop, come later. It covers the essentials:

- accounts in any currency, shared within a household through roles;
- transactions with payees, purposes, tags and splits;
- transfers (including across currencies, with fees), refunds, and debts;
- flexible budgets that can overlap, nest, and be set as amounts or percentages.

On top of that, it reads the user's transaction notifications from email (Gmail first) and SMS, and turns them into transactions straight away. Bank messages are the source of truth and vendor messages add detail. Captured transactions count immediately, flagged until the user reviews them. Each review teaches Budmon (which sender names belong to which payee, and which purpose a payee usually means), so over time payees the user trusts are confirmed automatically. The user decides which messages may be read and whether AI is used. Raw messages are never kept after processing. Reminders cover what automation can't see, such as cash.

## 4. Goals and success measures

Goals the user has stated:

1. **Make data entry cheap.** Captured data is useful straight away, without any action from the user, and review refines it (R2-Q6).
2. **Respect privacy and boundaries.** Every automated feature has a manual alternative. AI is opt-in. Raw messages aren't stored after processing, and that is a headline commitment of the privacy policy (R2-Q7).
3. **Cover the essential budgeting features**, including budgets as complex as the user wants (R2-Q2).

Proposed measures, all pending your confirmation. [NEEDS INPUT: confirm, change or replace these, and give target numbers.]

| Measure | Proposed target |
| ------- | --------------- |
| Share of card/online transactions captured without manual entry, for connected sources | [NEEDS INPUT: target %] |
| Median time to review one captured transaction | [NEEDS INPUT: e.g. under 5 seconds] |
| Captured transactions confirmed without any edit (extraction accuracy) | [NEEDS INPUT: target %] |
| Share of captured transactions auto-confirmed (single-purpose known payees) after 3 months of use | [NEEDS INPUT: target %] |
| Duplicate transactions created from multiple messages about one payment | [NEEDS INPUT: e.g. under 1%] |
| Personal: "I've used it for my own money for N consecutive months and my balances match my bank" | [NEEDS INPUT: N] |

## 5. Scope

### 5.1 In the first version (decided: the MVP reaches "stage B", R2-Q3)

- Platforms: backend, web app and a **native Android app** (R2-Q3).
- Users, sign-in, profile and preferences.
- Accounts of every type, each in its own currency (R2-Q5).
- Shared accounts with admin, member and viewer roles (R2-Q4). Sharing being in the first version is inferred from the household example (assumption A11).
- Purposes and tags, payees and payee aliases, and single-purpose/multi-purpose payees (R2-Q6).
- Transactions, splits, transfers, cross-currency transfers with fees and the actual rate applied (R2-Q5), refunds, and tips.
- Debts recorded against people who aren't Budmon users.
- Budgets: conditions combining purposes and tags (including exclusions), fixed amounts or percentages, nesting, overlap, and custom periods (R2-Q2).
- Reports.
- Reminders.
- Gmail capture: scan scope, manual sender setup, templates built per user, merging, payee resolution, a review queue, a reviewed/unreviewed filter, and auto-confirmation for known single-purpose payees (R2-Q6).
- [NEEDS INPUT: Are SMS capture on Android and AI-assisted capture in the first version too? Question 2.]

### 5.2 Later

- iOS and other platforms ("try to cover more as we go", R2-Q3). A desktop (Electron) app based on the web app.
- AI hosted by Budmon, then AI through an endpoint the user hosts (R2-Q7).
- Exchange rates updated more often than daily (R2-Q5).
- Finer control over what each viewer of a shared account can see (R2-Q4: "develop that more a little bit later").
- Loans between Budmon users with an acceptance flow.
- Subscription detection.
- Email providers other than Gmail.

### 5.3 Never (explicit non-goals)

[NEEDS INPUT: confirm or change these proposed non-goals.]

- Moving money: Budmon records and monitors, it never initiates payments or transfers at a bank.
- Investment and portfolio tracking. Proposed non-goal, to confirm.
- Tax preparation and business accounting.
- Reading messages outside the user's scan scope.
- (Decided, R2-Q7) Keeping raw message or email content after processing, unless the user has explicitly opted in to share it to help improve the app.
- (Decided, R2-Q5) A hard-coded list of supported banks.

## 6. Constraints

- **Platforms (decided):** backend, web app and native Android first; more platforms and Electron later.
- **Architecture (stated preference):** the backend is mainly a monolith, with services split out only if needed. The design itself belongs to the planner.
- **Privacy (decided):**
  - Every automation has a manual alternative, and AI is opt-in.
  - Only in-scope messages are read.
  - Raw messages are discarded after processing; only templates and extracted data are kept (R2-Q7).
  - An opt-in, not-promoted setting lets users donate raw messages to improve the app (R2-Q7).
- **AI provider rollout (decided, R2-Q7):** a third-party LLM service first, then a Budmon-hosted model, then an endpoint the user hosts.
- **Exchange rates (decided, R2-Q5):** fetched by the backend daily, more often later.
- **Third-party access rules:**
  - Gmail read access is a Google "restricted scope". A public app needs Google verification and an annual third-party security assessment.
  - Google Play restricts apps that request SMS permissions.
- **Budget, timeline, hosting, regulations:** [NEEDS INPUT: Is there a deadline, a hosting budget, or an AI usage budget? Any data-residency or financial regulation to respect?]

## 7. Alternatives

[NEEDS INPUT: Which apps do you know or have you tried (for example YNAB, Monarch, Wallet by BudgetBakers, Money Manager, Spendee, local bank apps, spreadsheets)? Pointers are enough; the analyst will write this section up.]

What Budmon intends to do differently, from your description:

- It captures transactions from notifications people already receive, for any bank, instead of relying on bank-API aggregators or manual entry.
- Captured data is useful immediately, and review refines it instead of gating it.
- Raw messages aren't kept. The user controls exactly what's read and whether AI is involved.
- Budgets can overlap, nest and be set as percentages.
- Household sharing works through account roles.
- Debts, refunds and splits are first-class.

## 8. Risks

| Risk | Why it matters | Mitigation to consider |
| ---- | -------------- | ---------------------- |
| Gmail restricted-scope verification | A public app that reads Gmail needs Google verification plus a yearly security assessment (cost and time). | Start invite-only or in testing mode; also support forwarding emails to a Budmon address. Depends on question 1. |
| Google Play SMS permission policy | Apps that read SMS must qualify for an exception or may be rejected from the store. | Check eligibility early; distribute outside the Play Store during the invite phase; use a notification-listener or share-into-app fallback. |
| Unreviewed data counts straight away | A wrong captured amount distorts balances and budgets until it's reviewed. | Clear "needs review" flags, filters, and a review nudge; bank message is the source of truth. |
| Auto-confirmation errors | A single-purpose payee that starts selling other things gets mis-classified silently. | New payees are never auto-confirmed; the user can switch a payee back to multi-purpose at any time (R2-Q6); auto-confirmed items stay identifiable. |
| No raw-message retention | Changing a template can't be re-applied to past messages from stored data, and users can't see the original text in Budmon. | Keep a reference to the message (for example the Gmail message ID) so it can be re-fetched from the source or opened there (assumption A12). |
| Budget model complexity | Overlapping, nested and percentage budgets with custom periods are much bigger than "a limit per category". | Settle the semantics (questions 3 and 4) before design; the planner may slice the module. |
| Third-party AI and privacy | Message content leaves Budmon when the user opts into AI. | Opt-in only, in-scope messages only, provider disclosed; Budmon-hosted model and user-hosted endpoint later (R2-Q7). |
| Scope size | Every MVP module is substantial, and the MVP includes automated capture. | Strict build order; Stage C items stay out. |

## 9. Assumptions

Inferred, not stated. Each is to be confirmed. The full list is in section 8 of the spec summary.

- A1. "Purpose" means what most apps call a category; each transaction or split line has exactly one purpose.
- A3. Budmon records money; it never moves money at a bank.
- A4. "System one models" means small, specialised models as an alternative to LLMs. The "templates only" path must work with no AI.
- A11. Shared accounts are in the first version (inferred from the household example in R2-Q4).
- A12. Budmon keeps a reference to each source message (an ID, not its content), so the user can open the original in Gmail or on the phone.
