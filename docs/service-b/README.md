# Service B integration with Service A

The default `SERVICE_B_API=contract` connects Service A (`http://service-a:3001`) and Service B (`http://service-b:3002`) on the `habittracker` Docker network. Set `SERVICE_B_URL=http://service-b:3002` in A and `HABITS_SERVICE_URL=http://service-a:3001` in B. Both services use the gateway's `INTERNAL_TOKEN`. [Teeba's streaks-service repository](https://github.com/Teeba-Alani/streaks-service)

Calls in either direction use `X-Internal-Token`, `X-User-Id`, `X-User-Timezone`, and `X-Request-Id`. The `userId` query parameter matches `X-User-Id` and uses UUID v4. B can also send `X-User-Week-Starts-On` to A for due-date requests.

| Direction | Route | Purpose |
|---|---|---|
| A → B | `GET /internal/checkins?userId=&from=&to=` | Fetch check-in dates for weekly targets. Returns an array or `{data: [...]}` containing `habitId` and `date`. |
| A → B | `DELETE /internal/habits/:habitId?userId=` | Clean up check-ins and missed notes after a habit is deleted. Returns `204` and can safely be repeated. |
| B → A | `GET /internal/habits?userId=&ids=&includeArchived=` | List owned habits as `{data: [...]}`. `ids` and `includeArchived` are optional. |
| B → A | `GET /internal/habits/due?userId=&date=` | List due habits as `{data: [...]}` for the user's local date. |
| B → A | `GET /internal/habits/:id?userId=` | Fetch one owned habit. |

All three contract habit reads include `startDate`, the habit's first local day, and `pausedPeriods`, an array of paused or archived spans. Each span is `{from, to}`. Both dates are inclusive, `to: null` marks an open span, and a pause that starts and ends on the same day is omitted. B uses these fields to compute historical streaks without counting inactive days as missed.

When serving the check-in history used for weekly targets, B reads its own check-ins directly to avoid calling A's due endpoint recursively. For older deployments that use the cache and `X-Service-Key` protocol, opt in with `SERVICE_B_API=legacy` and configure `SERVICE_B_KEY` and `LEGACY_INBOUND_KEY`.
