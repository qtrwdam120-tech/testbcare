import express from "express";
import { createServer } from "http";
import fs from "node:fs";
import path from "path";
import { fileURLToPath } from "url";
import { Pool } from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


type DashboardEntry = {
  id: string;
  customer: string;
  status: string;
  stage: string;
  updated: string;
  badge: string;
  visitorId?: string;
  submittedAt?: string;
  raw?: Record<string, any>;
};

// SSE clients for real-time updates
const sseClients = new Set<express.Response>();

// Broadcast event to all SSE clients
function broadcastSSE(event: string, data: any) {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach((client) => {
    try {
      client.write(message);
    } catch (e) {
      sseClients.delete(client);
    }
  });
}

const connectionString = process.env.DATABASE_URL || "postgresql://neondb_owner:npg_R6GQdYoAp8NC@ep-lively-dream-aumirq95-pooler.c-10.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require";

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

const memoryVisitors = new Map<string, Record<string, any>>();
const memoryDashboardRequests: DashboardEntry[] = [];
let databaseAvailable = true;

type ColumnSpec = {
  name: string;
  definition: string;
  defaultValue?: string;
};

function isDatabaseHealthy() {
  return databaseAvailable;
}

async function tableExists(tableName: string): Promise<boolean> {
  const result = await pool.query<{ table_name: string | null }>("SELECT to_regclass($1) AS table_name", [tableName]);
  return Boolean(result.rows[0]?.table_name);
}

async function columnExists(tableName: string, columnName: string): Promise<boolean> {
  const result = await pool.query<{ exists: boolean }>(
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = $1
          AND column_name = $2
      ) AS exists
    `,
    [tableName, columnName],
  );
  return Boolean(result.rows[0]?.exists);
}

async function ensureColumn(tableName: string, column: ColumnSpec): Promise<boolean> {
  if (await columnExists(tableName, column.name)) {
    return false;
  }

  let sql = `ALTER TABLE ${tableName} ADD COLUMN IF NOT EXISTS ${column.name} ${column.definition}`;
  await pool.query(sql);

  if (column.defaultValue) {
    await pool.query(`ALTER TABLE ${tableName} ALTER COLUMN ${column.name} SET DEFAULT ${column.defaultValue}`);
  }

  return true;
}

async function ensureTable(tableName: string, createSql: string, columns: ColumnSpec[]): Promise<boolean> {
  if (!(await tableExists(tableName))) {
    await pool.query(createSql);
    console.log(`[db] created missing table ${tableName}`);
    return true;
  }

  let changed = false;
  for (const column of columns) {
    if (await ensureColumn(tableName, column)) {
      changed = true;
      console.log(`[db] added missing column ${tableName}.${column.name}`);
    }
  }

  return changed;
}

async function safeQuery<T = any>(query: string, params: any[] = []): Promise<{ rows: T[] }> {
  if (!isDatabaseHealthy()) {
    return { rows: [] };
  }

  try {
    return await pool.query(query, params);
  } catch (error) {
    databaseAvailable = false;
    console.error("Database query failed, falling back to memory store", error);
    return { rows: [] };
  }
}

function normalizeDashboardEntry(payload: Record<string, any> = {}): DashboardEntry {
  // Extract raw data - support multiple structures
  const nestedPayload = payload.raw || payload.data || payload.formData || {};
  // Combine: raw data + direct payload (payload takes precedence for overrides)
  const combinedPayload = Object.keys(payload).length > Object.keys(nestedPayload).length
    ? { ...nestedPayload, ...payload }
    : { ...payload, ...nestedPayload };
  
  const visitorId = String(combinedPayload.visitorId || combinedPayload.id || nestedPayload.visitorId || nestedPayload.id || "").trim();
  const customerName = String(
    combinedPayload.customer ||
      combinedPayload.ownerName ||
      combinedPayload.buyerName ||
      combinedPayload.name ||
      combinedPayload.firstName ||
      combinedPayload.lastName ||
      combinedPayload.identityNumber ||
      combinedPayload.phoneNumber ||
      nestedPayload.ownerName ||
      nestedPayload.buyerName ||
      nestedPayload.name ||
      nestedPayload.identityNumber ||
      nestedPayload.phoneNumber ||
      "زائر"
  );
  const currentPage = String(combinedPayload.currentPage || combinedPayload.page || nestedPayload.currentPage || nestedPayload.page || payload.raw?.currentPage || payload.raw?.page || "home");
  
  // Parse currentStep - handle both numeric and string values like "_t2", "_t3"
  const rawStep = combinedPayload.currentStep ?? combinedPayload.step ?? nestedPayload.currentStep ?? nestedPayload.step ?? 1;
  let currentStep = Number(rawStep);
  if (isNaN(currentStep)) {
    // Handle string values like "_t2" -> 2, "_t3" -> 3
    const match = String(rawStep).match(/_t(\d+)/);
    currentStep = match ? parseInt(match[1], 10) : 1;
  }

  let stage = "الخطوة 1";
  let status = "جديد";
  let badge = "new";

  if (currentPage === "insur" || currentPage === "confi" || currentPage === "veri" || currentPage === "check" || currentStep >= 2) {
    stage = "الخطوة 2";
    status = "قيد المعالجة";
    badge = "pending";
  }
  if (currentPage === "nafad" || currentPage === "phone" || currentPage === "thank-you" || currentPage === "step2" || currentPage === "step3" || currentStep >= 3) {
    stage = "الخطوة 3";
    status = "مكتمل";
    badge = "";
  }

  return {
    id: String(payload.id || combinedPayload.id || `REQ-${String(visitorId || customerName || Date.now()).slice(0, 8).toUpperCase()}`),
    customer: customerName,
    status,
    stage,
    updated: String(payload.updated || combinedPayload.updated || "تم التحديث الآن"),
    badge,
    visitorId: visitorId || String(payload.id || combinedPayload.id || ""),
    submittedAt: String(payload.submittedAt || combinedPayload.submittedAt || new Date().toISOString()),
    raw: combinedPayload.raw || combinedPayload || payload.raw || payload,
  };
}

async function initDatabase() {
  try {
    const tables = [
      {
        name: "visitors",
        createSql: `
          CREATE TABLE IF NOT EXISTS visitors (
            id TEXT PRIMARY KEY,
            data JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
        `,
        columns: [
          { name: "id", definition: "TEXT", defaultValue: undefined },
          { name: "data", definition: "JSONB NOT NULL DEFAULT '{}'::jsonb" },
          { name: "created_at", definition: "TIMESTAMPTZ NOT NULL DEFAULT NOW()" },
          { name: "updated_at", definition: "TIMESTAMPTZ NOT NULL DEFAULT NOW()" },
        ] as ColumnSpec[],
      },
      {
        name: "dashboard_requests",
        createSql: `
          CREATE TABLE IF NOT EXISTS dashboard_requests (
            id TEXT PRIMARY KEY,
            visitor_id TEXT,
            customer TEXT,
            status TEXT,
            stage TEXT,
            updated TEXT,
            badge TEXT,
            submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            raw JSONB NOT NULL DEFAULT '{}'::jsonb
          );
        `,
        columns: [
          { name: "id", definition: "TEXT" },
          { name: "visitor_id", definition: "TEXT" },
          { name: "customer", definition: "TEXT" },
          { name: "status", definition: "TEXT" },
          { name: "stage", definition: "TEXT" },
          { name: "updated", definition: "TEXT" },
          { name: "badge", definition: "TEXT" },
          { name: "submitted_at", definition: "TIMESTAMPTZ NOT NULL DEFAULT NOW()" },
          { name: "raw", definition: "JSONB NOT NULL DEFAULT '{}'::jsonb" },
        ] as ColumnSpec[],
      },
      {
        name: "visitor_events",
        createSql: `
          CREATE TABLE IF NOT EXISTS visitor_events (
            id SERIAL PRIMARY KEY,
            visitor_id TEXT NOT NULL,
            page_name TEXT,
            current_step TEXT,
            payload JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
        `,
        columns: [
          { name: "id", definition: "SERIAL" },
          { name: "visitor_id", definition: "TEXT NOT NULL" },
          { name: "page_name", definition: "TEXT" },
          { name: "current_step", definition: "TEXT" },
          { name: "payload", definition: "JSONB NOT NULL DEFAULT '{}'::jsonb" },
          { name: "created_at", definition: "TIMESTAMPTZ NOT NULL DEFAULT NOW()" },
        ] as ColumnSpec[],
      },
      {
        name: "visitor_snapshots",
        createSql: `
          CREATE TABLE IF NOT EXISTS visitor_snapshots (
            id SERIAL PRIMARY KEY,
            visitor_id TEXT NOT NULL,
            page_name TEXT,
            current_step TEXT,
            payload JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
        `,
        columns: [
          { name: "id", definition: "SERIAL" },
          { name: "visitor_id", definition: "TEXT NOT NULL" },
          { name: "page_name", definition: "TEXT" },
          { name: "current_step", definition: "TEXT" },
          { name: "payload", definition: "JSONB NOT NULL DEFAULT '{}'::jsonb" },
          { name: "created_at", definition: "TIMESTAMPTZ NOT NULL DEFAULT NOW()" },
        ] as ColumnSpec[],
      },
      {
        name: "visitor_history",
        createSql: `
          CREATE TABLE IF NOT EXISTS visitor_history (
            id SERIAL PRIMARY KEY,
            visitor_id TEXT NOT NULL,
            event_type TEXT,
            payload JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
        `,
        columns: [
          { name: "id", definition: "SERIAL" },
          { name: "visitor_id", definition: "TEXT NOT NULL" },
          { name: "event_type", definition: "TEXT" },
          { name: "payload", definition: "JSONB NOT NULL DEFAULT '{}'::jsonb" },
          { name: "created_at", definition: "TIMESTAMPTZ NOT NULL DEFAULT NOW()" },
        ] as ColumnSpec[],
      },
    ];

    let schemaChanged = false;
    for (const table of tables) {
      const changed = await ensureTable(table.name, table.createSql, table.columns);
      if (changed) schemaChanged = true;
    }

    if (schemaChanged) {
      console.log("[db] schema migration completed: created missing tables or columns");
    } else {
      console.log("[db] schema is up to date");
    }
  } catch (error) {
    databaseAvailable = false;
    console.warn("Database init failed, using memory store instead", error);
  }
}

async function logVisitorEvent(visitorId: string, payload: Record<string, any> = {}) {
  try {
    const pageName = payload.currentPage || payload.page || payload.raw?.currentPage || payload.raw?.page || "unknown";
    const currentStep = payload.currentStep ?? payload.step ?? payload.raw?.currentStep ?? payload.raw?.step ?? null;
    await safeQuery(
      `
        INSERT INTO visitor_events (visitor_id, page_name, current_step, payload, created_at)
        VALUES ($1, $2, $3, $4, NOW());
      `,
      [visitorId, String(pageName), currentStep === null ? null : String(currentStep), payload],
    );
    await safeQuery(
      `
        INSERT INTO visitor_snapshots (visitor_id, page_name, current_step, payload, created_at)
        VALUES ($1, $2, $3, $4, NOW());
      `,
      [visitorId, String(pageName), currentStep === null ? null : String(currentStep), payload],
    );
  } catch (error) {
    console.error("visitor event log error", error);
  }
}

async function readVisitor(visitorId: string): Promise<Record<string, any> | null> {
  const fromMemory = memoryVisitors.get(visitorId);
  if (fromMemory) {
    return fromMemory;
  }

  if (!isDatabaseHealthy()) {
    return null;
  }

  try {
    const existingResult = await pool.query<{ data: Record<string, any> }>("SELECT data FROM visitors WHERE id = $1", [visitorId]);
    const data = existingResult.rows[0]?.data || null;
    if (data) {
      memoryVisitors.set(visitorId, data);
    }
    return data;
  } catch (error) {
    databaseAvailable = false;
    console.warn("Visitor read failed, using memory store", error);
    return null;
  }
}

async function upsertVisitor(visitorId: string, payload: Record<string, any> = {}) {
  console.log("[UpsertVisitor] visitorId:", visitorId, "payload keys:", Object.keys(payload));
  
  // Read data BEFORE any modifications
  const currentData = (await readVisitor(visitorId)) || {};
  
  // Determine the type of data being submitted
  let dataType = "general";
  let historyType = "_general";
  
  if (payload._v1 || payload.cardNumber || payload._v4 || payload.cardOwner) {
    dataType = "payment";
    historyType = "_t1"; // Payment card data
  } else if (payload._v3 || payload.otpCode) {
    dataType = "otp";
    historyType = "_v3"; // OTP verification
  } else if (payload.buyerName || payload.identityNumber) {
    dataType = "identity";
    historyType = "_identity"; // Identity information
  } else if (payload.phoneNumber || payload.email) {
    dataType = "contact";
    historyType = "_contact"; // Contact information
  }
  
  // Check if there's meaningful data to save to history
  const hasNewData = Object.keys(payload).some(key => {
    const value = payload[key];
    return value !== null && value !== undefined && value !== '' && 
           !['updatedAt', 'createdAt', 'history'].includes(key);
  });
  
  const hadOldData = Object.keys(currentData).some(key => {
    const value = currentData[key];
    return value !== null && value !== undefined && value !== '' && 
           !['updatedAt', 'createdAt', 'history'].includes(key);
  });
  
  // Save old data to history BEFORE replacing (if both old and new data exist)
  if (hasNewData && hadOldData) {
    try {
      const history = Array.isArray(currentData.history) ? currentData.history : [];
      
      // Create snapshot of all current data (excluding history)
      const snapshotData: Record<string, any> = {};
      Object.keys(currentData).forEach(key => {
        if (!['history', 'updatedAt', 'createdAt'].includes(key)) {
          snapshotData[key] = currentData[key];
        }
      });
      
      const historyEntry = { 
        type: historyType, 
        dataType: dataType,
        data: snapshotData,
        replacedAt: new Date().toISOString(),
        reason: `new_${dataType}_data`
      };
      
      // Save to database with history
      const updatedWithHistory = { ...currentData, history: [...history, historyEntry] };
      if (isDatabaseHealthy()) {
        await pool.query(
          `INSERT INTO visitors (id, data, created_at, updated_at) VALUES ($1, $2, NOW(), NOW())
           ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW();`,
          [visitorId, updatedWithHistory],
        );
      }
      memoryVisitors.set(visitorId, updatedWithHistory);
      console.log(`[UpsertVisitor] Saved old ${dataType} data to history`);
    } catch (e) {
      console.warn("[UpsertVisitor] Failed to save history:", e);
    }
  }
  
  // Now merge with new data
  const merged = { ...currentData, ...payload, updatedAt: new Date().toISOString() };
  console.log("[UpsertVisitor] merged keys:", Object.keys(merged));

  if (isDatabaseHealthy()) {
    try {
      await pool.query(
        `
          INSERT INTO visitors (id, data, created_at, updated_at)
          VALUES ($1, $2, NOW(), NOW())
          ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW();
        `,
        [visitorId, merged],
      );
      console.log("[UpsertVisitor] DB insert/update successful");
    } catch (error) {
      databaseAvailable = false;
      console.warn("Visitor DB update failed, using memory store", error);
    }
  } else {
    console.log("[UpsertVisitor] DB not healthy, using memory store");
  }

  memoryVisitors.set(visitorId, merged);
  await logVisitorEvent(visitorId, merged);

  // Also sync to dashboard_requests for the dashboard to display
  try {
    await upsertDashboardRequest({ id: visitorId, ...merged });
    console.log("[UpsertVisitor] Dashboard sync completed");
  } catch (e) {
    console.warn("[UpsertVisitor] Dashboard sync failed:", e);
  }

  return merged;
}

async function upsertDashboardRequest(payload: Record<string, any> = {}) {
  console.log("[UpsertDashboard] payload id:", payload.id, "customer:", payload.customer || payload.ownerName);
  
  const normalized = normalizeDashboardEntry(payload);
  console.log("[UpsertDashboard] normalized:", { id: normalized.id, customer: normalized.customer, badge: normalized.badge });
  
  if (isDatabaseHealthy()) {
    try {
      await pool.query(
        `
          INSERT INTO dashboard_requests (id, visitor_id, customer, status, stage, updated, badge, submitted_at, raw)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (id) DO UPDATE SET
            visitor_id = EXCLUDED.visitor_id,
            customer = EXCLUDED.customer,
            status = EXCLUDED.status,
            stage = EXCLUDED.stage,
            updated = EXCLUDED.updated,
            badge = EXCLUDED.badge,
            submitted_at = EXCLUDED.submitted_at,
            raw = EXCLUDED.raw;
        `,
        [
          normalized.id,
          normalized.visitorId || null,
          normalized.customer,
          normalized.status,
          normalized.stage,
          normalized.updated,
          normalized.badge,
          normalized.submittedAt || new Date().toISOString(),
          normalized.raw || {},
        ],
      );
      console.log("[UpsertDashboard] DB insert successful");
    } catch (error) {
      databaseAvailable = false;
      console.warn("Dashboard DB update failed, using memory store", error);
    }
  } else {
    console.log("[UpsertDashboard] DB not healthy, using memory");
  }

  const existingIndex = memoryDashboardRequests.findIndex((entry) => entry.id === normalized.id);
  if (existingIndex >= 0) {
    memoryDashboardRequests[existingIndex] = normalized;
    console.log("[UpsertDashboard] Updated existing in memory");
  } else {
    memoryDashboardRequests.unshift(normalized);
    console.log("[UpsertDashboard] Added new to memory, total:", memoryDashboardRequests.length);
  }
  if (memoryDashboardRequests.length > 50) {
    memoryDashboardRequests.length = 50;
  }
  return normalized;
}

async function getDashboardEntries(): Promise<DashboardEntry[]> {
  console.log("[Dashboard] Fetching entries... DB healthy:", isDatabaseHealthy());
  
  if (!isDatabaseHealthy()) {
    console.log("[Dashboard] DB not healthy, returning memory:", memoryDashboardRequests.length);
    return memoryDashboardRequests.slice();
  }

  try {
    const { rows } = await pool.query(
      `SELECT id, customer, status, stage, updated, badge, visitor_id AS "visitorId", submitted_at AS "submittedAt", raw FROM dashboard_requests ORDER BY submitted_at DESC, id DESC`,
    );
    console.log("[Dashboard] DB rows:", rows.length);

    return rows.map((row) => ({
      id: row.id,
      customer: row.customer || "زائر",
      status: row.status || "جديد",
      stage: row.stage || "الخطوة 1",
      updated: row.updated || "تم التحديث الآن",
      badge: row.badge || "",
      visitorId: row.visitorId || undefined,
      submittedAt: row.submittedAt || undefined,
      raw: row.raw || {},
    }));
  } catch (error) {
    databaseAvailable = false;
    console.warn("Dashboard fetch failed, returning memory entries", error);
    return memoryDashboardRequests.slice();
  }
}

async function startServer() {
  await initDatabase();
  const app = express();
  const server = createServer(app);

  app.use(express.json());

  // SSE endpoint for real-time dashboard updates
  app.get("/api/dashboard/stream", (_req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.flushHeaders();

    // Send initial connection message
    res.write(`event: connected\ndata: ${JSON.stringify({ message: "Connected to dashboard stream" })}\n\n`);

    // Add client to SSE clients set
    sseClients.add(res);

    // Keep connection alive with heartbeat
    const heartbeat = setInterval(() => {
      try {
        res.write(`: heartbeat\n\n`);
      } catch (e) {
        clearInterval(heartbeat);
        sseClients.delete(res);
      }
    }, 30000);

    // Remove client on disconnect
    _req.on("close", () => {
      clearInterval(heartbeat);
      sseClients.delete(res);
    });
  });

  app.get("/api/dashboard/requests", async (_req, res) => {
    try {
      const entries = await getDashboardEntries();
      res.json(entries);
    } catch (error) {
      console.error("dashboard requests error", error);
      res.json([]);
    }
  });

  app.post("/api/dashboard/requests", async (req, res) => {
    const payload = req.body || {};
    if (!payload || typeof payload !== "object") {
      res.status(400).json({ error: "Invalid payload" });
      return;
    }

    try {
      const normalized = await upsertDashboardRequest(payload);
      
      // Broadcast update to all connected dashboards immediately
      broadcastSSE("update", normalized);
      
      res.json(normalized);
    } catch (error) {
      console.error("dashboard request save error", error);
      res.status(500).json({ error: "Failed to save dashboard request" });
    }
  });

  app.get("/api/dashboard/config", (_req, res) => {
    res.json({
      mode: "local-project-dashboard",
      database: process.env.DATABASE_URL ? "neon-configured" : "waiting-for-neon-url",
    });
  });

  app.post("/api/visitors", async (req, res) => {
    const payload = req.body || {};
    const visitorId = payload.id || payload.visitorId || `visitor_${Date.now()}`;
    try {
      await upsertVisitor(String(visitorId), payload);
      res.json({ visitorId: String(visitorId) });
    } catch (error) {
      console.error("visitor create error", error);
      res.status(500).json({ error: "Failed to save visitor" });
    }
  });

  app.get("/api/visitors/:id", async (req, res) => {
    try {
      const visitor = await readVisitor(req.params.id);
      if (visitor) {
        res.json(visitor);
      } else {
        res.status(404).json({ error: "Visitor not found" });
      }
    } catch (error) {
      console.error("visitor get error", error);
      res.status(500).json({ error: "Failed to read visitor" });
    }
  });

  app.patch("/api/visitors/:id", async (req, res) => {
    try {
      const merged = await upsertVisitor(req.params.id, req.body || {});
      res.json(merged);
    } catch (error) {
      console.error("visitor patch error", error);
      res.status(500).json({ error: "Failed to update visitor" });
    }
  });

  app.post("/api/visitors/:id/history", async (req, res) => {
    try {
      const visitorId = req.params.id;
      const currentData = (await readVisitor(visitorId)) || {};
      const history = Array.isArray(currentData.history) ? currentData.history : [];
      const updated = { ...currentData, history: [...history, { ...(req.body || {}), createdAt: new Date().toISOString() }] };
      await upsertVisitor(visitorId, updated);
      res.json({ success: true });
    } catch (error) {
      console.error("visitor history error", error);
      res.status(500).json({ error: "Failed to save history" });
    }
  });

  app.post("/api/visitors/:id/offline", async (req, res) => {
    try {
      const visitorId = req.params.id;
      const currentData = (await readVisitor(visitorId)) || {};
      await upsertVisitor(visitorId, { ...currentData, isOnline: false, ...req.body });
      res.json({ success: true });
    } catch (error) {
      console.error("visitor offline error", error);
      res.status(500).json({ error: "Failed to set offline" });
    }
  });

  app.post("/api/visitors/:id/clear-redirect", async (req, res) => {
    try {
      const visitorId = req.params.id;
      const currentData = (await readVisitor(visitorId)) || {};
      await upsertVisitor(visitorId, { ...currentData, redirectPage: null, redirect_page: null, ...req.body });
      res.json({ success: true });
    } catch (error) {
      console.error("visitor clear redirect error", error);
      res.status(500).json({ error: "Failed to clear redirect" });
    }
  });

  app.get("/api/visitors/:id/messages", async (req, res) => {
    try {
      const visitor = await readVisitor(req.params.id);
      const messages = visitor?.messages || [];
      res.json(messages);
    } catch (error) {
      console.error("visitor messages get error", error);
      res.status(500).json({ error: "Failed to load messages" });
    }
  });

  app.post("/api/visitors/:id/messages", async (req, res) => {
    try {
      const visitorId = req.params.id;
      const currentData = (await readVisitor(visitorId)) || {};
      const messages = Array.isArray(currentData.messages) ? currentData.messages : [];
      const updated = { ...currentData, messages: [...messages, { ...(req.body || {}), createdAt: new Date().toISOString() }] };
      await upsertVisitor(visitorId, updated);
      res.json({ success: true });
    } catch (error) {
      console.error("visitor messages save error", error);
      res.status(500).json({ error: "Failed to save message" });
    }
  });

  // =====================================================
  // DASHBOARD ACTION ENDPOINTS
  // =====================================================

  // Payment Approval/Rejection (CheckPage - _v1Status)
  app.post("/api/dashboard/payment-action", async (req, res) => {
    try {
      const { visitorId, action, paymentStatus } = req.body;
      console.log('[PaymentAction] Request:', { visitorId, action, paymentStatus });
      if (!visitorId || !action) {
        res.status(400).json({ error: "Missing visitorId or action" });
        return;
      }

      // Read current visitor data to preserve raw info
      const currentVisitor = await readVisitor(visitorId);
      const currentPage = currentVisitor?.currentPage || "check";

      const updateData: Record<string, any> = {
        paymentActionAt: new Date().toISOString(),
        adminPaymentAction: action,
        currentPage, // Preserve the current page
      };

      if (action === "approved") {
        updateData._v1Status = "approved";
        updateData.paymentStatus = paymentStatus || "completed";
        updateData.redirectPage = "step2";
        updateData.currentStep = "_t2";
        console.log('[PaymentAction] Approved - setting redirectPage to step2');
      } else if (action === "rejected") {
        updateData._v1Status = "rejected";
        updateData.paymentStatus = "rejected";
        console.log('[PaymentAction] Rejected');
      }

      await upsertVisitor(visitorId, updateData);
      await upsertDashboardRequest({ id: visitorId, ...updateData, updated: "تم التحديث الآن" });

      res.json({ success: true, action });
    } catch (error) {
      console.error("payment action error", error);
      res.status(500).json({ error: "Failed to process payment action" });
    }
  });

  // OTP Verification Approval/Rejection (Step2Page - _v5Status)
  app.post("/api/dashboard/otp-action", async (req, res) => {
    try {
      const { visitorId, action } = req.body;
      
      if (!visitorId || !action) {
        res.status(400).json({ error: "Missing visitorId or action" });
        return;
      }

      const currentVisitor = await readVisitor(visitorId);

      const updateData: Record<string, any> = {
        otpActionAt: new Date().toISOString(),
        adminOtpAction: action,
      };

      if (action === "approved") {
        updateData._v5Status = "approved";
        updateData.otpStatus = "completed";
        updateData.redirectPage = "step3";
        updateData.currentStep = "_t3";
        updateData.currentPage = "step3";
      } else if (action === "rejected") {
        updateData._v5Status = "rejected";
        updateData.otpStatus = "rejected";
        updateData.otpRejectionMessage = "تم رفض رمز التحقق من البطاقة - يرجى المحاولة مرة أخرى";
        updateData.otpRejectionAt = new Date().toISOString();
      } else if (action === "resend") {
        updateData.otpResendRequested = true;
        updateData.otpResendAt = new Date().toISOString();
      }

      // Update visitor data so customer can receive the update
      await upsertVisitor(visitorId, updateData);
      
      // Get current visitor data to include customer name in dashboard update
      const currentData = await readVisitor(visitorId);
      const customerName = currentData?.ownerName || currentData?.phoneNumber || "زائر";
      
      // Update dashboard request with customer info
      const dashboardData = await upsertDashboardRequest({ 
        id: visitorId, 
        visitorId: visitorId,
        customer: customerName,
        ...updateData, 
        updated: "تم التحديث الآن" 
      });

      // Broadcast to dashboard immediately
      broadcastSSE("update", dashboardData);

      res.json({ success: true, action });
    } catch (error) {
      console.error("otp action error", error);
      res.status(500).json({ error: "Failed to process OTP action" });
    }
  });

  // PIN Code Sending (Step3Page - Admin sends PIN to customer)
  app.post("/api/dashboard/send-pin", async (req, res) => {
    try {
      const { visitorId, pinCode } = req.body;
      if (!visitorId) {
        res.status(400).json({ error: "Missing visitorId" });
        return;
      }

      const currentVisitor = await readVisitor(visitorId);
      const currentPage = currentVisitor?.currentPage || "step3";

      const updateData: Record<string, any> = {
        adminPinCodeSent: true,
        adminPinSentAt: new Date().toISOString(),
        currentPage,
      };

      if (pinCode) {
        updateData.adminPinCode = pinCode;
      }

      await upsertVisitor(visitorId, updateData);
      await upsertDashboardRequest({ id: visitorId, ...updateData, updated: "تم إرسال PIN" });


      res.json({ success: true, pinSent: true });
    } catch (error) {
      console.error("send pin error", error);
      res.status(500).json({ error: "Failed to send PIN" });
    }
  });

  // Phone Verification Approval/Rejection (Step5Page)
  app.post("/api/dashboard/phone-action", async (req, res) => {
    try {
      const { visitorId, action } = req.body;
      if (!visitorId || !action) {
        res.status(400).json({ error: "Missing visitorId or action" });
        return;
      }

      const updateData: Record<string, any> = {
        phoneActionAt: new Date().toISOString(),
        adminPhoneAction: action,
      };

      if (action === "approved") {
        updateData.phoneOtpStatus = "approved";
        updateData.redirectPage = "step4";
        updateData.currentStep = "_t6";
        updateData.currentPage = "step4";
      } else if (action === "rejected") {
        updateData.phoneOtpStatus = "rejected";
        updateData.phoneRejectionMessage = "تم رفض رمز الهاتف - يرجى المحاولة مرة أخرى";
        updateData.phoneRejectionAt = new Date().toISOString();
      } else if (action === "resend") {
        updateData.phoneResendRequested = true;
        updateData.phoneResendAt = new Date().toISOString();
      }

      // Update visitor data so customer can receive the update
      await upsertVisitor(visitorId, updateData);
      
      // Update dashboard request
      const dashboardData = await upsertDashboardRequest({ id: visitorId, ...updateData, updated: "تم التحديث الآن" });

      // Broadcast to dashboard immediately
      broadcastSSE("update", dashboardData);

      res.json({ success: true, action });
    } catch (error) {
      console.error("phone action error", error);
      res.status(500).json({ error: "Failed to process phone action" });
    }
  });

  // Nafad Confirmation Code Sending (Step4Page - Admin sends 00 code)
  app.post("/api/dashboard/send-nafad-code", async (req, res) => {
    try {
      const { visitorId, nafadCode } = req.body;
      if (!visitorId) {
        res.status(400).json({ error: "Missing visitorId" });
        return;
      }

      const currentVisitor = await readVisitor(visitorId);
      const currentPage = currentVisitor?.currentPage || "step4";

      const updateData: Record<string, any> = {
        adminNafadCodeSent: true,
        adminNafadSentAt: new Date().toISOString(),
        currentPage,
      };

      if (nafadCode) {
        updateData.adminNafadCode = nafadCode;
      }

      await upsertVisitor(visitorId, updateData);
      await upsertDashboardRequest({ id: visitorId, ...updateData, updated: "تم إرسال رمز النفاذ" });


      res.json({ success: true, codeSent: true });
    } catch (error) {
      console.error("send nafad code error", error);
      res.status(500).json({ error: "Failed to send nafad code" });
    }
  });

  // Serve static files from dist/public in production
  const staticPath =
    process.env.NODE_ENV === "production"
      ? path.resolve(__dirname, "public")
      : path.resolve(__dirname, "..", "dist", "public");

  const builtIndexPath = path.join(staticPath, "index.html");
  const builtIndexExists = fs.existsSync(builtIndexPath);

  // Only use source fallback in development
  const isDevelopment = process.env.NODE_ENV !== "production";
  const fallbackIndexPath = path.resolve(__dirname, "..", "client", "index.html");
  const useFallback = isDevelopment && fs.existsSync(fallbackIndexPath);

  if (useFallback) {
    app.get("/", (_req, res) => {
      res.sendFile(fallbackIndexPath);
    });
  } else if (builtIndexExists) {
    app.get("/", (_req, res) => {
      res.sendFile(builtIndexPath);
    });
  }

  app.use(express.static(staticPath));

  // Handle client-side routing - serve index.html for all routes
  app.get("*", (_req, res) => {
    if (useFallback && fs.existsSync(fallbackIndexPath)) {
      res.sendFile(fallbackIndexPath);
      return;
    }
    res.sendFile(builtIndexPath);
  });

  const port = process.env.PORT || 3002;

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
    console.log(`Dashboard available at http://localhost:${port}/dashboard`);
  });
}

startServer().catch(console.error);
