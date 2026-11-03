# Phases — Code Spark 2026 Tech Plan

Today: **Mon 2 Nov 2026** · Event: **Thu 12 Nov 2026**

## Phase 0 — Decisions and freeze (Mon 2 – Tue 3 Nov)
- [ ] Freeze rules: team size, AI/prebuilt-code policy, submission format (repo + 3-min demo video + 5 slides)
- [ ] Freeze rubric and tie-breakers (see `prd.md`)
- [ ] Confirm number of judges, stations, volunteers
- [ ] Get a college network admin; plan Wi-Fi capacity for ~400+ devices; arrange backup hotspot
- [ ] Set up Discord/WhatsApp group and the registration Sheet as source of intake

**Exit:** written rules doc shared with the team; judge list confirmed.

## Phase 1 — Registration, QR and check-in (Wed 4 – Thu 5 Nov)
- [ ] Supabase project, schema, RLS
- [ ] CSV import with dedupe; payment-verified flag
- [ ] QR generation and email passes
- [ ] Volunteer scanner (check-in + meals) with duplicate detection
- [ ] Admin dashboard counters

**Exit:** 10 test teams go from import to scanned entry and meal with no errors.

## Phase 2 — Submissions and judging (Fri 6 – Sun 8 Nov)
- [ ] Submission form with deadline enforcement and public-repo/commit checks
- [ ] Judge login, assignment algorithm, conflict handling
- [ ] Score form with rubric; IndexedDB offline queue and batch sync
- [ ] Admin judging progress view and outlier flags

**Exit:** dry run with 3 judges and 20 fake teams; all scores land correctly after simulated offline period.

## Phase 3 — Results and polish (Mon 9 Nov)
- [ ] Ranking logic, tie-breakers, finalist round weighting
- [ ] Publish toggle, public leaderboard, per-team score feedback page
- [ ] CSV export and backup script
- [ ] Participant page: schedule, rules, QR, submission

**Exit:** full end-to-end rehearsal with 60 seeded teams, results verified by hand on a sample.

## Phase 4 — Hardening and logistics (Tue 10 – Wed 11 Nov)
- [ ] Load test scan and score endpoints; test on real phones on college Wi-Fi
- [ ] Upgrade Supabase plan for backups; export a dry-run backup
- [ ] Print: QR badges, team lists, table numbers, judge sheets, runbook
- [ ] Volunteer and judge briefing (rubric, how to scan, how to score offline)
- [ ] Extension boards and power for every row; confirm food counts and veg/vegan/allergy options
- [ ] Freeze code; no new features after Wed evening

**Exit:** runbook printed; go/no-go checklist signed off.

## Event day — Thu 12 Nov
| Time | Tech tasks |
|---|---|
| 07:30 | Setup, network test, scanner devices charged, dashboard open |
| 08:30–09:30 | Check-in desks (2–3 volunteers), tech desk staffed |
| 09:20–09:40 | Show rules, AI policy, rubric, submission steps on screen |
| 09:40 | Hacking starts; repo timestamps begin |
| 10:00 | CSV backup |
| 13:00 / 16:30 | Meal scanning (lunch / snacks) |
| 15:00 | Optional rolling submission checkpoint |
| 15:00 | CSV backup |
| 17:30 | Hard submission cutoff |
| 17:30–18:15 | Screening round; track judging progress live |
| 18:15 | Finalists announced |
| 18:15–19:30 | Finalist presentations; judges score on app |
| 19:30 | Dinner scan |
| 20:15–20:50 | Verify scores, review outliers and conflicts, compute ranks |
| 20:50 | Announce winners; publish results |

## Post-event (Fri 13 – Thu 19 Nov)
- [ ] Publish results and per-team score feedback
- [ ] Send feedback survey
- [ ] Pay prizes within one week and share confirmation
- [ ] Export data, archive or delete personal data per policy
- [ ] Retrospective and reusable template for next event

## Cut-line (if behind schedule, drop in this order)
1. Participant-facing portal and announcements page
2. Outlier alerts and fancy progress charts
3. GitHub commit-time check (replace with manual spot-check)
4. Auto-assignment (assign judges manually in a Sheet)
5. Custom scoring app → **fallback to locked Google Sheet, one tab per judge**

**Never cut:** QR check-in/meals, scoring with a fixed rubric, backups, printed fallbacks.

## Owners (fill in)
| Area | Owner |
|---|---|
| Tech lead / architecture | |
| Frontend and scanner | |
| Backend and DB | |
| Judging coordination | |
| Network/Wi-Fi | |
| Volunteers and desks | |
| Prizes and payouts | |
