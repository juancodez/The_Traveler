// GET /.netlify/functions/flights?origin=BER&dest=BUE&month=2027-04&nights=13
// Builds one round-trip row per departure day of the month, with live-search
// links (Kayak, Google Flights) and any verified price from data/flights.json.
// To use a real flight-price API later, fill `price` for each row here.
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

  const [year, mon] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const rows = [];

  for (let day = 1; day <= daysInMonth; day++) {
    const dep = new Date(Date.UTC(year, mon - 1, day));
    const ret = new Date(dep.getTime() + nights * 86400000);
    const depStr = iso(dep);
    const retStr = iso(ret);
    const price = data.prices && Number.isFinite(data.prices[depStr]) ? data.prices[depStr] : null;

    rows.push({
      departure: depStr,
      weekday: dep.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" }),
      return: retStr,
      price,
      kayak: `https://www.kayak.de/flights/${origin}-${dest}/${depStr}/${retStr}?sort=price_a`,
      google: `https://www.google.com/travel/flights?q=${encodeURIComponent(
        `Flights from ${origin} to ${dest} on ${depStr} through ${retStr}`)}`,
    });
  }

  return json(200, { origin, dest, month, nights, estimate: data.estimate || null, count: rows.length, rows });
};

function iso(d) {
  return d.toISOString().slice(0, 10);
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(body),
  };
}
