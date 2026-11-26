// GET /.netlify/functions/flights?origin=BER&dest=BUE&month=2027-04&nights=13
// Thin HTTP wrapper over lib/flights.js. Core logic lives in the lib so the MCP
// server can reuse it.
const fs = require("fs");
const path = require("path");
const { buildFlights, ParamError } = require("../../lib/flights.js");

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return json(405, { error: "Method not allowed" });

  let manualData = { estimate: null, prices: {} };
  try {
    const file = path.join(__dirname, "..", "..", "data", "flights.json");
    manualData = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    console.error("flights.json not readable", err);
  }

  try {
    const result = await buildFlights(event.queryStringParameters || {}, { manualData });
    return json(200, result, result.autoPrices === "ok" ? "public, max-age=900" : "no-store");
  } catch (err) {
    if (err instanceof ParamError) return json(400, { error: err.message });
    console.error("buildFlights failed", err);
    return json(500, { error: "Internal error" });
  }
};

function json(statusCode, body, cache = "no-store") {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", "Cache-Control": cache },
    body: JSON.stringify(body),
  };
}
