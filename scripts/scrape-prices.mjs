#!/usr/bin/env node
// Scrape Google Flights for the cheapest round-trip price per departure day
// of ORIGIN -> DEST, MONTH, NIGHTS. Writes data/flights.json in place.
//
// Best-effort. Google blocks headless scrapers aggressively; some runs will
// return fewer prices than dates. Exits non-zero when results look broken so
// the GitHub Actions workflow can surface it.
//
// Run locally:
//   cd scripts && npm install && npx playwright install chromium
//   node scrape-prices.mjs
//   node scrape-prices.mjs --dates 2027-04-01,2027-04-02    # subset for debugging

import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ORIGIN = process.env.ORIGIN || "BER";
const DEST = process.env.DEST || "BUE";
const MONTH = process.env.MONTH || "2027-04";
const NIGHTS = Number(process.env.NIGHTS || 13);

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(here, "..", "data", "flights.json");

const DELAY_MIN_MS = 3000;
const DELAY_MAX_MS = 7000;
const PAGE_TIMEOUT_MS = 45000;
const PRICE_WAIT_MS = 20000;

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function pickSubset(allDates) {
  const idx = process.argv.indexOf("--dates");
  if (idx === -1) return allDates;
  const wanted = new Set((process.argv[idx + 1] || "").split(",").filter(Boolean));
  return allDates.filter((d) => wanted.has(d.departure));
}

function buildDates() {
  const [y, m] = MONTH.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const out = [];
  for (let d = 1; d <= days; d++) {
    const dep = new Date(Date.UTC(y, m - 1, d));
    const ret = new Date(dep.getTime() + NIGHTS * 86400000);
    out.push({ departure: iso(dep), return: iso(ret) });
  }
  return out;
}

function iso(d) {
  return d.toISOString().slice(0, 10);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function googleFlightsUrl(dep, ret) {
  const q = `Flights from ${ORIGIN} to ${DEST} on ${dep} through ${ret}`;
  return `https://www.google.com/travel/flights?q=${encodeURIComponent(q)}&curr=EUR&hl=en`;
}

// Google Flights renders prices in various structures. We hunt in multiple ways
// and take the cheapest plausible €-value we can find on the results page.
async function extractPrices(page) {
  // Strategy 1: aria-labels that contain a euro amount
  const fromAria = await page.$$eval("[aria-label]", (els) =>
    els
      .map((el) => el.getAttribute("aria-label") || "")
      .filter((s) => /€|EUR/.test(s))
  ).catch(() => []);

  // Strategy 2: visible text in elements that look like price buttons
  const fromText = await page.$$eval(
    "div, span, button",
    (els) =>
      els
        .map((el) => (el.innerText || "").trim())
        .filter((s) => s.length > 0 && s.length < 40 && /€|EUR/.test(s))
  ).catch(() => []);

  const all = [...fromAria, ...fromText];

  const prices = [];
  for (const s of all) {
    // Match €1,234 / €1.234 / 1,234 € / EUR 1234 etc. Allow thousand separators.
    const re = /(?:€|EUR)\s*([0-9][0-9.,\s]{1,8})|([0-9][0-9.,\s]{1,8})\s*(?:€|EUR)/g;
    let m;
    while ((m = re.exec(s)) !== null) {
      const raw = (m[1] || m[2] || "").replace(/\s/g, "");
      // Heuristic: strip thousand separators. In en/de both . and , can be either.
      // Round trips BER->BUE realistic range ~400-5000.
      const clean = raw.replace(/[.,](?=\d{3}\b)/g, "");
      const n = Number(clean.replace(",", "."));
      if (Number.isFinite(n) && n >= 200 && n <= 10000) prices.push(Math.round(n));
    }
  }

  if (!prices.length) return null;
  return Math.min(...prices);
}

async function scrapeOne(context, dep, ret) {
  const url = googleFlightsUrl(dep, ret);
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS });
    // Dismiss the consent dialog if Google asks
    await Promise.race([
      page.getByRole("button", { name: /accept all|reject all|accept|agree/i }).first().click({ timeout: 3000 }).catch(() => {}),
      sleep(3200),
    ]);
    // Wait until something that looks like a price shows up
    await page
      .waitForFunction(
        () => {
          const t = document.body.innerText || "";
          return /€\s*\d{2,}|EUR\s*\d{2,}|\d{2,}\s*€|\d{2,}\s*EUR/.test(t);
        },
        { timeout: PRICE_WAIT_MS }
      )
      .catch(() => {});
    const price = await extractPrices(page);
    return price;
  } finally {
    await page.close();
  }
}

async function main() {
  let data = { estimate: null, prices: {} };
  try {
    data = JSON.parse(await fs.readFile(DATA_PATH, "utf8"));
  } catch {}
  if (!data.prices) data.prices = {};

  const allDates = buildDates();
  const dates = pickSubset(allDates);

  console.log(`Scraping ${dates.length} dates for ${ORIGIN}->${DEST} ${MONTH} (${NIGHTS} nights)`);

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
  });
  const context = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1366, height: 820 },
    locale: "en-US",
    timezoneId: "Europe/Berlin",
  });

  let success = 0;
  const failed = [];

  for (const { departure, return: ret } of dates) {
    try {
      const price = await scrapeOne(context, departure, ret);
      if (price != null) {
        data.prices[departure] = price;
        success++;
        console.log(`  ${departure} -> €${price}`);
      } else {
        failed.push(departure);
        console.log(`  ${departure} -> no price`);
      }
    } catch (err) {
      failed.push(departure);
      console.log(`  ${departure} -> error: ${err.message}`);
    }
    await sleep(DELAY_MIN_MS + Math.random() * (DELAY_MAX_MS - DELAY_MIN_MS));
  }

  await browser.close();

  await fs.writeFile(DATA_PATH, JSON.stringify(data, null, 2) + "\n", "utf8");

  const ratio = success / dates.length;
  console.log(`\nDone: ${success}/${dates.length} prices extracted (${Math.round(ratio * 100)}%)`);
  if (failed.length) console.log(`Failed dates: ${failed.join(", ")}`);

  // Exit 1 if we got basically nothing — likely blocked or markup changed.
  if (ratio < 0.2) {
    console.error("Less than 20% success. Likely blocked or markup changed.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Scraper crashed:", err);
  process.exit(2);
});
