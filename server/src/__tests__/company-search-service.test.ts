import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  companies,
  createDb,
  documents,
  issueComments,
  issueDocuments,
  issues,
  projects,
} from "@paperclipai/db";
import { companySearchQuerySchema, COMPANY_SEARCH_MAX_QUERY_LENGTH } from "@paperclipai/shared";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import {
  COMPANY_SEARCH_BRANCH_FETCH_LIMIT,
  companySearchBranchFetchLimit,
  companySearchService,
} from "../services/company-search.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres company search tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describe("company search query validation", () => {
  it("clamps query length, limit, and offset without rejecting the request", () => {
    const parsed = companySearchQuerySchema.parse({
      q: "x".repeat(COMPANY_SEARCH_MAX_QUERY_LENGTH + 50),
      limit: "500",
      offset: "9000",
      scope: "not-a-scope",
    });

    expect(parsed.q).toHaveLength(COMPANY_SEARCH_MAX_QUERY_LENGTH);
    expect(parsed.limit).toBe(50);
    expect(parsed.offset).toBe(200);
    expect(parsed.scope).toBe("all");
  });

  it("keeps the internal per-branch fetch limit independent of high offsets", () => {
    const lowOffset = companySearchQuerySchema.parse({ q: "needle", limit: "50", offset: "0" });
    const highOffset = companySearchQuerySchema.parse({ q: "needle", limit: "50", offset: "9000" });

    expect(companySearchBranchFetchLimit(lowOffset.limit)).toBe(COMPANY_SEARCH_BRANCH_FETCH_LIMIT);
    expect(companySearchBranchFetchLimit(highOffset.limit)).toBe(COMPANY_SEARCH_BRANCH_FETCH_LIMIT);
  });
});

describeEmbeddedPostgres("companySearchService", () => {
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof companySearchService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-company-search-");
    db = createDb(tempDb.connectionString);
    svc = companySearchService(db);
    await db.execute(sql.raw("CREATE EXTENSION IF NOT EXISTS pg_trgm"));
  }, 20_000);

  afterEach(async () => {
    await db.delete(issueDocuments);
    await db.delete(documents);
    await db.delete(issueComments);
    await db.delete(issues);
    await db.delete(projects);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function createCompany(name = "Paperclip") {
    const companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name,
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    return companyId;
  }

  async function createIssue(companyId: string, values: Partial<typeof issues.$inferInsert> = {}) {
    const id = values.id ?? randomUUID();
    await db.insert(issues).values({
      id,
      companyId,
      title: values.title ?? "Search target",
      description: values.description ?? null,
      status: values.status ?? "todo",
      priority: values.priority ?? "medium",
      identifier: values.identifier ?? null,
      hiddenAt: values.hiddenAt ?? null,
      ...values,
    });
    return id;
  }

  it("ranks exact issue identifiers before weaker title matches", async () => {
    const companyId = await createCompany();
    const exactId = await createIssue(companyId, {
      identifier: "TST-42",
      title: "Backend endpoint",
    });
    await createIssue(companyId, {
      identifier: "TST-43",
      title: "TST-42 mentioned in title only",
    });

    const result = await svc.search(companyId, companySearchQuerySchema.parse({ q: "TST-42" }));

    expect(result.results[0]?.id).toBe(exactId);
    expect(result.results[0]?.matchedFields).toContain("identifier");
  });

  it("matches multiple tokens across the same issue thread and returns comment snippets", async () => {
    const companyId = await createCompany();
    const issueId = await createIssue(companyId, {
      identifier: "TST-7",
      title: "Checkout semantics",
      description: "Atomic ownership is enforced here.",
    });
    await db.insert(issueComments).values({
      companyId,
      issueId,
      body: "The ranking snippet should explain why this thread matched.",
    });

    const result = await svc.search(companyId, companySearchQuerySchema.parse({ q: "checkout snippet" }));
    const match = result.results.find((item) => item.id === issueId);

    expect(match).toBeTruthy();
    expect(match?.matchedFields).toEqual(expect.arrayContaining(["title", "comment"]));
    expect(match?.snippets.some((snippet) => /snippet/i.test(snippet.text))).toBe(true);
  });

  it("searches issue documents and returns document metadata for snippets", async () => {
    const companyId = await createCompany();
    const issueId = await createIssue(companyId, {
      identifier: "TST-8",
      title: "Adapter manager",
    });
    const documentId = randomUUID();
    await db.insert(documents).values({
      id: documentId,
      companyId,
      title: "Hermes Parser Plan",
      latestBody: "The external adapter parser should be discovered from the plugin package.",
      format: "markdown",
    });
    await db.insert(issueDocuments).values({
      companyId,
      issueId,
      documentId,
      key: "plan",
    });

    const result = await svc.search(companyId, companySearchQuerySchema.parse({ q: "Hermes parser", scope: "documents" }));

    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.id).toBe(issueId);
    expect(result.results[0]?.matchedFields).toContain("document");
    expect(result.results[0]?.href).toContain("#document-plan");
    expect(result.results[0]?.snippet).toMatch(/parser/i);
  });

  it("excludes hidden issues and other companies' data", async () => {
    const companyId = await createCompany("Visible Co");
    const otherCompanyId = await createCompany("Other Co");
    const visibleId = await createIssue(companyId, {
      identifier: "VIS-1",
      title: "Visible needle",
    });
    await createIssue(companyId, {
      identifier: "HID-1",
      title: "Hidden needle",
      hiddenAt: new Date(),
    });
    await createIssue(otherCompanyId, {
      identifier: "OTH-1",
      title: "Other company needle",
    });

    const result = await svc.search(companyId, companySearchQuerySchema.parse({ q: "needle" }));

    expect(result.results.map((item) => item.id)).toEqual([visibleId]);
  });

  it("uses pg_trgm for conservative fuzzy title matches", async () => {
    const companyId = await createCompany();
    const issueId = await createIssue(companyId, {
      identifier: "TST-9",
      title: "Onboarding wizard polish",
    });

    const result = await svc.search(companyId, companySearchQuerySchema.parse({ q: "onbordng wizard" }));

    expect(result.results[0]?.id).toBe(issueId);
    expect(result.results[0]?.matchedFields).toContain("title");
  });

  it("matches transposition typos against multi-word titles", async () => {
    const companyId = await createCompany();
    const searchIssueId = await createIssue(companyId, {
      identifier: "TST-10",
      title: "Improve search performance",
    });
    const mobileIssueId = await createIssue(companyId, {
      identifier: "TST-11",
      title: "Polish mobile navigation",
    });
    const otherIssueId = await createIssue(companyId, {
      identifier: "TST-12",
      title: "Refactor billing reports",
    });

    const transpositionCases: Array<{ query: string; expectedId: string; rejected: string }> = [
      { query: "serach", expectedId: searchIssueId, rejected: otherIssueId },
      { query: "mibile", expectedId: mobileIssueId, rejected: otherIssueId },
      { query: "mobail", expectedId: mobileIssueId, rejected: otherIssueId },
    ];

    for (const { query, expectedId, rejected } of transpositionCases) {
      const result = await svc.search(companyId, companySearchQuerySchema.parse({ q: query }));
      const ids = result.results.map((row) => row.id);
      expect(ids, `query=${query}`).toContain(expectedId);
      expect(ids, `query=${query} should not match unrelated issue`).not.toContain(rejected);
    }
  });
});
