import assert from "node:assert/strict";
import test from "node:test";
import { requestSearchFocus, subscribeToSearchFocus } from "../client/navigation";

test("search entry queues focus until mount, stays within its workspace and cleans up", () => {
  let own = 0;
  let other = 0;
  requestSearchFocus("focus-own");
  const offOther = subscribeToSearchFocus("focus-other", () => other++);
  const offOwn = subscribeToSearchFocus("focus-own", () => own++);
  assert.equal(own, 1);
  assert.equal(other, 0);
  requestSearchFocus("focus-own");
  assert.equal(own, 2);
  offOwn();
  const offRemount = subscribeToSearchFocus("focus-own", () => own++);
  assert.equal(own, 2, "consumed focus is not replayed after reopening the panel");
  offRemount();
  requestSearchFocus("focus-own");
  const offPending = subscribeToSearchFocus("focus-own", () => own++);
  assert.equal(own, 3, "a later command is delivered to the remounted panel");
  offPending();
  offOther();
});
