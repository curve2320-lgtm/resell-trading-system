import assert from "node:assert/strict";
import test from "node:test";
import { indexReleasesForDays, releaseAppearsOnDate } from "../app/release-schedule-days.ts";

const raffle = {
  id: "confirmed-raffle", category: "응모", releaseDate: "2026-10-05",
  startAt: "2026-09-29T10:00:00+09:00", endAt: "2026-10-05T18:00:00+09:00",
};

test("confirmed raffle periods appear from opening through closing across months", () => {
  assert.equal(releaseAppearsOnDate(raffle, "2026-09-28"), false);
  for (const day of ["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-05"]) {
    assert.equal(releaseAppearsOnDate(raffle, day), true);
  }
  assert.equal(releaseAppearsOnDate(raffle, "2026-10-06"), false);
});

test("UTC timestamps use Korean day boundaries and include the confirmed closing date", () => {
  const release = { ...raffle, releaseDate: "2026-10-01", startAt: "2026-09-30T15:00:00Z", endAt: "2026-10-02T15:00:00Z" };
  assert.equal(releaseAppearsOnDate(release, "2026-09-30"), false);
  assert.equal(releaseAppearsOnDate(release, "2026-10-01"), true);
  assert.equal(releaseAppearsOnDate(release, "2026-10-03"), true);
  assert.equal(releaseAppearsOnDate(release, "2026-10-04"), false);
});

test("unknown clock times retain explicit confirmed dates without inventing another day", () => {
  const release = { ...raffle, releaseDate: "2026-10-01", startAt: "2026-10-01T00:00:00+09:00", endAt: "2026-10-05T00:00:00+09:00", startTimeUnknown: true, endTimeUnknown: true };
  assert.equal(releaseAppearsOnDate(release, "2026-10-01"), true);
  assert.equal(releaseAppearsOnDate(release, "2026-10-05"), true);
  assert.equal(releaseAppearsOnDate(release, "2026-10-06"), false);
});

test("confirmed date-only raffle endpoints expand only with their corresponding unknown-time flags", () => {
  const release = { ...raffle, startAt: "2026-09-29", endAt: "2026-10-05", startTimeUnknown: true, endTimeUnknown: true };
  assert.equal(releaseAppearsOnDate(release, "2026-09-28"), false);
  assert.equal(releaseAppearsOnDate(release, "2026-10-04"), true);
  assert.equal(releaseAppearsOnDate(release, "2026-10-05"), true);
  assert.equal(releaseAppearsOnDate(release, "2026-10-06"), false);
  for (const changed of [{ startTimeUnknown: false }, { endTimeUnknown: false }, { startTimeUnknown: undefined }, { endTimeUnknown: undefined }]) {
    assert.equal(releaseAppearsOnDate({ ...release, ...changed }, "2026-10-04"), false);
  }
  assert.equal(release.startAt, "2026-09-29");
  assert.equal(release.endAt, "2026-10-05");
});

test("flagged date-only ranges validate dates and ordering across the year boundary", () => {
  const release = { ...raffle, releaseDate: "2026-12-29", startAt: "2026-12-29", endAt: "2027-01-05", startTimeUnknown: true, endTimeUnknown: true };
  assert.equal(releaseAppearsOnDate(release, "2027-01-01"), true);
  assert.equal(releaseAppearsOnDate(release, "2027-01-05"), true);
  assert.equal(releaseAppearsOnDate(release, "2027-01-06"), false);
  assert.equal(releaseAppearsOnDate({ ...release, startAt: "2027-01-06" }, "2027-01-01"), false);
  assert.equal(releaseAppearsOnDate({ ...release, startAt: "2026-02-30" }, "2027-01-01"), false);
  assert.equal(releaseAppearsOnDate({ ...release, endAt: null }, "2027-01-01"), false);
});

test("missing, reversed, ambiguous and impossible ranges cannot add period days", () => {
  for (const changed of [
    { startAt: null }, { endAt: null },
    { startAt: "2026-10-06T00:00:00+09:00" },
    { startAt: "2026-10-01T10:00:00" },
    { startAt: "2026-02-30T10:00:00+09:00" },
    { endAt: "invalid" },
    { startAt: "2026-10-01T25:00:00+09:00" },
  ]) {
    const release = { ...raffle, ...changed };
    assert.equal(releaseAppearsOnDate(release, "2026-10-02"), false);
    assert.equal(releaseAppearsOnDate(release, "2026-10-05"), true);
  }
  assert.equal(releaseAppearsOnDate(raffle, "2026-02-30"), false);
  assert.equal(releaseAppearsOnDate(raffle, "invalid"), false);
});

test("ordinary releases stay on their release date and announcement dates are not expanded", () => {
  assert.equal(releaseAppearsOnDate({ ...raffle, category: "선착순" }, "2026-10-01"), false);
  assert.equal(releaseAppearsOnDate({ ...raffle, category: "선착순" }, "2026-10-05"), true);
  assert.equal(releaseAppearsOnDate({ ...raffle, announcementAt: "2026-10-07T12:00:00+09:00" }, "2026-10-07"), false);
});

test("explicit first-come sales remain visible throughout their confirmed sale period", () => {
  const sale = {
    id: "emart24-pokemon", category: "선착순", releaseMethod: "선착순", releaseDate: "2026-10-03",
    startAt: "2026-10-03", endAt: "2026-10-05", startTimeUnknown: true, endTimeUnknown: true,
  };
  for (const releaseMethod of ["선착순", "first-come", "first come"]) {
    const release = { ...sale, releaseMethod };
    assert.equal(releaseAppearsOnDate(release, "2026-10-02"), false);
    assert.equal(releaseAppearsOnDate(release, "2026-10-04"), true);
    assert.equal(releaseAppearsOnDate(release, "2026-10-05"), true);
    assert.equal(releaseAppearsOnDate(release, "2026-10-06"), false);
    assert.equal(indexReleasesForDays([release], ["2026-10-04"])["2026-10-04"][0], release);
  }
});

test("sale period expansion still requires explicit sale method, valid endpoints and product category", () => {
  const sale = {
    category: "선착순", releaseMethod: "선착순", releaseDate: "2026-10-03",
    startAt: "2026-10-03", endAt: "2026-10-05", startTimeUnknown: true, endTimeUnknown: true,
  };
  for (const changed of [
    { releaseMethod: undefined }, { releaseMethod: "공지" }, { category: "정보" }, { category: "루머" },
    { startAt: null }, { endAt: null }, { startAt: "2026-10-06" }, { endAt: "2026-02-30" },
    { startTimeUnknown: false }, { endTimeUnknown: false },
  ]) {
    assert.equal(releaseAppearsOnDate({ ...sale, ...changed }, "2026-10-04"), false);
  }
  assert.equal(releaseAppearsOnDate({ ...sale, announcementAt: "2026-10-07T12:00:00+09:00" }, "2026-10-07"), false);
});

test("day indexing counts each product once per visible day and preserves product references", () => {
  const sale = { id: "sale", category: "선착순", releaseDate: "2026-10-02" };
  const result = indexReleasesForDays([raffle, sale], ["2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06"]);
  assert.deepEqual(result["2026-10-01"].map(item => item.id), [raffle.id]);
  assert.deepEqual(result["2026-10-02"].map(item => item.id), [raffle.id, sale.id]);
  assert.deepEqual(result["2026-10-05"].map(item => item.id), [raffle.id]);
  assert.deepEqual(result["2026-10-06"], []);
  assert.equal(result["2026-10-01"][0], raffle);
  assert.equal(result["2026-10-05"][0], raffle);
});

test("a years-long range only indexes the supplied forty-two calendar cells", () => {
  const release = { ...raffle, startAt: "2000-01-01T00:00:00Z", endAt: "2100-01-01T00:00:00Z" };
  const days = Array.from({ length: 60 }, (_, index) => new Date(Date.UTC(2026, 9, index + 1)).toISOString().slice(0, 10));
  const result = indexReleasesForDays([release], days);
  assert.equal(Object.keys(result).length, 42);
  assert.equal(result[days[41]][0], release);
  assert.equal(result[days[42]], undefined);
});
