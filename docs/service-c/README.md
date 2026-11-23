# Service C integration with Service A and B

Service C (Time Management) owns the dashboard, calendar, milestones, aggregate admin analytics and Google Calendar reminders. Inside the Docker network, use `http://habits-service:3001` for A and `http://streaks-service:3002` for B. The gateway routes the browser to C at `http://time-service:3003`.

## Read habit data from A

Send `X-Internal-Token`, the trusted `X-User-Id` on user-scoped routes, the user's `X-User-Timezone`, and `X-Request-Id`. The header and query user IDs must match. Pass `X-User-Week-Starts-On` when making due requests for a user with a saved preference. Use a three-second timeout on internal calls.

| Call | Use |
|---|---|
| `GET /internal/habits?userId=&ids=&includeArchived=` | `{data: Habit[]}` with names, categories, schedules and deadlines. `ids` is an optional comma-separated UUID list. `includeArchived` defaults to `false`. |
| `GET /internal/habits/:id?userId=` | Full Habit for that user, including a challenge's `startDate`, `deadline` and `state`. |
| `GET /internal/habits/due?userId=&date=` | `{data: Habit[]}` for one of the last seven days or today. For older calendar dates, use habit definitions and check-in history. |
| `GET /internal/habits/:id/inactive-periods?userId=` | `{data: [{from, until}]}` for skipping paused or archived dates in historical views. `until` is exclusive or `null`. |
| `GET /internal/stats?range=30d` (or `90d`) | `{range, habitsByCategory: [{category, count}]}` with no user IDs. |

## Read activity from B

The team contract provides `/internal/checkins?userId=&from=&to=`, `/internal/streaks?userId=`, `/internal/challenges?userId=` and `/internal/stats?range=`. Use B's check-ins, streaks and challenge results when computing milestones and progress. Handle a required dependency timeout as `503 SERVICE_UNAVAILABLE` under the team contract.

If B still follows its original README, use `x-service-key` with B's `INTERNAL_API_KEY`. Its compatible read routes are `/internal/users/:userId/streaks?timezone=` and `/internal/users/:userId/check-ins?from=&to=`. The check-in response is `{"checkInsByDate":{"2026-11-20":["habit-uuid"]}}`. Challenge, analytics and public endpoint shapes need to follow whichever B version C is connected to. Confirm the protocol before integrating those views.

## Receive reminder updates from A

Set `SERVICE_C_URL=http://time-service:3003` in A's `.env` and rerun the Floci setup. C should accept `POST /internal/reminders` with contract authentication and `{"userId":"...","habitId":"...","action":"upsert"}` or action `delete`.

- On `upsert`, fetch the habit from A and update the events for that user and habit. `reminderTime` is local `HH:mm` and the request includes `X-User-Timezone`. A challenge also has an all-day deadline event. Treat an already deleted habit as cleanup if an upsert reaches C after the deletion.
- On `delete`, remove matching events by user and habit ID. The habit may already be deleted or hidden in A. A sends this on deletion, pause, archive, or reminder removal when no deadline event remains.
- Return `202` even when the user has not connected Google Calendar. Use the same event identity on retries to avoid duplicates. A keeps habit writes successful while reminder delivery is pending.

C owns the Google OAuth flow and credentials. Keep its `/internal/*` routes off the gateway's public route table.
