// Shared flights logic. Pure(ish): no HTTP, no file I/O. Callers pass manualData.
// Used by netlify/functions/flights.js and mcp/server.js so there is one source of truth.

const DEFAULTS = { origin: "BER", dest: "BUE", month: "2027-04", nights: 13 };

class ParamError extends Error {
  constructor(message) {
    super(message);
    this.name = "ParamError";
  }
}

function normalizeParams(input = {}) {
  const origin = (input.origin || DEFAULTS.origin).toString().toUpperCase();
  const dest = (input.dest || DEFAULTS.dest).toString().toUpperCase();
  const month = input.month || DEFAULTS.month;
  const nights = input.nights != null ? Number(input.nights) : DEFAULTS.nights;

  if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(dest)) {
    throw new ParamError("origin and dest must be 3-letter airport or city codes");
  }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new ParamError("month must look like 2027-04");
  }
  if (!Number.isInteger(nights) || nights < 1 || nights > 60) {
    throw new ParamError("nights must be a whole number from 1 to 60");
  }

  return { origin, dest, month, nights };
}

async function buildFlights(input, opts = {}) {
  const { origin, dest, month, nights } = normalizeParams(input);
  const manualData = opts.manualData || { estimate: null, prices: {} };
  const token = opts.token ?? (process.env.TRAVELPAYOUTS_API_TOKEN || process.env.TRAVELPAYOUTS_TOKEN);

  const api = await fetchApiPrices({ origin, dest, month, nights, token });

  const [year, mon] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const rows = [];

  for (let day = 1; day <= daysInMonth; day++) {
    const dep = new Date(Date.UTC(year, mon - 1, day));
    const ret = new Date(dep.getTime() + nights * 86400000);
    const depStr = iso(dep);
    const retStr = iso(ret);
    const manual = manualData.prices && Number.isFinite(manualData.prices[depStr]) ? manualData.prices[depStr] : null;
    const auto = api.byDate[depStr] || null;
    const price = manual != null ? manual : auto ? auto.price : null;

    rows.push({
      departure: depStr,
      weekday: dep.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" }),
      return: retStr,
      price,
      source: manual != null ? "file" : auto ? "api" : null,
      stayNights: auto ? auto.stayNights : null,
      apiReturn: auto ? auto.returnDate : null,
      stayMatch: manual != null ? true : auto ? auto.stayMatch : null,
      airline: auto ? auto.airline : null,
      transfers: auto ? auto.transfers : null,
      kayak: `https://www.kayak.de/flights/${origin}-${dest}/${depStr}/${retStr}?sort=price_a`,
      google: `https://www.google.com/travel/flights?q=${encodeURIComponent(
        `Flights from ${origin} to ${dest} on ${depStr} through ${retStr}`)}`,
    });
  }

  return {
    origin, dest, month, nights,
    estimate: manualData.estimate || null,
    autoPrices: api.status,
    autoPricesMessage: api.message || null,
    apiFares: api.fares ?? null,
    apiMatchedDays: api.matchedDays ?? null,
    count: rows.length,
    rows,
  };
}

function cheapestRow(result) {
  const withPrice = result.rows.filter((r) => r.price != null && r.stayMatch !== false);
  if (!withPrice.length) return null;
  return withPrice.reduce((a, b) => (b.price < a.price ? b : a));
}

// Cheapest cached round-trip ticket per departure day, from the Aviasales Data API.
// Stays within +/-2 nights of the requested length are preferred; otherwise the
// cheapest fare at any stay is kept as a labelled fallback.
async function fetchApiPrices({ origin, dest, month, nights, token }) {
  if (!token) return { status: "no_token", byDate: {} };

  try {
    const [y, m] = month.split("-").map(Number);
    const next = new Date(Date.UTC(y, m, 1));
    const returnMonth = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`;
    const url = new URL("https://api.travelpayouts.com/aviasales/v3/prices_for_dates");
    url.search = new URLSearchParams({
      origin, destination: dest, departure_at: month, return_at: returnMonth,
      one_way: "false", sorting: "price", currency: "eur", limit: "1000", token,
    }).toString();

    const res = await fetch(url, { headers: { "X-Access-Token": token }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error("API returned HTTP " + res.status);
    const body = await res.json();
    const list = Array.isArray(body.data) ? body.data : [];

    const close = {};
    const any = {};
    for (const t of list) {
      if (!t.departure_at || !t.return_at || !Number.isFinite(Number(t.price))) continue;
      const dep = String(t.departure_at).slice(0, 10);
      const stay = Math.round((Date.parse(String(t.return_at).slice(0, 10)) - Date.parse(dep)) / 86400000);
      if (!(stay > 0)) continue;
      const fare = {
        price: Number(t.price),
        returnDate: String(t.return_at).slice(0, 10),
        stayNights: stay,
        stayMatch: Math.abs(stay - nights) <= 2,
        airline: t.airline || null,
        transfers: t.transfers ?? null,
      };
      const bucket = fare.stayMatch ? close : any;
      if (!bucket[dep] || fare.price < bucket[dep].price) bucket[dep] = fare;
    }
    const byDate = { ...any, ...close };
    const matched = Object.keys(close).length;
    // stderr so MCP stdio stays clean; Netlify treats both streams as logs.
    console.error(`price API: ${list.length} fares returned, ${matched} days with ~${nights}-night stays, ` +
      `${Object.keys(byDate).length - matched} days with other stays`);
    return { status: "ok", byDate, fares: list.length, matchedDays: matched };
  } catch (err) {
    console.error("price API failed", err);
    return { status: "error", message: "Automatic prices unavailable right now.", byDate: {} };
  }
}

function iso(d) {
  return d.toISOString().slice(0, 10);
}

module.exports = { buildFlights, cheapestRow, normalizeParams, ParamError, DEFAULTS };
