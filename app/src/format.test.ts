import { expect, it } from "vitest";
import { size, timestamp } from "./format";

it.each([
  [0, "0:00"],
  [65.9, "1:05"],
  [3725.4, "1:02:05"],
  [-3, "0:00"],
])("timestamp(%s) = %s", (input, expected) => {
  expect(timestamp(input)).toBe(expected);
});

it.each([
  [3100 * 1024 * 1024, "3,0 ГБ"],
  [1600 * 1024 * 1024, "1,6 ГБ"],
  [500 * 1024 * 1024, "500 МБ"],
  [0, "0 МБ"],
])("size(%s) = %s", (input, expected) => {
  expect(size(input)).toBe(expected);
});
