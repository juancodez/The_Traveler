#!/usr/bin/env node
// MCP server exposing The Traveler flight search as tools.
// Reuses lib/flights.js so the logic matches the Netlify function exactly.
// Reads TRAVELPAYOUTS_API_TOKEN from env; without it, rows come back without
// auto prices (same behaviour as the web function).

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const { buildFlights, cheapestRow, ParamError } = require("../lib/flights.js");

const here = dirname(fileURLToPath(import.meta.url));

function loadManualData() {
  try {
    const file = join(here, "..", "data", "flights.json");
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return { estimate: null, prices: {} };
  }
}

const paramsSchema = {
  type: "object",
  properties: {
    origin: {
      type: "string",
      description: "3-letter IATA origin code (e.g. BER). Case-insensitive.",
      pattern: "^[A-Za-z]{3}$",
    },
    dest: {
      type: "string",
      description: "3-letter IATA destination code (e.g. BUE). Case-insensitive.",
      pattern: "^[A-Za-z]{3}$",
    },
    month: {
      type: "string",
      description: "Departure month, YYYY-MM (e.g. 2027-04).",
      pattern: "^\\d{4}-(0[1-9]|1[0-2])$",
    },
    nights: {
      type: "integer",
      description: "Stay length in nights (1-60).",
      minimum: 1,
      maximum: 60,
    },
  },
  required: ["origin", "dest", "month", "nights"],
};

const TOOLS = [
  {
    name: "search_flights",
    description:
      "Build one round-trip row per departure day of a given month. Each row carries the cheapest cached Aviasales fare for that date (when TRAVELPAYOUTS_API_TOKEN is set), plus Kayak and Google Flights search links. Rows with a mismatched stay length are flagged with stayMatch:false.",
    inputSchema: paramsSchema,
  },
  {
    name: "cheapest_date",
    description:
      "Return the single cheapest departure date for a month-long search, ignoring fares whose stay length does not match the request. Returns null price when no priced match exists.",
    inputSchema: paramsSchema,
  },
];

const server = new Server(
  { name: "the-traveler", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;

  try {
    if (name === "search_flights") {
      const result = await buildFlights(args, { manualData: loadManualData() });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
    if (name === "cheapest_date") {
      const result = await buildFlights(args, { manualData: loadManualData() });
      const best = cheapestRow(result);
      const payload = best
        ? {
            ...best,
            source: best.source,
            summary: `€${Math.round(best.price)} on ${best.weekday} ${best.departure}, back ${best.return}` +
              (best.airline ? `, ${best.airline}` : "") +
              (best.transfers != null ? `, ${best.transfers} stop${best.transfers === 1 ? "" : "s"}` : ""),
            apiFares: result.apiFares,
            apiMatchedDays: result.apiMatchedDays,
            autoPrices: result.autoPrices,
          }
        : {
            price: null,
            summary: "No priced dates with matching stay length.",
            apiFares: result.apiFares,
            apiMatchedDays: result.apiMatchedDays,
            autoPrices: result.autoPrices,
          };
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      };
    }
    return {
      isError: true,
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
    };
  } catch (err) {
    const msg = err instanceof ParamError ? err.message : String(err?.message || err);
    return {
      isError: true,
      content: [{ type: "text", text: msg }],
    };
  }
});

await server.connect(new StdioServerTransport());
