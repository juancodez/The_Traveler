# The Traveler

Netlify site with serverless functions.

```
index.html                      # Flights dashboard (Berlin to Buenos Aires, round trip)
projects.html                   # Simple projects dashboard
data/flights.json               # Verified prices by departure date + typical estimate
data/items.json                 # Sample data for projects.html
netlify/functions/flights.js    # GET /.netlify/functions/flights?origin=BER&dest=BUE&month=2027-04&nights=13
netlify/functions/items.js      # GET /.netlify/functions/items
netlify.toml                    # Build settings; included_files bundles the data files
```

## How the flights page works
- One row per departure day of the chosen month, with the return date after the chosen number of nights.
- Prices are **not live**. Use the Kayak / Google Flights buttons, then type the price you see. The cheapest date is highlighted. Typed prices are stored in your browser only.
- To share prices across devices, add them to `data/flights.json` under `prices` (key = departure date, value = EUR) and push.

## Run locally
```bash
npx netlify-cli dev
```

## Next steps
- Plug a flight-price API into `flights.js` (set the key as a Netlify environment variable, never in the repo) to fill `price` automatically.
- Add an MCP server under `mcp/` that exposes the same data as tools.
