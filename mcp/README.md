# The Traveler — MCP server

Stdio MCP server that exposes the same flight-search logic as the Netlify function.
Lives next to the site so there is one source of truth: both import from
`../lib/flights.js`.

## Tools

| Tool | Args | Returns |
|---|---|---|
| `search_flights` | `origin`, `dest`, `month` (YYYY-MM), `nights` (1–60) | One row per departure day of the month: `price`, `source`, `stayNights`, `stayMatch`, `airline`, `transfers`, `kayak` & `google` search URLs, plus run-level `autoPrices`, `apiFares`, `apiMatchedDays`. |
| `cheapest_date` | same | The single cheapest date whose stay length matches the request (`stayMatch:false` fares are ignored), with a short summary line. |

## Install

```bash
cd mcp
npm install
```

## Register with Claude Code

Pick a scope (`user`, `project`, or `local`) and point it at the server file.
Pass the Travelpayouts token via `--env` so the server can fetch auto prices.

```bash
claude mcp add the-traveler \
  --scope user \
  --env TRAVELPAYOUTS_API_TOKEN=your-token-here \
  -- node C:/Users/tn/The_Traveler/mcp/server.js
```

Without the env var the server still runs — rows just come back without
`price` and `autoPrices` is `"no_token"`, same as the web function.

Check it registered:

```bash
claude mcp list
```

Then in a Claude Code session: ask something like
*"Use the-traveler to find the cheapest BER→BUE date in April 2027 for 13 nights."*

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "the-traveler": {
      "command": "node",
      "args": ["C:/Users/tn/The_Traveler/mcp/server.js"],
      "env": { "TRAVELPAYOUTS_API_TOKEN": "your-token-here" }
    }
  }
}
```

## Smoke test without a client

```bash
# From repo root, with token set
TRAVELPAYOUTS_API_TOKEN=xxx node -e "require('./lib/flights.js').buildFlights({origin:'BER',dest:'BUE',month:'2027-04',nights:13}).then(r=>console.log(JSON.stringify({auto:r.autoPrices,fares:r.apiFares,matched:r.apiMatchedDays,best:r.rows.find(x=>x.price)},null,2)))"
```

Or on Windows PowerShell:

```powershell
$env:TRAVELPAYOUTS_API_TOKEN="xxx"; node -e "require('./lib/flights.js').buildFlights({origin:'BER',dest:'BUE',month:'2027-04',nights:13}).then(r=>console.log(JSON.stringify({auto:r.autoPrices,fares:r.apiFares,matched:r.apiMatchedDays,best:r.rows.find(x=>x.price)},null,2)))"
```
