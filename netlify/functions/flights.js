// GET /.netlify/functions/flights?origin=BER&dest=BUE&month=2027-04&nights=13
// Builds one round-trip row per departure day of the month, with live-search
// links (Kayak, Google Flights) and any verified price from data/flights.json.
// If TRAVELPAYOUTS_TOKEN is set (Netlify environment variable), cheapest cached
// round-trip prices from the Aviasales Data API fill in automatically. Otherwise,
// or if the API fails, rows come back without a price for manual entry.
const fs = require("fs");
const path = require("path");

const DEFAULTS = { origin: "BER", dest: "BUE", month: "2027-04", nights: 13 };

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return json(405, { error: "Method not allowed" });

  const q = event.queryStringParameters || {};
  const origin = (q.origin || DEFAULTS.origin).toUpperCase();
  const dest = (q.dest || DEFAULTS.dest).toUpperCase();
  const month = q.month || DEFAULTS.month;
  const nights = q.nights ? Number(q.nights) : DEFAULTS.nights;

  if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(dest)) {
    return json(400, { error: "origin and dest must be 3-letter airport or city codes" });
  }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return json(400, { error: "month must look like 2027-04" });
  }
  if (!Number.isInteger(nights) || nights < 1 || nights > 60) {
    return json(400, { error: "nights must be a whole number from 1 to 60" });
  }

  let data = { estimate: null, prices: {} };
  try {
    const file = path.join(__dirname, "..", "..", "data", "flights.json");
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    console.error("flights.json not readable", err);
  }

  const api = await fetchApiPrices({ origin, dest, month, nights });

  const [year, mon] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const rows = [];

  for (let day = 1; day <= daysInMonth; day++) {
    const dep = new Date(Date.UTC(year, mon - 1, day));
    const ret = new Date(dep.getTime() + nights * 86400000);
    const depStr = iso(dep);
    const retStr = iso(ret);
    const manual = data.prices && Number.isFinite(data.prices[depStr]) ? data.prices[depStr] : null;
    const auto = api.byDate[depStr] || null;
    const price = manual != null ? manual : auto ? auto.price : null;

    rows.push({
      departure: depStr,
      weekday: dep.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" }),
      return: retStr,
      price,
      source: manual != null ? "file" : auto ? "api" : null,
      stayNights: auto ? auto.stayNights : null,
      airline: auto ? auto.airline : null,
      transfers: auto ? auto.transfers : null,
      kayak: `https://www.kayak.de/flights/${origin}-${dest}/${depStr}/${retStr}?sort=price_a`,
      google: `https://www.google.com/travel/flights?q=${encodeURIComponent(
        `Flights from ${origin} to ${dest} on ${depStr} through ${retStr}`)}`,
    });
  }

  return json(200, {
    origin, dest, month, nights,
    estimate: data.estimate || null,
    autoPrices: api.status, // "ok" | "no_token" | "error"
    autoPricesMessage: api.message || null,
    count: rows.length,
    rows,
  }, api.status === "ok" ? "public, max-age=900" : "no-store");
};

// Cheapest cached round-trip ticket per departure day, from the Aviasales Data API.
// Matches stays within +/-2 nights of the requested length. Data is cached from
// recent user searches, so some days may have no price.
async function fetchApiPrices({ origin, dest, month, nights }) {
  const token = process.env.TRAVELPAYOUTS_TOKEN;
  if (!token) return { status: "no_token", byDate: {} };

  try {
    const [y, m] = month.split("-").map(Number);
    const next = new Date(Date.UTC(y, m, 1)); // month after departure month
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

    const byDate = {};
    for (const t of list) {
      if (!t.departure_at || !t.return_at || !Number.isFinite(Number(t.price))) continue;
      const dep = String(t.departure_at).slice(0, 10);
      const stay = Math.round((Date.parse(String(t.return_at).slice(0, 10)) - Date.parse(dep)) / 86400000);
      if (Math.abs(stay - nights) > 2) continue;
      const price = Number(t.price);
      if (!byDate[dep] || price < byDate[dep].price) {
        byDate[dep] = { price, stayNights: stay, airline: t.airline || null, transfers: t.transfers ?? null };
      }
    }
    return { status: "ok", byDate };
  } catch (err) {
    console.error("price API failed", err);
    return { status: "error", message: "Automatic prices unavailable right now.", byDate: {} };
  }
}

function iso(d) {
  return d.toISOString().slice(0, 10);
}

function json(statusCode, body, cache = "no-store") {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", "Cache-Control": cache },
    body: JSON.stringify(body),
  };
}
