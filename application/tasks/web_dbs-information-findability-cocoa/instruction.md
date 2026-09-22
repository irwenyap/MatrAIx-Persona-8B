# Find information on DBS Personal Banking

Start at `https://www.dbs.com.sg/personal/default.page` and, in one browser session, investigate these goals in exactly this order:

1. Current fixed-deposit interest rates.
2. A DBS credit card suitable for earning travel rewards or miles.
3. DBS home-loan information.
4. Banking rates and fees information.
5. How to make an overseas transfer.
6. Where to get help with an account.
7. DBS deposit-account options.
8. How to get started with investing through DBS.

Navigate naturally using visible menus, links, DBS search, and backtracking as you see fit. Read the current public information; do not assume a fixed rate, product, or page title. Stay on public DBS or DBS-hosted help pages. Do not log in, start or submit an application, make a transaction, send a message, request contact, accept an offer, or perform any other state-changing action.

Save objective evidence to `/app/output/dbs_information_findability.json`. It must contain:

- `start_url`, `start_title`, and an ISO-8601 `completed_at` timestamp.
- `steps`: exactly eight records, in the order above, with IDs `fixed_deposit_rates`, `travel_rewards_card`, `home_loans`, `rates_and_fees`, `overseas_transfer`, `account_help`, `deposit_accounts`, and `investing_getting_started`.
- Each step must contain `id`, boolean `found`, `answer`, `final_url`, `final_title`, `navigation_path`, integer `meaningful_action_count`, boolean `used_site_search`, boolean `used_backtracking`, and `backtracking_details`.
- Every `navigation_path` entry must contain an increasing integer `sequence`, a visible `action`, the resulting `url`, and resulting `title`. Sequence numbers may either restart at `1` for each step or remain contiguous across the full session; use one convention consistently. Record user-intent actions only: page/major-view changes, opening or closing navigation used to select a destination, submitting DBS search, or deliberate backtracking. Do not count passive waits or reading scrolls.
- `totals` containing `meaningful_actions`, `steps_using_site_search`, and `steps_using_backtracking`, derived from the step records.

For a goal you cannot find, set `found` to `false`, keep `answer` empty, and record what happened in the navigation evidence. Do not invent an answer.

Afterward, complete the persona reflection described by `input/self_report_schema.yaml` and save it as `/app/output/user_feedback.json`. Keep expectations, confidence, perceived friction, and completion judgments only in that reflection—not in the objective artifact.
