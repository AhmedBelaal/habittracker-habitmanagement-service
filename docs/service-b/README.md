# Service B integration with Service A

Service A owns the habit definition. Service B owns check-ins, missed notes, streaks and challenge scores. They communicate by HTTP on the private Docker network. A is `http://habits-service:3001` and B is `http://streaks-service:3002` in the group contract. Use the actual B port if your current container differs.

## Connect the current Service B implementation

The Service B README specifies `x-service-key`, a habit cache, and two fallback routes. These settings connect A to that version of B.

| Service A | Matching Service B value |
|---|---|
| `SERVICE_B_API=legacy` | Enables the protocol in the Service B README. |
| `SERVICE_B_URL=http://streaks-service:3002` | B's HTTP origin. |
| `SERVICE_B_KEY` | B's `INTERNAL_API_KEY`, used by A when calling B. |
| `LEGACY_INBOUND_KEY` | B's `SERVICE_A_API_KEY`, used by B when calling A. |

Set B's `SERVICE_A_URL` (or its equivalent A base-URL setting) to `http://habits-service:3001`. Set the values for A in its ignored `.env` and rerun its Floci setup. Hop credentials are distinct from the gateway credentials forwarded for public routes.

| Direction | Route | Payload |
|---|---|---|
| A → B | `PUT /internal/habits/:habitId` | Upsert the cached habit when A saves it. |
| A → B | `DELETE /internal/habits/:habitId` | Remove the cache entry, check-ins and missed notes. Return `204`; retries must be safe. |
| B → A | `GET /internal/habits/:habitId` | The legacy habit object below, or `404`. |
| B → A | `GET /internal/users/:userId/habits` | `{ "habits": [{ "habitId": "...", ...legacyFields }] }`. Includes archived entries so B can reconcile the cache. |
| A → B | `GET /internal/users/:userId/check-ins?from=&to=` | `{ "checkInsByDate": { "2026-11-20": ["habit-uuid"] } }`. A uses this to check weekly targets. |

```json
{
  "userId": "00477938-6e0f-454e-9435-4c0f4e74a333",
  "title": "Read before bed",
  "habitType": "weekly",
  "scheduleDays": [1, 3, 5],
  "startDate": "2026-11-23",
  "endDate": null,
  "isArchived": false
}
```

Weekdays are numeric (`0` = Sunday). Challenges use `habitType: "challenge"` and the contract deadline as `endDate`. An archived habit remains in B's cache with `isArchived: true`. A normal `times_per_week` habit is represented as `daily` in the legacy cache because the README payload has no target field. It likewise has no field for paused dates. B needs the full habit and scheduling routes below to respect those features on its own checklist and in historical streaks. Avoid treating a pause as a delete because that would remove history.

## Connect B using the team API contract

After B supports the team contract, set `SERVICE_B_API=contract`. A stops sending cache `PUT`s and uses `X-Internal-Token`, `X-User-Id`, `X-User-Timezone` and `X-Request-Id` for internal calls. A and B use the same trusted token as the gateway. When a route takes `userId` in its query, send the same user ID in the header. Include the user's week-start preference in `X-User-Week-Starts-On` on calls to A when available.

- B calls `GET /internal/habits/due?userId=&date=` for `{data: Habit[]}` when building the daily checklist. For a check-in, B can use `GET /internal/habits/:id?userId=` to verify ownership and challenge dates, then verify due status for the check-in date.
- B can call `GET /internal/habits/:id/inactive-periods?userId=` for `{data: [{from, until}]}` to skip paused or archived periods when recomputing historical streaks. `from` is inclusive and `until` is exclusive or `null` for an open period. The endpoint requires contract authentication.
- A calls `GET /internal/checkins?userId=&from=&to=` for the user's check-ins during the week before the requested day. Return check-ins as a JSON array or `{data: CheckIn[]}` with at least `habitId` and `date`. Include all rows in that internal date range. Do not call A's due endpoint when serving this history read, or the requests will depend on each other.
- A calls `DELETE /internal/habits/:habitId?userId=` for cleanup. The handler should return `204` even if another delivery already completed cleanup.

The gateway contract uses `/api/checklists` and `/api/checkins`. The Service B README currently uses `/api/checklist` and a `PUT` completion flow. Coordinate the B upgrade and public routing with the gateway and frontend owners.
