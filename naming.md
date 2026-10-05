# Naming notes

## Decision: Where Did I Tap (WDIT)

The project is being renamed from **Budmon** to **Where Did I Tap**.

- **Domain:** wherediditap, bought on Cloudflare in Oct 2026. The TLD is
  assumed to be .com (about $10.50/yr); confirm.
- **Why:** it's a complete question that says what the app is for ("I tapped my
  card, where did the money go?"), no app or product uses the name, and the
  domain fits the $15/yr budget.
- **Short form:** WDIT. Only a few small IT firms use it (WDit Business
  Solutions in Saskatoon, Wdit Inc, wdit.com.cn), so it's safe for code and a
  compact logo.

### Branding rules

- Always write it as **WhereDidITap** (each word capitalised) in the logo,
  shared links, social handles and the App Store. In lowercase,
  "wherediditap" can be misread as "where did it ap". Domains ignore case, so
  `WhereDidITap.com` still works as a link.
- In prose, "Where Did I Tap" is fine.
- WDIT is the compact form for the icon, small spaces and code.

### Rename plan (not done yet)

| Where | From | To |
|---|---|---|
| `server/package.json` `name` | `budmon` | `wdit` |
| `compose.yaml` `POSTGRES_DB` | `budmon` | `wdit` |
| `code-bites.md` docker command | `budmon-postgres`, `POSTGRES_DB=budmon` | `wdit-postgres`, `POSTGRES_DB=wdit` |
| `server/src/errors/index.ts`, `server/src/auth/authErrors.ts` | `BudmonError` | `WditError` |
| `README.md` | — | Use "WhereDidITap" as the project name |

Leave the GitHub repo name (`ali-hy/Budmon`) alone for now; the owner can
rename it in GitHub settings, and GitHub redirects the old URL.

Note: the server connects using `DATABASE_URL` in `server/.env`. After the
rename, change the database name at the end of that URL from `budmon` to
`wdit` and recreate the Postgres container. Otherwise, keep pointing it at
the old `budmon` database until you're ready.

## Background

"Budmon" was dropped: budmon.com is taken, and the name collides with a Digimon
and an existing iOS uptime-monitoring app (budwk/budmon).

Budget: domain renewal of $15/year or less (.com is about $10.20–10.50 at
Cloudflare or Spaceship; .app is about $14.20; .uk is about $5.50).

## Other candidates considered

| Name | Notes |
|---|---|
| **HowSwipe** | howswipe.com available (user checked, Oct 2026), about $10.50/yr. No product with the exact name; "Swipe Budget" (iOS budgeting app) and several other Swipe apps exist. Grammar reads oddly and "swipe" implies cards (or dating apps). |
| **Where Does It Go** | Former favourite, on wheredoesitgo.app (about $14.20/yr). No money app uses it; city recycling tools (Seattle, Arlington, Toronto's wheredoesitgo.ca) share the phrase. Short display name: "Where'd It Go" or "WDIG". Also grab wheredoesitgo.com if it's free. Domain availability not yet confirmed. |
| Pennyfold | Liked early on. Close to "Penfold" (a UK pensions app). Domain not checked. |
| Budinator | No product found; budinator.com seemed unused. "Bud" reads as cannabis. Not liked. |

## Rejected (taken or in use)

Budmon, Cointally (crypto tax app; .com parked), Paytal (two fintechs),
Keepsum, Centwise, TallyUp, SpendLoop, BudgetNest, PurseKeep, Monthwise,
SpendBook, Fundwell, PennyPlanner / Penny, Budgero.

Too weird: Spendwren, Coinwren, Ledgerling.

## Word bank

**Money & coins:** cent, penny, nickel, dime, coin, cash, buck, dollar, pound,
mint, gold, silver, copper, change, tender, note, bill, fund, capital, sum,
dinar, dirham, riyal, lira, piastre, ducat, florin, sovereign, guinea, shilling,
groat, obol, drachma, denarius, sou, real, peso, rand, yen, krona

**Holding money:** wallet, purse, pouch, pocket, billfold, fold, clip, jar,
pot, piggy, kitty, till, safe, vault, chest, coffer, treasury, stash, nest,
hoard, reserve, cache, bank, box, tin, envelope, satchel, locker, keep

**Banking & accounting:** ledger, account, balance, book, journal, register,
statement, credit, debit, deposit, transfer, interest, yield, entry, column,
receipt, invoice, audit, reconcile, clearing, teller, cashier, bursar, purser,
steward, treasurer, comptroller, assay

**Counting & tracking:** tally, count, abacus, sum, total, add, figure,
measure, gauge, meter, track, trace, log, record, note, mark, notch, tick,
scale, weigh, chart, graph, pulse, monitor, watch, glance, lens, compass,
radar, beacon

**Planning & budgeting:** budget, plan, allot, allocate, portion, share,
split, slice, divide, ration, envelope, bucket, category, goal, target,
forecast, runway, horizon, month, cycle, season, period

**Saving & growth:** save, keep, spare, hold, grow, sprout, seed, acorn,
harvest, yield, bloom, nest egg, rainy day, thrift, frugal, lean, prudent,
steady, ample, plenty, surplus, margin

**Automation & flow:** auto, flow, stream, current, sync, pilot, autopilot,
engine, gear, cog, clockwork, routine, rhythm, loop, pipe, channel, sort,
route, rule, autopay, recur, schedule

**Spending:** spend, pay, outlay, expense, cost, price, purchase, swipe, tap,
checkout, tab, fare, fee, toll, tip

**Calm & control:** clear, calm, steady, even, level, anchor, keel, ballast,
balance, poise, compass, north, true, plain, simple

**Animals & mascots** (thrifty or collecting): squirrel, magpie, ant, beaver,
hamster, otter, owl, wren, sparrow, piggy, bee, crow

**Arabic & other languages** (often more available as names): mal (money),
qirsh (piastre), fils, dirham, dinar, khazna (treasury), kees (purse),
mizan (balance/scale), hisab (account/count), rasid (balance), tawfir (saving),
sunduq (box/fund); Latin: pecunia, arca (chest), ratio (account), census;
Japanese: okane (money), saifu (wallet); Spanish: cuenta, ahorro (saving),
bolsa (bag)

**Combination patterns:** word + fold / keep / wise / nest / jar / book / path /
ly / ify / hq / app (e.g. Pennyfold), two plain words (Copper Jar), or a real
word used sideways (Ballast, Keel, Mizan).
