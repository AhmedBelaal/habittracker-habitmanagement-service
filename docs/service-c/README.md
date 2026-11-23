# Service C integration with Service A

On the `habittracker` Docker network, use `http://service-c:3003` (or `http://time-service:3003`) for Time Management. Set `SERVICE_C_URL` in Service A and point Service C's `HABITS_SERVICE_URL` at `http://service-a:3001`. Service C accepts public routes with or without the `/api` prefix. [Adam's integration guide](https://github.com/adam246898/adam246898-Backend-TimeManagment-Service/blob/main/docs/INTEGRATION.md)

Service C uses a 3-second timeout by default. Every user-scoped call is expected to send `X-Internal-Token`, `X-Request-Id`, `X-User-Id`, `X-User-Timezone`, and `X-User-Week-Starts-On`, plus a matching `userId` in the query. Service C's background Google reminder and first-sync jobs omit the week-start header today, so Service A uses Sunday. The stats call sends the internal token and request ID without user context.

| Service A call | Result |
|---|---|
| `GET /internal/habits?userId=&ids=&includeArchived=` | `{data: Habit[]}`. Optional `ids` are comma-separated UUID v4s. |
| `GET /internal/habits/due?userId=&date=` | `{data: Habit[]}` for a local date. |
| `GET /internal/habits/:id/inactive-periods?userId=` | `{data: [{from, until}]}`. `until` is exclusive or `null`. |
| `GET /internal/stats?range=30d` (or `90d`) | `{range, habitsByCategory: [{category, count}]}`. |

Service A sends `POST /internal/reminders` with `{userId, habitId, action}`. Service C immediately returns `202` for each valid, authenticated request and processes the work asynchronously. An `upsert` for a deleted habit is treated as cleanup. A `delete` can safely be repeated.
