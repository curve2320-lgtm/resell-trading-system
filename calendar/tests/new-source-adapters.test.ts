import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  fetchAsicsReleases,
  parseAsicsReleases,
} from "../app/asics.ts";
import {
  fetchNorthFaceReleases,
  parseNorthFaceReleases,
} from "../app/north-face.ts";
import {
  fetchPalaceReleases,
  parsePalaceReleases,
} from "../app/palace.ts";
import {
  fetchSalomonReleases,
  parseSalomonReleases,
} from "../app/salomon.ts";
import {
  fetchTuneProductPages,
  fetchTuneReleases,
  parseTuneProducts,
} from "../app/tune.ts";
import { releaseSourceAdapters } from "../app/collection/registry.ts";
import type { ExternalRelease } from "../app/source-types.ts";

function fixture(name: string) {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

const salomonLaunch = JSON.parse(fixture("salomon-launch.html")) as unknown;
const salomonRaffle = fixture("salomon-raffle.html");
const asicsCalendar = fixture("asics-calendar.html");
const tuneProducts = JSON.parse(fixture("tune-products.json")) as unknown;

function availableAsicsRelease(): ExternalRelease {
  return {
    id: "asics:186",
    externalId: "asics:186",
    title: "GEL-KAYANO 14",
    brand: "ASICS",
    category: "응모",
    releaseDate: "2026-08-07",
    releaseTime: "10:00",
    channel: "ASICS Korea",
    sourceName: "ASICS",
    sourceUrl: "https://www.asics.co.kr/product/detail.html?product_no=186",
    status: "예정",
    confidence: 100,
    note: "ASICS 공식 일정",
    isFeatured: true,
    retailer: "ASICS Korea",
    releaseMethod: "응모",
    styleCode: "1203B186-100",
    productUrl: "https://www.asics.co.kr/product/detail.html?product_no=186",
  };
}

test("Salomon parses launch and product raffle rows on public retailer URLs", () => {
  const parsed = parseSalomonReleases(
    salomonLaunch,
    salomonRaffle,
    new Date("2026-07-31T03:00:00.000Z"),
  );

  assert.deepEqual(
    parsed.releases.map(({ title, releaseDate, category }) => ({
      title,
      releaseDate,
      category,
    })),
    [
      {
        title: "S/LAB ULTRA GLIDE 2 RAFFLE",
        releaseDate: "2026-07-30",
        category: "응모",
      },
      {
        title: "SALOMON XT-6 EXPANSE LTR",
        releaseDate: "2026-08-05",
        category: "정보",
      },
    ],
  );
  assert.match(parsed.releases[1]?.note ?? "", /회원 전용/);
  assert.equal(
    parsed.releases.every(
      ({ productUrl }) => new URL(productUrl ?? "").hostname === "salomon.co.kr",
    ),
    true,
  );
  assert.equal(
    parsed.releases.some(({ title }) => title.includes("러닝 세션")),
    false,
  );
});

test("Salomon resolves a nearby past December row to the previous year", () => {
  const payload = {
    products: [
      {
        id: 1,
        title: "SALOMON DECEMBER ARCHIVE",
        handle: "salomon-december-archive",
        vendor: "SALOMON",
        body_html: "<p>12.30 오픈 예정</p>",
        tags: [],
        variants: [{ price: "200000.00", available: true }],
      },
    ],
  };

  const parsed = parseSalomonReleases(
    payload,
    "",
    new Date("2026-01-02T03:00:00.000Z"),
  );

  assert.equal(parsed.releases[0]?.releaseDate, "2025-12-30");
});

test("Salomon associates each date with its launch or raffle marker", () => {
  const parsed = parseSalomonReleases(
    {
      products: [
        {
          id: 2,
          title: "SALOMON ASSOCIATED DATE",
          handle: "salomon-associated-date",
          vendor: "SALOMON",
          body_html:
            "<p>5.01 캠페인 사전 안내</p><p>8.05 오픈 예정</p>",
          tags: [],
          variants: [{ price: "200000.00", available: true }],
        },
      ],
    },
    `
      <section class="raffle-event-list">
        <article class="raffle-event">
          <a href="/blogs/raffle-event/associated-date">
            <h3>SALOMON ASSOCIATED RAFFLE</h3>
            <p>6.01 캠페인 사전 안내</p>
            <p>8.07 응모 마감</p>
          </a>
        </article>
      </section>
    `,
    new Date("2026-07-31T03:00:00.000Z"),
  );

  assert.deepEqual(
    parsed.releases.map(({ title, releaseDate }) => ({
      title,
      releaseDate,
    })),
    [
      { title: "SALOMON ASSOCIATED DATE", releaseDate: "2026-08-05" },
      { title: "SALOMON ASSOCIATED RAFFLE", releaseDate: "2026-08-07" },
    ],
  );
});

test("ASICS extracts style codes and leaves unconfirmed dates for review", () => {
  const parsed = parseAsicsReleases(
    asicsCalendar,
    new Date("2026-07-31T03:00:00.000Z"),
  );

  assert.equal(parsed.releases.length, 1);
  assert.equal(parsed.releases[0]?.styleCode, "1203B186-100");
  assert.equal(parsed.releases[0]?.category, "응모");
  assert.equal(parsed.releases[0]?.releaseDate, "2026-08-07");
  assert.equal(
    new URL(parsed.releases[0]?.productUrl ?? "").hostname,
    "www.asics.co.kr",
  );
  assert.equal(parsed.undated.length, 1);
  assert.equal(parsed.undated[0]?.styleCode, "1203A383-002");
  assert.equal(parsed.undated[0]?.title, "GEL-NYC");
  assert.match(parsed.undated[0]?.note ?? "", /날짜 미확정/);
});

test("ASICS selects the product-detail anchor when another link appears first", () => {
  const parsed = parseAsicsReleases(`
    <table class="launch-calendar">
      <tbody>
        <tr>
          <td>
            <a href="/board/?id=spscalendar">Launch Calendar 안내</a>
            <a href="/product/detail.html?product_no=777">
              <strong>GEL-LYTE III (1201A777.100)</strong>
              <span>RAFFLE</span>
              <time>2026.08.11 11:00</time>
            </a>
          </td>
        </tr>
      </tbody>
    </table>
  `);

  assert.equal(parsed.releases.length, 1);
  assert.equal(parsed.releases[0]?.title, "GEL-LYTE III");
  assert.equal(
    parsed.releases[0]?.productUrl,
    "https://www.asics.co.kr/product/detail.html?product_no=777",
  );
});

test("ASICS parses the current official gallery and viewlink product markup conservatively", () => {
  const parsed = parseAsicsReleases(`
    <div id="bbslist">
      <ul class="sps_gallerylist">
        <li class="datalist">
          <div class="thumb boad_view_btn"
               viewlink="https://www.asics.co.kr/raffleEvent/lttt_gelresolution"
               board_seq="104"></div>
          <div class="text" board_seq="104">
            <div class="goods_sbt boad_view_btn"
                 viewlink="https://www.asics.co.kr/raffleEvent/lttt_gelresolution">
              LTTT x 젤 레졸루션 5 RAFFLE
            </div>
            <div class="goods_sbj boad_view_btn"
                 viewlink="https://www.asics.co.kr/raffleEvent/lttt_gelresolution"
                 board_seq="104" board_id="spscalendar">
              LTTT x 젤 레졸루션 5 (1203B186,1203B448)
            </div>
          </div>
        </li>
      </ul>
    </div>
  `);

  assert.equal(parsed.structureValid, true);
  assert.equal(parsed.releases.length, 0);
  assert.equal(parsed.undated.length, 1);
  assert.equal(parsed.undated[0]?.title, "LTTT x 젤 레졸루션 5");
  assert.equal(parsed.undated[0]?.styleCode, "1203B186");
  assert.equal(
    parsed.undated[0]?.productUrl,
    "https://www.asics.co.kr/raffleEvent/lttt_gelresolution",
  );
});

test("ASICS counts gallery candidates without a product target as malformed", () => {
  const parsed = parseAsicsReleases(`
    <div id="bbslist">
      <ul class="sps_gallerylist">
        <li class="datalist">
          <div class="goods_sbj" viewlink="https://www.asics.co.kr/p/valid-item">
            VALID ITEM (1203A001)
          </div>
        </li>
        <li class="datalist">
          <div class="goods_sbj">MISSING PRODUCT TARGET (1203A002)</div>
        </li>
      </ul>
    </div>
  `);

  assert.equal(parsed.undated.length, 1);
  assert.equal(parsed.malformedRows, 1);
});

test("TUNE enriches an available style-code schedule without an undated duplicate", () => {
  const parsed = parseTuneProducts(
    tuneProducts,
    [availableAsicsRelease()],
    new Date("2026-07-31T03:00:00.000Z"),
  );

  assert.equal(parsed.releases.length, 1);
  assert.equal(parsed.releases[0]?.styleCode, "1203B186-100");
  assert.equal(parsed.releases[0]?.releaseDate, "2026-08-07");
  assert.equal(parsed.releases[0]?.releaseTime, "10:00");
  assert.equal(parsed.undated.length, 2);
  assert.equal(parsed.undated[0]?.styleCode, "L47870800");
  assert.equal(
    parsed.undated[1]?.title,
    "TUNE STYLE PENDING LIMITED SHOE",
  );
  assert.equal(parsed.undated[1]?.styleCode, null);
  assert.equal(parsed.malformedRows, 0);
  assert.equal(
    [...parsed.releases, ...parsed.undated].some(
      ({ title }) =>
        title === "TUNE RECENT CORE CATALOG ITEM" ||
        title === "TUNE OLD LIMITED RELEASE" ||
        title === "TUNE LIMITED GIFT CARD",
    ),
    false,
  );
  assert.equal(
    new URL(parsed.releases[0]?.productUrl ?? "").hostname,
    "tune.kr",
  );
  assert.equal(
    new URL(parsed.undated[0]?.productUrl ?? "").hostname,
    "tune.kr",
  );
});

function pagedTuneProduct(id: number) {
  return {
    id,
    title: `TUNE LIMITED SHOE ${id}`,
    handle: `tune-limited-shoe-${id}`,
    vendor: "TUNE",
    product_type: "Shoes",
    tags: ["LIMITED"],
    published_at: "2026-07-31T12:00:00+09:00",
    body_html: `<p>Style Code: TUNE${id}</p>`,
    variants: [{ price: "100000.00", available: true }],
    images: [],
  };
}

test("TUNE Shopify pagination continues from the exact official first endpoint", async () => {
  const requested: string[] = [];
  const result = await fetchTuneProductPages(async (url) => {
    requested.push(url);
    return {
      products:
        requested.length === 1
          ? Array.from({ length: 250 }, (_, index) =>
              pagedTuneProduct(index + 1),
            )
          : [pagedTuneProduct(251)],
    };
  });

  assert.deepEqual(requested, [
    "https://tuneglobal.myshopify.com/products.json?limit=250",
    "https://tuneglobal.myshopify.com/products.json?limit=250&page=2",
  ]);
  assert.equal(result.products.length, 251);
  assert.equal(result.truncated, false);
  assert.equal(result.malformedPages, 0);
});

test("TUNE Shopify pagination stops at the safety cap and reports truncation", async () => {
  const requested: string[] = [];
  const result = await fetchTuneProductPages(async (url) => {
    requested.push(url);
    return {
      products: Array.from({ length: 250 }, (_, index) =>
        pagedTuneProduct(requested.length * 1000 + index),
      ),
    };
  });

  assert.equal(requested.length, 8);
  assert.equal(
    requested[7],
    "https://tuneglobal.myshopify.com/products.json?limit=250&page=8",
  );
  assert.equal(result.products.length, 2000);
  assert.equal(result.truncated, true);
  assert.equal(result.malformedPages, 0);
});

test("TUNE wrapper reports a capped response as an error without accepting partial data", async () => {
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];
  globalThis.fetch = async (input) => {
    requested.push(String(input));
    return new Response(
      JSON.stringify({
        products: Array.from({ length: 250 }, (_, index) =>
          pagedTuneProduct(requested.length * 1000 + index),
        ),
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  try {
    const result = await fetchTuneReleases();
    assert.equal(requested.length, 8);
    assert.equal(result.status, "error");
    assert.equal(result.releases.length, 0);
    assert.equal(result.undated?.length ?? 0, 0);
    assert.equal(result.malformedRows, 0);
    assert.match(result.message, /잘림 1.*형식 오류 0/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("TUNE fetches the exact Shopify endpoint but emits only public TUNE URLs", async () => {
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];
  globalThis.fetch = async (input) => {
    requested.push(String(input));
    return new Response(JSON.stringify(tuneProducts), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const result = await fetchTuneReleases();
    assert.deepEqual(requested, [
      "https://tuneglobal.myshopify.com/products.json?limit=250",
    ]);
    assert.equal(
      [...result.releases, ...(result.undated ?? [])].every(
        ({ productUrl }) => new URL(productUrl ?? "").hostname === "tune.kr",
      ),
      true,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ASICS and Salomon wrappers reject consent HTML instead of reporting connected empty", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("products.json")) {
      return new Response(JSON.stringify({ products: [] }), { status: 200 });
    }
    return new Response(
      "<html><head><title>Consent Required</title></head><body><form id=\"consent-form\">동의 후 계속</form></body></html>",
      { status: 200 },
    );
  };

  try {
    const [salomon, asics] = await Promise.all([
      fetchSalomonReleases(),
      fetchAsicsReleases(),
    ]);
    assert.equal(salomon.status, "error");
    assert.equal(asics.status, "error");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ASICS and Salomon parsers expose selector drift as invalid structure", () => {
  const asics = parseAsicsReleases(`
    <section class="calendar-v2">
      <a href="/product/detail.html?product_no=999">
        <strong>GEL-TEST (1203A999.100)</strong>
        <time>2026.08.09 10:00</time>
      </a>
    </section>
  `);
  const salomon = parseSalomonReleases(
    { products: [] },
    `
      <section class="raffle-grid-v2">
        <a href="/blogs/raffle-event/test">
          <h3>SALOMON TEST RAFFLE</h3>
          <p>8.09 응모 마감</p>
        </a>
      </section>
    `,
  );

  assert.equal(asics.structureValid, false);
  assert.equal(asics.releases.length, 0);
  assert.equal(asics.undated.length, 0);
  assert.equal(salomon.structureValid, false);
  assert.equal(salomon.releases.length, 0);
});

test("new source wrappers use their official endpoints", async () => {
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    requested.push(url);
    if (url.endsWith("products.json?limit=250")) {
      return new Response(JSON.stringify({ products: [] }), { status: 200 });
    }
    if (url.includes("raffle-event")) {
      return new Response(
        '<section class="raffle-event-list"></section>',
        { status: 200 },
      );
    }
    if (url.includes("thenorthfacekorea.co.kr")) {
      return new Response(fixture("north-face-new.html"), { status: 200 });
    }
    if (url.includes("palaceskateboards.seoul.kr") && url.includes("waitingStoreId=1")) {
      return new Response(fixture("palace-raffle-apgujeong.json"), { status: 200 });
    }
    if (url.includes("palaceskateboards.seoul.kr") && url.includes("waitingStoreId=7")) {
      return new Response(fixture("palace-raffle-hongdae.json"), { status: 200 });
    }
    return new Response(
      '<table class="launch-calendar"><tbody></tbody></table>',
      { status: 200 },
    );
  };

  try {
    const [salomon, asics, northFace, palace] = await Promise.all([
      fetchSalomonReleases(),
      fetchAsicsReleases(),
      fetchNorthFaceReleases(),
      fetchPalaceReleases(),
    ]);
    assert.deepEqual(requested.sort(), [
      "https://api.palaceskateboards.seoul.kr/v1/raffleStore/getRaffleStores?waitingStoreId=1",
      "https://api.palaceskateboards.seoul.kr/v1/raffleStore/getRaffleStores?waitingStoreId=7",
      "https://salomon.co.kr/collections/launch-calendar/products.json?limit=250",
      "https://salomon.co.kr/collections/raffle-event",
      "https://www.asics.co.kr/board/?id=spscalendar",
      "https://www.thenorthfacekorea.co.kr/category/n/new?sort=ACTIVE_DATE_DESC",
    ]);
    assert.equal(salomon.status, "connected");
    assert.equal(salomon.releases.length, 0);
    assert.equal(asics.status, "connected");
    assert.equal(asics.releases.length, 0);
    assert.equal(northFace.status, "connected");
    assert.equal(northFace.undated.length, 2);
    assert.equal(palace.status, "connected");

    const registeredSalomon = releaseSourceAdapters.find(
      ({ key }) => key === "salomon",
    );
    const registeredAsics = releaseSourceAdapters.find(
      ({ key }) => key === "asics",
    );
    assert.equal(
      (await registeredSalomon?.collect(
        new Date("2026-07-31T03:00:00.000Z"),
      ))?.confirmedEmpty,
      false,
    );
    assert.equal(
      (await registeredAsics?.collect(
        new Date("2026-07-31T03:00:00.000Z"),
      ))?.confirmedEmpty,
      false,
    );
    assert.equal(
      (await releaseSourceAdapters.find(({ key }) => key === "northFace")?.collect(
        new Date("2026-07-31T03:00:00.000Z"),
      ))?.confirmedEmpty,
      false,
    );
    assert.equal(
      (await releaseSourceAdapters.find(({ key }) => key === "palace")?.collect(
        new Date("2026-07-31T03:00:00.000Z"),
      ))?.confirmedEmpty,
      false,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("registry exposes Salomon, ASICS, and TUNE with public domains", () => {
  const registered = new Map(
    releaseSourceAdapters.map(({ key, allowedDomains }) => [
      key,
      allowedDomains,
    ]),
  );

  assert.deepEqual(registered.get("salomon"), ["salomon.co.kr"]);
  assert.deepEqual(registered.get("asics"), ["asics.co.kr"]);
  assert.deepEqual(registered.get("tune"), ["tune.kr"]);
});

test("North Face parser extracts upcoming official products without inferring dates", () => {
  const parsed = parseNorthFaceReleases(fixture("north-face-new.html"));
  assert.equal(parsed.structureValid, true);
  assert.equal(parsed.releases.length, 0);
  assert.deepEqual(
    parsed.undated.map(({ styleCode, productUrl }) => ({ styleCode, productUrl })),
    [
      {
        styleCode: "NS97S22B",
        productUrl: "https://www.thenorthfacekorea.co.kr/product/NS97S22B",
      },
      {
        styleCode: "NJ3BS63J",
        productUrl: "https://www.thenorthfacekorea.co.kr/product/NJ3BS63J",
      },
    ],
  );
});

test("North Face parser publishes only a product page's explicit future date", () => {
  const parsed = parseNorthFaceReleases(fixture("north-face-new.html"), [
    {
      url: "https://www.thenorthfacekorea.co.kr/product/NS97S22B",
      html: fixture("north-face-upcoming.html"),
    },
  ]);
  assert.equal(parsed.releases.length, 1);
  assert.equal(parsed.releases[0]?.releaseDate, "2026-09-01");
  assert.equal(parsed.releases[0]?.styleCode, "NS97S22B");
});

test("Palace parser creates separate official signup events for both stores", () => {
  const parsed = parsePalaceReleases([
    { waitingStoreId: 1, payload: JSON.parse(fixture("palace-raffle-apgujeong.json")) },
    { waitingStoreId: 7, payload: JSON.parse(fixture("palace-raffle-hongdae.json")) },
  ], new Date("2026-08-12T04:30:00.000Z"));

  assert.deepEqual(
    parsed.releases.map(({ title, releaseDate, releaseTime, productUrl }) => ({
      title,
      releaseDate,
      releaseTime,
      productUrl,
    })),
    [
      {
        title: "PALACE 매장 입장 응모 · 압구정",
        releaseDate: "2026-08-12",
        releaseTime: "14:00",
        productUrl: "https://palaceskateboards.seoul.kr/waitingStore?waitingStoreId=1",
      },
      {
        title: "PALACE 매장 입장 응모 · 홍대",
        releaseDate: "2026-08-12",
        releaseTime: "14:00",
        productUrl: "https://palaceskateboards.seoul.kr/waitingStore?waitingStoreId=7",
      },
    ],
  );
  assert.match(parsed.releases[0]?.note ?? "", /방문 2026-08-15/);
});

test("Palace parser skips invisible and expired events", () => {
  const parsed = parsePalaceReleases([
    {
      waitingStoreId: 1,
      payload: {
        code: "SUCCESS",
        payload: [
          {
            id: 1,
            visible: false,
            status: "READY",
            eventFrom: "2026-08-12T14:00:00",
            eventUntil: "2026-08-12T16:00:00",
            reservationDay: "2026-08-15",
            raffleStoreReservations: [{ reservationTime: "ALL DAY" }],
          },
          {
            id: 2,
            visible: true,
            status: "READY",
            eventFrom: "2026-08-10T14:00:00",
            eventUntil: "2026-08-10T16:00:00",
            reservationDay: "2026-08-11",
            raffleStoreReservations: [{ reservationTime: "ALL DAY" }],
          },
        ],
      },
    },
  ], new Date("2026-08-12T04:30:00.000Z"));
  assert.equal(parsed.releases.length, 0);
});

test("registry exposes North Face and Palace official sources", () => {
  const registered = new Map(
    releaseSourceAdapters.map(({ key, allowedDomains }) => [key, allowedDomains]),
  );
  assert.deepEqual(registered.get("northFace"), ["thenorthfacekorea.co.kr"]);
  assert.deepEqual(registered.get("palace"), ["palaceskateboards.seoul.kr"]);
});
