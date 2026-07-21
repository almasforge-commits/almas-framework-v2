import assert from "node:assert/strict";
import {
  getDomain,
  listDomains,
  isKnownDomain,
  getExtractableDomains,
  getExecutableDomains,
  listDomainIds,
  listExtractableDomainIds,
  listRouterActionTypes,
  getDomainIdForActionType,
  DOMAIN_REGISTRY,
} from "../config/domainRegistry.js";
import { EXTRACTION_KINDS } from "../services/inbox/universalExtractionContracts.js";
import { INFORMATION_KINDS } from "../services/inbox/inboxContracts.js";
import { ACTION_TYPES } from "../services/inbox/contracts.js";

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
  } catch (error) {
    console.error(`❌ ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

function run() {
  test("registry validity: required fields on every domain", () => {
    for (const domain of listDomains()) {
      assert.equal(typeof domain.id, "string");
      assert.ok(domain.id);
      assert.equal(typeof domain.title, "string");
      assert.equal(typeof domain.description, "string");
      assert.equal(typeof domain.icon, "string");
      assert.equal(typeof domain.enabled, "boolean");
      assert.equal(typeof domain.extractable, "boolean");
      assert.equal(typeof domain.executable, "boolean");
      assert.equal(typeof domain.supportsSearch, "boolean");
      assert.equal(typeof domain.supportsTimeline, "boolean");
      assert.equal(typeof domain.supportsAI, "boolean");
      assert.ok(
        domain.futureTable === null || typeof domain.futureTable === "string"
      );
    }
  });

  test("no duplicate domain ids", () => {
    const ids = listDomainIds();
    assert.equal(ids.length, new Set(ids).size);
    assert.equal(DOMAIN_REGISTRY.length, ids.length);
  });

  test("getDomain / isKnownDomain / list helpers", () => {
    assert.equal(getDomain("idea")?.title, "Ideas");
    assert.equal(getDomain("idea")?.futureTable, "ideas");
    assert.equal(getDomain("missing"), null);
    assert.equal(isKnownDomain("finance"), true);
    assert.equal(isKnownDomain("not_a_domain"), false);
    assert.equal(isKnownDomain(null), false);
    assert.ok(getExtractableDomains().every((d) => d.extractable));
    assert.ok(getExecutableDomains().every((d) => d.executable));
    assert.deepEqual(
      getExecutableDomains().map((d) => d.id).sort(),
      ["idea", "memory", "task"]
    );
  });

  test("every extractor kind exists in registry", () => {
    for (const kind of EXTRACTION_KINDS) {
      assert.ok(isKnownDomain(kind), `missing domain for extraction kind ${kind}`);
    }
    assert.deepEqual(EXTRACTION_KINDS, listExtractableDomainIds());
  });

  test("Inbox INFORMATION_KINDS matches registry domain ids", () => {
    assert.deepEqual([...INFORMATION_KINDS], listDomainIds());
  });

  test("unknown domain rejected", () => {
    assert.equal(isKnownDomain("widgets"), false);
    assert.equal(getDomain("widgets"), null);
    assert.equal(getDomainIdForActionType("invented_action"), null);
  });

  test("router ACTION_TYPES stay aligned with registry", () => {
    assert.deepEqual(ACTION_TYPES, [...listRouterActionTypes()]);
    for (const type of ACTION_TYPES) {
      assert.ok(getDomainIdForActionType(type), type);
    }
  });

  if (process.exitCode) console.error("\nSome domain-registry tests failed.");
  else console.log("\nAll domain-registry tests passed.");
}

run();
