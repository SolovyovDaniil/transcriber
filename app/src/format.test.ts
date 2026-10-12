import { expect, it } from "vitest";
import { timestamp } from "./format";

it.each([
  [0, "0:00"],
  [65.9, "1:05"],
  [3725.4, "1:02:05"],
  [-3, "0:00"],
])("timestamp(%s) = %s", (input, expected) => {
  expect(timestamp(input)).toBe(expected);
});
