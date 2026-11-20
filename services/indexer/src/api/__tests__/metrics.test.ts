import request from "supertest";
import type { Pool } from "pg";
import { createApp } from "../index";
import type { Database } from "../../db";
import {
  dbPoolSize,
  eventsFailedTotal,
  eventsProcessedTotal,
  pipelineLagMs,
  wsConnections,
} from "../../metrics";

const stubDb = {} as Database;

function stubPool(totalCount = 4): Pool {
  return {
    query: jest.fn().mockResolvedValue({ rows: [{ "?column?": 1 }] }),
    totalCount,
    idleCount: 2,
    waitingCount: 0,
  } as unknown as Pool;
}

describe("GET /metrics", () => {
  beforeEach(() => {
    eventsProcessedTotal.reset();
    eventsFailedTotal.reset();
    pipelineLagMs.reset();
    dbPoolSize.reset();
    wsConnections.reset();
  });

  it("returns Prometheus-formatted metrics without requiring authentication", async () => {
    eventsProcessedTotal.inc(12);
    eventsFailedTotal.inc(2);
    pipelineLagMs.set(45);
    wsConnections.set(7);

    const app = createApp(stubDb, stubPool(6));
    const res = await request(app).get("/metrics");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.text).toContain("# TYPE indexer_events_processed_total counter");
    expect(res.text).toContain("indexer_events_processed_total 12");
    expect(res.text).toContain("# TYPE indexer_events_failed_total counter");
    expect(res.text).toContain("indexer_events_failed_total 2");
    expect(res.text).toContain("# TYPE indexer_pipeline_lag_ms gauge");
    expect(res.text).toContain("indexer_pipeline_lag_ms 45");
    expect(res.text).toContain("# TYPE indexer_db_pool_size gauge");
    expect(res.text).toContain("indexer_db_pool_size 6");
    expect(res.text).toContain("# TYPE indexer_ws_connections gauge");
    expect(res.text).toContain("indexer_ws_connections 7");
  });
});
