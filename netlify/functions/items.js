// Netlify Function: GET /.netlify/functions/items
// Returns the dashboard rows as JSON. Swap the file read for a database
// or API call later without changing the front end.
const fs = require("fs");
const path = require("path");

const ALLOWED_STATUS = ["Not started", "In progress", "Blocked", "Done"];

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  try {
    const file = path.join(__dirname, "..", "..", "data", "items.json");
    const rows = JSON.parse(fs.readFileSync(file, "utf8"));

    // Optional server-side filter: ?status=Blocked
    const status = event.queryStringParameters?.status;
    const result = status && ALLOWED_STATUS.includes(status)
      ? rows.filter((r) => r.status === status)
      : rows;

    return json(200, { count: result.length, items: result });
  } catch (err) {
    console.error(err);
    return json(500, { error: "Could not load items" });
  }
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(body),
  };
}
