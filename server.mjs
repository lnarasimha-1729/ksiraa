import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { randomBytes, scryptSync, timingSafeEqual, privateDecrypt, createDecipheriv, createCipheriv, constants as cryptoConstants } from "node:crypto";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
loadEnvFile(join(root, ".env"));

// WhatsApp Flows private key (PEM), used to decrypt the encrypted data-exchange requests.
let flowPrivateKey = "";
try {
  const keyPath = process.env.WHATSAPP_FLOW_PRIVATE_KEY_PATH;
  if (keyPath) flowPrivateKey = readFileSync(join(root, keyPath), "utf8");
} catch (e) {
  console.warn("[Flows] private key not loaded:", e.message);
}
const flowId = process.env.WHATSAPP_FLOW_ID || "";

const { pool, query, one, initSchema } = await import("./db.mjs");

const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || (process.env.PORT ? "0.0.0.0" : "127.0.0.1");
const adminPhone = process.env.ADMIN_PHONE || "9999999999";
const adminPassword = process.env.ADMIN_PASSWORD || "ksiraa2468";
const ownerWhatsApp = process.env.OWNER_WHATSAPP || "919999999999";
const publicBaseUrl = process.env.PUBLIC_BASE_URL || `http://${host}:${port}`;
const sessionTtlMs = 1000 * 60 * 60 * 24 * 30;
const otpTtlMs = 1000 * 60 * 10;

const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png"
};

const defaultProducts = [
  { id: "ghee-500", name: "Pure Desi Ghee", size: "500 g jar", price: 699, description: "Traditional ghee made from high fat milk.", soldOut: false },
  { id: "butter-250", name: "Fresh Butter", size: "250 g pack", price: 220, description: "Small-batch white butter for daily cooking.", soldOut: false },
  { id: "skim-milk-1l", name: "Skim Milk", size: "1 litre", price: 70, description: "Light milk for tea, coffee, and everyday use.", soldOut: false },
  { id: "cottage-cheese-200", name: "Cottage Cheese", size: "200 g cup", price: 160, description: "Soft, fresh cottage cheese with a mild taste.", soldOut: false },
  { id: "paneer-250", name: "Paneer", size: "250 g block", price: 190, description: "Fresh paneer for curries, snacks, and grilling.", soldOut: false }
];

await initSchema();
await seedDefaults();

const httpServer = createServer(async (request, response) => {
  try {
    if (request.url?.startsWith("/api/")) {
      await handleApi(request, response);
      return;
    }
    serveStatic(request, response);
  } catch (error) {
    if (error.status) {
      json(response, error.status, { error: error.message });
      return;
    }
    console.error(error);
    json(response, 500, { error: "Something went wrong. Please try again." });
  }
});

httpServer.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`\n[startup] Port ${port} is already in use — another instance is probably still running.`);
    console.error(`[startup] Stop it first, then start again. On Windows (PowerShell):`);
    console.error(`[startup]   Get-NetTCPConnection -LocalPort ${port} -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }`);
    console.error(`[startup] Or set a different port:  $env:PORT=4174; node server.mjs\n`);
    process.exit(1);
  }
  console.error("[startup] Server error:", error);
  process.exit(1);
});

httpServer.listen(port, host, () => {
  console.log(`KSiraa app running at http://${host}:${port}`);
  console.log(`Admin phone: ${adminPhone}`);
  console.log("Set ADMIN_PASSWORD and OWNER_WHATSAPP before public hosting.");
  console.log(`MySQL host: ${process.env.DB_HOST}/${process.env.DB_NAME}`);
});

async function seedDefaults() {
  const adminRow = await one("SELECT id FROM admin WHERE id = 1");
  if (!adminRow) {
    await query("INSERT INTO admin (id, phone, password_hash) VALUES (1, ?, ?)", [adminPhone, hashPassword(adminPassword)]);
  } else if (process.env.ADMIN_PHONE || process.env.ADMIN_PASSWORD) {
    await query("UPDATE admin SET phone = ?, password_hash = ? WHERE id = 1", [adminPhone, hashPassword(adminPassword)]);
  }

  const ownerRow = await one("SELECT `value` FROM meta WHERE `key` = 'ownerWhatsApp'");
  if (!ownerRow) {
    await query("INSERT INTO meta (`key`, `value`) VALUES ('ownerWhatsApp', ?)", [ownerWhatsApp]);
  } else if (process.env.OWNER_WHATSAPP) {
    await query("UPDATE meta SET `value` = ? WHERE `key` = 'ownerWhatsApp'", [ownerWhatsApp]);
  }

  const [{ count }] = await query("SELECT COUNT(*) AS count FROM products");
  if (Number(count) === 0) {
    let order = 0;
    for (const p of defaultProducts) {
      await query(
        "INSERT INTO products (id, name, size, price, description, sold_out, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [p.id, p.name, p.size, p.price, p.description, p.soldOut ? 1 : 0, order++]
      );
    }
  }

  const [{ count: noticeCount }] = await query("SELECT COUNT(*) AS count FROM notices");
  if (Number(noticeCount) === 0) {
    await query(
      "INSERT INTO notices (id, title, message) VALUES (?, ?, ?)",
      [id("notice"), "Welcome to KSiraa", "Place your order and adjust it any time before delivery."]
    );
  }
}

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^"|"$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

async function getOwnerWhatsApp() {
  const row = await one("SELECT `value` FROM meta WHERE `key` = 'ownerWhatsApp'");
  return row?.value || ownerWhatsApp;
}

async function getAdmin() {
  const row = await one("SELECT phone, password_hash FROM admin WHERE id = 1");
  return row || { phone: adminPhone, password_hash: hashPassword(adminPassword) };
}

function productRowToApi(row) {
  return {
    id: row.id,
    name: row.name,
    size: row.size,
    price: row.price,
    description: row.description,
    imageUrl: row.image_url || "",
    soldOut: Boolean(row.sold_out)
  };
}

function orderRowToApi(row) {
  return {
    id: row.id,
    customerId: row.customer_id,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    address: row.address,
    frequency: row.frequency,
    deliveryTime: row.delivery_time,
    paymentMethod: row.payment_method,
    paymentStatus: row.payment_status,
    paymentUrl: row.payment_url,
    status: row.status,
    items: typeof row.items_json === "string" ? JSON.parse(row.items_json) : row.items_json,
    total: row.total,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at
  };
}

function customerRowToApi(row) {
  return {
    id: row.id,
    phone: row.phone,
    name: row.name,
    address: row.address,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
  };
}

function noticeRowToApi(row) {
  return {
    id: row.id,
    title: row.title,
    message: row.message,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
  };
}

async function handleApi(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const route = `${request.method} ${url.pathname}`;

  if (route === "GET /api/config") {
    const admin = await getAdmin();
    json(response, 200, {
      ownerWhatsApp: await getOwnerWhatsApp(),
      adminPhone: admin.phone,
      publicBaseUrl,
      legal: {
        privacy: `${publicBaseUrl}/privacy.html`,
        terms: `${publicBaseUrl}/terms.html`
      },
      smsConfigured: Boolean(process.env.SMS_PROVIDER_URL),
      whatsappConfigured: Boolean(process.env.WHATSAPP_API_URL),
      onlinePaymentConfigured: Boolean(process.env.PAYMENT_PROVIDER_URL),
      httpsConfigured: publicBaseUrl.startsWith("https://")
    });
    return;
  }

  if (route === "GET /api/webhooks/whatsapp") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    const expected = process.env.WHATSAPP_VERIFY_TOKEN || "ksiraa_verify_token";
    if (mode === "subscribe" && token === expected) {
      console.log("[WhatsApp] Webhook verified");
      response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(challenge || "");
      return;
    }
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }

  if (route === "POST /api/webhooks/whatsapp") {
    let body = {};
    try { body = await readJson(request); } catch { body = {}; }
    recordWebhookHit(body);
    json(response, 200, { ok: true });
    handleWhatsAppWebhook(body).catch((err) => console.error("[WhatsApp] webhook handler error:", err));
    return;
  }

  // TEMPORARY debug: shows the last few webhook hits so you can confirm Meta is delivering.
  // Open https://ksiraa.com/api/webhooks/whatsapp/debug?key=ksiraa_verify_token in a browser.
  if (route === "GET /api/webhooks/whatsapp/debug") {
    if (url.searchParams.get("key") !== (process.env.WHATSAPP_VERIFY_TOKEN || "ksiraa_verify_token")) {
      response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Forbidden");
      return;
    }
    json(response, 200, { count: webhookHits.length, hits: webhookHits });
    return;
  }

  // WhatsApp Flows encrypted data-exchange endpoint.
  if (route === "POST /api/flows/whatsapp") {
    await handleFlowDataExchange(request, response);
    return;
  }

  if (route === "GET /api/products") {
    const rows = await query("SELECT * FROM products ORDER BY sort_order ASC, created_at ASC");
    json(response, 200, { products: rows.map(productRowToApi) });
    return;
  }

  if (route === "GET /api/notices") {
    const rows = await query("SELECT * FROM notices ORDER BY created_at DESC LIMIT 10");
    json(response, 200, { notices: rows.map(noticeRowToApi) });
    return;
  }

  if (route === "GET /api/orders") {
    const rows = await query(
      "SELECT * FROM orders ORDER BY created_at DESC LIMIT 100"
    );
    json(response, 200, { orders: rows.map(orderRowToApi) });
    return;
  }

  if (route === "POST /api/orders") {
    const body = await readJson(request);
    const phone = cleanPhone(body.phone);
    if (!phone) throw httpError(400, "Enter a valid mobile number.");
    const name = cleanText(body.name, 80);
    const address = cleanText(body.address, 300);
    if (!name || !address) throw httpError(400, "Name and delivery address are required.");

    let customer = await one("SELECT * FROM customers WHERE phone = ?", [phone]);
    if (!customer) {
      const newId = id("cust");
      await query("INSERT INTO customers (id, phone, name, address) VALUES (?, ?, ?, ?)", [newId, phone, name, address]);
      customer = await one("SELECT * FROM customers WHERE id = ?", [newId]);
    } else {
      await query("UPDATE customers SET name = ?, address = ? WHERE id = ?", [name, address, customer.id]);
    }

    const order = await buildOrder(customer.id, body);
    if (order.paymentMethod === "Online payment") {
      if (!process.env.PAYMENT_PROVIDER_URL) {
        throw httpError(400, "Online payment is not configured yet. Please choose cash or UPI on delivery.");
      }
      const payment = await createPayment(order);
      order.paymentUrl = payment.paymentUrl;
      order.paymentStatus = "Payment link created";
    }
    await query(
      `INSERT INTO orders (id, customer_id, customer_name, customer_phone, address, frequency, delivery_time, payment_method, payment_status, payment_url, status, items_json, total)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        order.id, order.customerId, order.customerName, order.customerPhone, order.address,
        order.frequency, order.deliveryTime, order.paymentMethod, order.paymentStatus, order.paymentUrl,
        order.status, JSON.stringify(order.items), order.total
      ]
    );
    const saved = await one("SELECT * FROM orders WHERE id = ?", [order.id]);
    json(response, 201, { order: orderRowToApi(saved) });
    getOwnerWhatsApp()
      .then((number) => sendWhatsApp(number, orderToOwnerMessage(orderRowToApi(saved))))
      .catch((err) => console.error("WhatsApp notify failed:", err));
    return;
  }

  if (route === "POST /api/admin/login") {
    const body = await readJson(request);
    const phone = cleanPhone(body.phone);
    const admin = await getAdmin();
    if (phone !== admin.phone || !verifyPassword(String(body.password || ""), admin.password_hash)) {
      return json(response, 401, { error: "Incorrect admin login." });
    }
    const session = createSession("admin", "owner");
    await insertSession(session);
    json(response, 200, { token: session.token });
    return;
  }

  if (route === "GET /api/admin/dashboard") {
    await requireSession(request, "admin");
    const [products, orders, customers, notices] = await Promise.all([
      query("SELECT * FROM products ORDER BY sort_order ASC, created_at ASC"),
      query("SELECT * FROM orders ORDER BY created_at DESC"),
      query("SELECT * FROM customers ORDER BY created_at DESC"),
      query("SELECT * FROM notices ORDER BY created_at DESC LIMIT 20")
    ]);
    json(response, 200, {
      products: products.map(productRowToApi),
      orders: orders.map(orderRowToApi),
      customers: customers.map(customerRowToApi),
      notices: notices.map(noticeRowToApi)
    });
    return;
  }

  if (route === "POST /api/admin/products") {
    await requireSession(request, "admin");
    const body = await readJson(request);
    const product = validateProduct(body);
    const [{ maxOrder }] = await query("SELECT COALESCE(MIN(sort_order), 0) - 1 AS maxOrder FROM products");
    await query(
      "INSERT INTO products (id, name, size, price, description, image_url, sold_out, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [product.id, product.name, product.size, product.price, product.description, product.imageUrl, product.soldOut ? 1 : 0, maxOrder]
    );
    const row = await one("SELECT * FROM products WHERE id = ?", [product.id]);
    json(response, 201, { product: productRowToApi(row) });
    return;
  }

  if (request.method === "PATCH" && url.pathname.startsWith("/api/admin/products/")) {
    await requireSession(request, "admin");
    const existing = await findProduct(url.pathname);
    const body = await readJson(request);
    const product = validateProduct({ ...productRowToApi(existing), ...body, id: existing.id });
    await query(
      "UPDATE products SET name = ?, size = ?, price = ?, description = ?, image_url = ?, sold_out = ? WHERE id = ?",
      [product.name, product.size, product.price, product.description, product.imageUrl, product.soldOut ? 1 : 0, product.id]
    );
    const row = await one("SELECT * FROM products WHERE id = ?", [product.id]);
    json(response, 200, { product: productRowToApi(row) });
    return;
  }

  if (request.method === "DELETE" && url.pathname.startsWith("/api/admin/products/")) {
    await requireSession(request, "admin");
    const existing = await findProduct(url.pathname);
    await query("DELETE FROM products WHERE id = ?", [existing.id]);
    json(response, 200, { ok: true });
    return;
  }

  if (request.method === "PATCH" && url.pathname.startsWith("/api/admin/orders/")) {
    await requireSession(request, "admin");
    const existing = await findOrder(url.pathname);
    const body = await readJson(request);
    const allowed = ["Received", "Preparing", "Out for delivery", "Delivered", "Paused", "Cancelled"];
    if (!allowed.includes(body.status)) return json(response, 400, { error: "Invalid order status." });
    await query("UPDATE orders SET status = ?, updated_at = NOW() WHERE id = ?", [body.status, existing.id]);
    const row = await one("SELECT * FROM orders WHERE id = ?", [existing.id]);
    json(response, 200, { order: orderRowToApi(row) });
    return;
  }

  if (request.method === "DELETE" && url.pathname.startsWith("/api/admin/orders/")) {
    await requireSession(request, "admin");
    const existing = await findOrder(url.pathname);
    await query("DELETE FROM orders WHERE id = ?", [existing.id]);
    json(response, 200, { ok: true });
    return;
  }

  if (request.method === "DELETE" && url.pathname.startsWith("/api/admin/customers/")) {
    await requireSession(request, "admin");
    const customerId = decodeURIComponent(url.pathname.split("/").pop() || "");
    const existing = await one("SELECT * FROM customers WHERE id = ?", [customerId]);
    if (!existing) return json(response, 404, { error: "Customer not found." });
    await query("DELETE FROM customers WHERE id = ?", [existing.id]);
    json(response, 200, { ok: true });
    return;
  }

  if (request.method === "PATCH" && url.pathname.startsWith("/api/admin/customers/")) {
    await requireSession(request, "admin");
    const customerId = decodeURIComponent(url.pathname.split("/").pop() || "");
    const existing = await one("SELECT * FROM customers WHERE id = ?", [customerId]);
    if (!existing) return json(response, 404, { error: "Customer not found." });
    const body = await readJson(request);
    const name = cleanText(body.name ?? existing.name, 120);
    const phone = cleanPhone(body.phone ?? existing.phone);
    const address = cleanText(body.address ?? existing.address, 300);
    if (!name || !phone || !address) {
      return json(response, 400, { error: "Name, phone, and address are required." });
    }
    if (phone !== existing.phone) {
      const clash = await one("SELECT id FROM customers WHERE phone = ? AND id <> ?", [phone, existing.id]);
      if (clash) return json(response, 409, { error: "Another customer already uses this phone." });
    }
    await query(
      "UPDATE customers SET name = ?, phone = ?, address = ? WHERE id = ?",
      [name, phone, address, existing.id]
    );
    const row = await one("SELECT * FROM customers WHERE id = ?", [existing.id]);
    json(response, 200, { customer: customerRowToApi(row) });
    return;
  }

  if (route === "POST /api/admin/notices") {
    await requireSession(request, "admin");
    const body = await readJson(request);
    const title = cleanText(body.title, 100);
    const message = cleanText(body.message, 500);
    if (!title || !message) return json(response, 400, { error: "Title and message are required." });
    const noticeId = id("notice");
    await query("INSERT INTO notices (id, title, message) VALUES (?, ?, ?)", [noticeId, title, message]);
    const row = await one("SELECT * FROM notices WHERE id = ?", [noticeId]);
    const notice = noticeRowToApi(row);
    await sendWhatsAppBroadcast(notice);
    json(response, 201, { notice });
    return;
  }

  if (request.method === "DELETE" && url.pathname.startsWith("/api/admin/notices/")) {
    await requireSession(request, "admin");
    const noticeId = decodeURIComponent(url.pathname.split("/").pop() || "");
    const existing = await one("SELECT * FROM notices WHERE id = ?", [noticeId]);
    if (!existing) return json(response, 404, { error: "Update not found." });
    await query("DELETE FROM notices WHERE id = ?", [existing.id]);
    json(response, 200, { ok: true });
    return;
  }

  if (route === "POST /api/admin/whatsapp/send") {
    await requireSession(request, "admin");
    const body = await readJson(request);
    const title = cleanText(body.title, 100);
    const message = cleanText(body.message, 1000);
    if (!title || !message) return json(response, 400, { error: "Title and message are required." });
    const customerIds = Array.isArray(body.customerIds) ? body.customerIds : [];
    if (!customerIds.length) return json(response, 400, { error: "Select at least one customer." });

    const placeholders = customerIds.map(() => "?").join(",");
    const rows = await query(`SELECT id, phone, name FROM customers WHERE id IN (${placeholders})`, customerIds);
    const recipients = rows
      .map((r) => ({ phone: normalizeWhatsAppPhone(r.phone), name: (r.name || "Customer").trim() || "Customer" }))
      .filter((r) => r.phone);
    if (!recipients.length) return json(response, 400, { error: "No valid phone numbers in selection." });

    const result = await sendWhatsAppBroadcastTemplate(recipients, title, message);
    json(response, 200, {
      sent: result.sent,
      failed: result.failed,
      demo: Boolean(result.demo),
      failures: result.details?.failed || []
    });
    return;
  }

  json(response, 404, { error: "Not found." });
}

function serveStatic(request, response) {
  const url = new URL(request.url || "/", `http://${request.headers.host}`);
  const requested = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
  let filePath = join(root, requested === "/" ? "index.html" : requested);

  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(root, "index.html");
  }

  response.writeHead(200, {
    "Content-Type": types[extname(filePath)] || "application/octet-stream"
  });
  createReadStream(filePath).pipe(response);
}

async function buildOrder(customerId, body) {
  const customer = await one("SELECT * FROM customers WHERE id = ?", [customerId]);
  if (!customer) throw httpError(401, "Please login again.");

  const items = Array.isArray(body.items) ? body.items : [];
  const orderItems = [];
  for (const item of items) {
    const product = await one("SELECT * FROM products WHERE id = ?", [item.productId]);
    const qty = Number(item.qty);
    if (!product || product.sold_out || !Number.isInteger(qty) || qty < 1 || qty > 99) continue;
    orderItems.push({
      productId: product.id,
      name: product.name,
      size: product.size,
      qty,
      price: product.price,
      lineTotal: product.price * qty
    });
  }

  if (!orderItems.length) throw httpError(400, "Add at least one available product.");

  const total = orderItems.reduce((sum, item) => sum + item.lineTotal, 0);
  const name = cleanText(body.name || customer.name, 80);
  const address = cleanText(body.address || customer.address, 300);
  if (!name || !address) throw httpError(400, "Name and delivery address are required.");

  await query("UPDATE customers SET name = ?, address = ? WHERE id = ?", [name, address, customer.id]);

  return {
    id: await nextOrderId(),
    customerId,
    customerName: name,
    customerPhone: customer.phone,
    address,
    frequency: cleanChoice(body.frequency, ["Every day", "Weekly", "Twice a week", "Monthly", "One time"], "Weekly"),
    deliveryTime: cleanChoice(body.deliveryTime, ["Morning", "Evening", "Any time"], "Evening"),
    paymentMethod: cleanChoice(body.paymentMethod, ["Cash on delivery", "UPI on delivery", "Online payment"], "Cash on delivery"),
    paymentStatus: body.paymentMethod === "Online payment" ? "Pending online payment" : "Pending",
    paymentUrl: "",
    status: "Received",
    items: orderItems,
    total
  };
}

function validateProduct(body) {
  const product = {
    id: body.id || id("prod"),
    name: cleanText(body.name, 80),
    size: cleanText(body.size, 40),
    price: Number(body.price),
    description: cleanText(body.description, 250),
    imageUrl: cleanText(body.imageUrl, 480),
    soldOut: Boolean(body.soldOut)
  };
  if (!product.name || !product.size || !Number.isFinite(product.price) || product.price <= 0) {
    throw httpError(400, "Product name, pack size, and price are required.");
  }
  if (!product.description) product.description = "Fresh KSiraa dairy product.";
  product.price = Math.round(product.price);
  return product;
}

async function requireSession(request, role) {
  await query("DELETE FROM sessions WHERE expires_at <= NOW()");
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!token) throw httpError(401, "Please login again.");
  const session = await one(
    "SELECT * FROM sessions WHERE token = ? AND role = ? AND expires_at > NOW()",
    [token, role]
  );
  if (!session) throw httpError(401, "Please login again.");
  await query("UPDATE sessions SET expires_at = FROM_UNIXTIME(? / 1000) WHERE token = ?", [Date.now() + sessionTtlMs, token]);
  return session;
}

function createSession(role, userId) {
  return {
    token: randomBytes(32).toString("hex"),
    role,
    userId,
    expiresAt: Date.now() + sessionTtlMs
  };
}

async function insertSession(session) {
  await query(
    "INSERT INTO sessions (token, role, user_id, expires_at) VALUES (?, ?, ?, FROM_UNIXTIME(? / 1000))",
    [session.token, session.role, session.userId, session.expiresAt]
  );
}

async function findProduct(pathname) {
  const productId = decodeURIComponent(pathname.split("/").pop() || "");
  const product = await one("SELECT * FROM products WHERE id = ?", [productId]);
  if (!product) throw httpError(404, "Product not found.");
  return product;
}

async function findOrder(pathname) {
  const orderId = decodeURIComponent(pathname.split("/").pop() || "");
  const order = await one("SELECT * FROM orders WHERE id = ?", [orderId]);
  if (!order) throw httpError(404, "Order not found.");
  return order;
}

function cleanPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 13) return "";
  return digits.slice(-10);
}

function cleanText(value, max) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, max);
}

function cleanChoice(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let data = "";
    request.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        request.destroy();
        reject(httpError(413, "Request is too large."));
      }
    });
    request.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(httpError(400, "Invalid JSON."));
      }
    });
    request.on("error", reject);
  });
}

function json(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function id(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
}

async function nextOrderId() {
  const year = new Date().getFullYear();
  const prefix = `KS-${year}-D`;
  const row = await one(
    "SELECT MAX(CAST(SUBSTRING(id, ?) AS UNSIGNED)) AS maxNum FROM orders WHERE id LIKE ?",
    [prefix.length + 1, `${prefix}%`]
  );
  const next = Number(row?.maxNum || 0) + 1;
  return `${prefix}${next}`;
}

function randomDigits(length) {
  let value = "";
  while (value.length < length) value += Math.floor(Math.random() * 10);
  return value;
}

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, saved) {
  const [salt, hash] = String(saved || "").split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  return timingSafeEqual(Buffer.from(hash, "hex"), candidate);
}

function hashToken(value) {
  return hashPassword(String(value));
}

function verifyToken(value, saved) {
  return verifyPassword(String(value), saved);
}

async function sendSms(phone, message) {
  if (!process.env.SMS_PROVIDER_URL) {
    console.log(`[SMS demo] ${phone}: ${message}`);
    return;
  }
  await postProvider(process.env.SMS_PROVIDER_URL, process.env.SMS_PROVIDER_TOKEN, { to: phone, message });
}

async function sendWhatsApp(phone, message) {
  if (process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_ACCESS_TOKEN) {
    const result = await sendCloudApiMessage(phone, message);
    if (!result.ok) {
      console.error(`[WhatsApp] send to ${phone} failed:`, result.error);
    }
    return result;
  }
  if (process.env.WHATSAPP_API_URL) {
    await postProvider(process.env.WHATSAPP_API_URL, process.env.WHATSAPP_API_TOKEN, { to: phone, message });
    return { ok: true };
  }
  console.log(`[WhatsApp demo] ${phone}: ${message}`);
  return { ok: true, demo: true };
}

async function sendWhatsAppBroadcast(notice) {
  const message = `KSiraa update\n\n${notice.title}\n${notice.message}`;
  if (!process.env.WHATSAPP_PHONE_NUMBER_ID && !process.env.WHATSAPP_API_URL) {
    console.log(`[WhatsApp broadcast demo] ${notice.title}: ${notice.message}`);
    return { sent: 0, failed: 0, demo: true };
  }
  const customers = await query("SELECT phone FROM customers");
  return sendWhatsAppToPhones(customers.map((c) => normalizeWhatsAppPhone(c.phone)), message);
}

async function sendWhatsAppBroadcastTemplate(recipients, title, message) {
  const templateName = process.env.WHATSAPP_TEMPLATE_NAME;
  const templateLang = process.env.WHATSAPP_TEMPLATE_LANG || "en";

  if (!templateName) {
    // No template configured — fall back to plain text (will fail outside 24h window)
    const text = `*${title}*\n\n${message}`;
    return sendWhatsAppToPhones(recipients.map((r) => r.phone), text);
  }
  if (!process.env.WHATSAPP_PHONE_NUMBER_ID || !process.env.WHATSAPP_ACCESS_TOKEN) {
    console.log(`[WhatsApp demo] template ${templateName} → ${recipients.length} recipients`);
    return { sent: recipients.length, failed: 0, demo: true };
  }

  const buildComponents = (recipient, useNamed) => ([
    {
      type: "header",
      parameters: [
        useNamed
          ? { type: "text", parameter_name: "message_title", text: title }
          : { type: "text", text: title }
      ]
    },
    {
      type: "body",
      parameters: [
        useNamed ? { type: "text", parameter_name: "customer_name", text: recipient.name } : { type: "text", text: recipient.name },
        useNamed ? { type: "text", parameter_name: "message_body", text: message } : { type: "text", text: message }
      ]
    }
  ]);

  const results = await Promise.allSettled(recipients.map(async (recipient) => {
    // First attempt: named parameters (newer template format)
    let res = await cloudApiRequest({
      messaging_product: "whatsapp",
      to: recipient.phone,
      type: "template",
      template: { name: templateName, language: { code: templateLang }, components: buildComponents(recipient, true) }
    });
    // Fallback: positional parameters (older format)
    if (!res.ok) {
      console.log(`[WhatsApp] retry positional for ${recipient.phone}, first error: ${res.error}`);
      res = await cloudApiRequest({
        messaging_product: "whatsapp",
        to: recipient.phone,
        type: "template",
        template: { name: templateName, language: { code: templateLang }, components: buildComponents(recipient, false) }
      });
    }
    return res;
  }));

  const sent = [];
  const failed = [];
  results.forEach((res, i) => {
    const r = recipients[i];
    if (res.status === "fulfilled" && res.value.ok) sent.push({ phone: r.phone });
    else {
      const err = res.status === "fulfilled" ? res.value.error : res.reason?.message;
      failed.push({ phone: r.phone, error: err || "Unknown error" });
    }
  });
  return { sent: sent.length, failed: failed.length, details: { sent, failed } };
}

async function sendWhatsAppToPhones(phones, message) {
  const targets = phones.filter(Boolean);
  if (process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_ACCESS_TOKEN) {
    const results = await Promise.allSettled(targets.map((phone) => sendCloudApiMessage(phone, message)));
    const sent = [];
    const failed = [];
    results.forEach((r, i) => {
      const phone = targets[i];
      if (r.status === "fulfilled" && r.value.ok) sent.push({ phone });
      else {
        const err = r.status === "fulfilled" ? r.value.error : r.reason?.message;
        failed.push({ phone, error: err || "Unknown error" });
      }
    });
    return { sent: sent.length, failed: failed.length, details: { sent, failed } };
  }
  if (process.env.WHATSAPP_API_URL) {
    const results = await Promise.allSettled(targets.map((to) => postProvider(process.env.WHATSAPP_API_URL, process.env.WHATSAPP_API_TOKEN, { to, message })));
    const sent = results.filter((r) => r.status === "fulfilled").length;
    return { sent, failed: results.length - sent, details: {} };
  }
  console.log(`[WhatsApp demo] ${targets.length} recipients: ${message}`);
  return { sent: targets.length, failed: 0, demo: true };
}

function normalizeWhatsAppPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `91${digits}`;
  if (digits.startsWith("91") && digits.length === 12) return digits;
  return digits;
}

// TEMPORARY debug ring-buffer of the last 20 webhook payloads.
const webhookHits = [];
function recordWebhookHit(body) {
  try {
    const msgs = body?.entry?.[0]?.changes?.[0]?.value?.messages || [];
    webhookHits.unshift({
      at: new Date().toISOString(),
      from: msgs[0]?.from || null,
      type: msgs[0]?.type || null,
      text: msgs[0]?.text?.body || msgs[0]?.interactive?.list_reply?.id || msgs[0]?.button?.text || null,
      raw: body
    });
    if (webhookHits.length > 20) webhookHits.length = 20;
  } catch {}
}

// ---------------------------------------------------------------------------
// WhatsApp Flows: encrypted data-exchange endpoint
// ---------------------------------------------------------------------------

// Decrypts the AES key (RSA-OAEP-SHA256) and the flow payload (AES-128-GCM).
function decryptFlowRequest(body) {
  const aesKey = privateDecrypt(
    { key: flowPrivateKey, padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
    Buffer.from(body.encrypted_aes_key, "base64")
  );
  const flowDataBuf = Buffer.from(body.encrypted_flow_data, "base64");
  const ivBuf = Buffer.from(body.initial_vector, "base64");
  const TAG_LEN = 16;
  const encrypted = flowDataBuf.subarray(0, flowDataBuf.length - TAG_LEN);
  const tag = flowDataBuf.subarray(flowDataBuf.length - TAG_LEN);
  const decipher = createDecipheriv("aes-128-gcm", aesKey, ivBuf);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return { aesKey, ivBuf, payload: JSON.parse(decrypted.toString("utf8")) };
}

// Encrypts our response with the same AES key but the IV bits flipped (per Meta spec).
function encryptFlowResponse(responseObj, aesKey, ivBuf) {
  const flippedIv = Buffer.from(ivBuf.map((b) => b ^ 0xff));
  const cipher = createCipheriv("aes-128-gcm", aesKey, flippedIv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(responseObj), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([encrypted, tag]).toString("base64");
}

const FLOW_MAX_QTY_ROWS = 5;

// SELECT screen: a checkbox list of all in-stock products.
async function buildFlowSelectScreen() {
  const products = await query("SELECT * FROM products WHERE sold_out = 0 ORDER BY sort_order ASC, created_at ASC LIMIT 20");
  return {
    product_options: products.map((p) => ({
      id: p.id,
      title: p.name,
      description: `${p.size} · Rs. ${p.price}`
    }))
  };
}

// QUANTITIES screen: one qty dropdown per chosen product (up to FLOW_MAX_QTY_ROWS).
// Flow JSON can't index into arrays, so we expose flat per-slot fields: labelN / optN / visN.
async function buildFlowQuantityScreen(chosenIds) {
  const ids = (chosenIds || []).slice(0, FLOW_MAX_QTY_ROWS);
  const products = await query("SELECT * FROM products WHERE sold_out = 0");
  const byId = new Map(products.map((p) => [p.id, p]));
  const qtyOptions = Array.from({ length: 10 }, (_, n) => ({ id: String(n + 1), title: String(n + 1) }));
  const rows = ids.filter((id) => byId.has(id)).map((id) => byId.get(id));

  const data = { row_ids: rows.map((p) => p.id).join(",") };
  for (let i = 0; i < FLOW_MAX_QTY_ROWS; i++) {
    const p = rows[i];
    data[`label${i}`] = p ? `${p.name} — Rs. ${p.price}` : "";
    data[`vis${i}`] = Boolean(p);
    data[`opt${i}`] = p ? qtyOptions : [{ id: "1", title: "1" }];
  }
  return data;
}

async function handleFlowDataExchange(request, response) {
  if (!flowPrivateKey) {
    response.writeHead(500, { "Content-Type": "text/plain" });
    response.end("Flow key not configured");
    return;
  }
  let body;
  try { body = await readJson(request); } catch { body = null; }
  if (!body || !body.encrypted_aes_key) {
    response.writeHead(400, { "Content-Type": "text/plain" });
    response.end("Bad request");
    return;
  }

  let aesKey, ivBuf, payload;
  try {
    ({ aesKey, ivBuf, payload } = decryptFlowRequest(body));
  } catch (e) {
    console.error("[Flows] decrypt failed:", e.message);
    // 421 tells Meta to refresh the public key.
    response.writeHead(421, { "Content-Type": "text/plain" });
    response.end("Decryption failed");
    return;
  }

  const action = payload.action;
  const screen = payload.screen;
  const data = payload.data || {};
  const flowToken = payload.flow_token || "";
  let responseData;

  if (action === "ping") {
    // Health check from Meta.
    responseData = { data: { status: "active" } };
  } else if (action === "INIT") {
    responseData = { screen: "SELECT", data: await buildFlowSelectScreen() };
  } else if (action === "data_exchange" && screen === "SELECT") {
    // Customer picked which products → show quantity dropdowns for those.
    const chosen = Array.isArray(data.chosen) ? data.chosen : String(data.chosen || "").split(",").filter(Boolean);
    responseData = { screen: "QUANTITIES", data: await buildFlowQuantityScreen(chosen) };
  } else if (action === "data_exchange" && screen === "QUANTITIES") {
    // Final submit: map q0..qN back to product ids and stash for the nfm_reply webhook.
    const ids = String(data.ids || "").split(",").filter(Boolean);
    const selections = {};
    ids.forEach((id, i) => {
      const q = data[`q${i}`];
      if (q != null && String(q) !== "") selections[id] = q;
    });
    await saveFlowSelections(flowToken, selections);
    responseData = {
      screen: "SUCCESS",
      data: { extension_message_response: { params: { flow_token: flowToken } } }
    };
  } else {
    responseData = { data: { acknowledged: true } };
  }

  const encrypted = encryptFlowResponse(responseData, aesKey, ivBuf);
  response.writeHead(200, { "Content-Type": "text/plain" });
  response.end(encrypted);
}

// Temporary store mapping a flow_token -> submitted selections (survives until the nfm_reply arrives).
async function saveFlowSelections(flowToken, selections) {
  if (!flowToken) return;
  await query(
    `INSERT INTO meta (\`key\`, \`value\`) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`)`,
    [`flow_sel:${flowToken}`, JSON.stringify(selections)]
  );
}

async function loadFlowSelections(flowToken) {
  const row = await one("SELECT `value` FROM meta WHERE `key` = ?", [`flow_sel:${flowToken}`]);
  if (!row) return null;
  await query("DELETE FROM meta WHERE `key` = ?", [`flow_sel:${flowToken}`]);
  try { return JSON.parse(row.value); } catch { return null; }
}

async function handleWhatsAppWebhook(payload) {
  const entries = payload?.entry || [];
  for (const entry of entries) {
    const changes = entry.changes || [];
    for (const change of changes) {
      const value = change.value || {};
      const messages = value.messages || [];
      for (const message of messages) {
        await processIncomingWhatsAppMessage(message, value.contacts || []);
      }
    }
  }
}

async function processIncomingWhatsAppMessage(message, contacts) {
  const from = message.from;
  if (!from) return;
  const profileName = contacts.find((c) => c.wa_id === from)?.profile?.name || "";

  let userInput = "";
  let listSelectionId = "";
  if (message.type === "text") {
    userInput = String(message.text?.body || "").trim();
  } else if (message.type === "interactive") {
    const inter = message.interactive || {};
    // Flow completion: the customer submitted the product-selection flow.
    if (inter.type === "nfm_reply") {
      const session = await loadWaSession(from);
      await handleFlowCompletion(from, session, inter.nfm_reply);
      return;
    }
    userInput = inter.button_reply?.id || inter.list_reply?.id || "";
    listSelectionId = inter.list_reply?.id || "";
  } else if (message.type === "button") {
    userInput = String(message.button?.payload || message.button?.text || "").trim();
  } else {
    userInput = `[${message.type}]`;
  }

  console.log(`[WhatsApp] ← ${from} (${profileName}): ${userInput}`);

  const session = await loadWaSession(from);
  const text = String(userInput).toLowerCase().trim();

  // Global commands work anywhere
  if (text === "hi" || text === "hello" || text === "hey" || text === "start" || text === "menu") {
    session.step = "shopping";
    session.cart = {};
    await saveWaSession(from, session);
    const greeting = profileName ? `Hi ${profileName}! 👋` : "Hi! 👋";
    await sendCloudApiMessage(from, `${greeting}\n\nWelcome to *KSiraa* — fresh dairy delivered to your door.`);
    await sendBrowseExperience(from);
    return;
  }
  if (text === "cancel" || text === "stop") {
    session.step = "idle";
    session.cart = {};
    await saveWaSession(from, session);
    await sendCloudApiMessage(from, "Cancelled. Type *hi* anytime to start again.");
    return;
  }
  if (text === "my_orders" || text === "orders") {
    await sendRecentOrders(from);
    return;
  }
  if (text === "show_products" || text === "browse" || text === "products" || text === "order" || text === "order now") {
    session.step = "shopping";
    if (!session.cart) session.cart = {};
    await saveWaSession(from, session);
    await sendBrowseExperience(from);
    return;
  }
  if (text === "view_cart" || text === "cart") {
    await sendCartSummary(from, session);
    return;
  }
  if (text === "checkout" || text === "place_order") {
    if (!session.cart || !Object.keys(session.cart).length) {
      await sendCloudApiMessage(from, "Your cart is empty. Type *menu* to see products.");
      return;
    }
    return startCheckout(from, session, profileName);
  }
  if (text === "add_more") {
    session.step = "shopping";
    await saveWaSession(from, session);
    await sendBrowseExperience(from);
    return;
  }

  // Product-card "Add" button: ask how many before adding.
  if (userInput && userInput.startsWith("add_")) {
    const productId = userInput.slice(4);
    await startAddProduct(from, session, productId);
    return;
  }

  // List-message selection: a product was picked
  if (listSelectionId && listSelectionId.startsWith("prod_")) {
    const productId = listSelectionId.slice(5);
    await handleProductPick(from, session, productId);
    return;
  }

  // State-machine flow
  switch (session.step) {
    case "shopping":
      return handleShoppingText(from, session, userInput);
    case "ask_qty":
      return handleQtyReply(from, session, userInput);
    case "ask_name":
      return handleNameReply(from, session, userInput, profileName);
    case "ask_house":
      return handleHouseReply(from, session, userInput);
    case "ask_street":
      return handleStreetReply(from, session, userInput);
    case "ask_city":
      return handleCityReply(from, session, userInput);
    case "ask_pincode":
      return handlePincodeReply(from, session, userInput);
    case "ask_payment":
      return handlePaymentReply(from, session, userInput);
    case "confirm":
      return handleConfirmReply(from, session, userInput);
    default:
      // Idle or unknown — show welcome
      await sendWelcomeMessage(from, profileName);
  }
}

async function loadWaSession(phone) {
  const row = await one("SELECT * FROM whatsapp_sessions WHERE phone = ?", [phone]);
  if (!row) {
    return { phone, step: "idle", cart: {}, profile: {} };
  }
  let cart = {};
  let profile = {};
  try { cart = typeof row.cart_json === "string" ? JSON.parse(row.cart_json) : (row.cart_json || {}); } catch {}
  try { profile = typeof row.profile_json === "string" ? JSON.parse(row.profile_json) : (row.profile_json || {}); } catch {}
  // pendingProductId is stashed inside profile_json so it survives between messages.
  const pendingProductId = profile.__pendingProductId || null;
  return { phone, step: row.step || "idle", cart, profile, pendingProductId };
}

async function saveWaSession(phone, session) {
  const profile = { ...(session.profile || {}) };
  if (session.pendingProductId) profile.__pendingProductId = session.pendingProductId;
  else delete profile.__pendingProductId;
  await query(
    `INSERT INTO whatsapp_sessions (phone, step, cart_json, profile_json)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE step = VALUES(step), cart_json = VALUES(cart_json), profile_json = VALUES(profile_json)`,
    [phone, session.step || "idle", JSON.stringify(session.cart || {}), JSON.stringify(profile)]
  );
}

async function handleProductPick(from, session, productId) {
  const product = await one("SELECT * FROM products WHERE id = ? AND sold_out = 0", [productId]);
  if (!product) {
    await sendCloudApiMessage(from, "That product isn't available. Type *menu* to see what's in stock.");
    return;
  }
  session.cart = session.cart || {};
  session.cart[product.id] = (session.cart[product.id] || 0) + 1;
  session.step = "shopping";
  await saveWaSession(from, session);
  await sendCloudApiMessage(from, `Added *${product.name}* to your cart (qty: ${session.cart[product.id]}).\n\nReply *more* to keep shopping, *cart* to view items, or *checkout* to place the order.`);
}

async function handleShoppingText(from, session, raw) {
  // Try parsing free-form like "2 ghee, 1 butter"
  const products = await query("SELECT * FROM products WHERE sold_out = 0");
  const parsed = parseShoppingText(raw, products);
  if (!parsed.length) {
    await sendCloudApiMessage(from, "I didn't catch that. Tap *Browse products* or type something like _2 ghee, 1 butter_. Type *cart* to view your items or *checkout* to confirm.");
    await sendProductList(from);
    return;
  }
  session.cart = session.cart || {};
  for (const { product, qty } of parsed) {
    session.cart[product.id] = (session.cart[product.id] || 0) + qty;
  }
  await saveWaSession(from, session);
  const summary = parsed.map((p) => `+${p.qty} ${p.product.name}`).join("\n");
  await sendCloudApiMessage(from, `Added to cart:\n${summary}\n\nReply *cart* to view, *more* to add more, or *checkout* to place the order.`);
}

function parseShoppingText(text, products) {
  const out = [];
  if (!text) return out;
  const lower = String(text).toLowerCase();
  const parts = lower.split(/[,\n]+/).map((s) => s.trim()).filter(Boolean);
  for (const part of parts) {
    const match = part.match(/^(\d+)\s*(.+)$/) || part.match(/^(.+?)\s+(\d+)$/);
    let qty = 1;
    let term = part;
    if (match) {
      const a = match[1];
      const b = match[2];
      if (/^\d+$/.test(a)) { qty = Number(a); term = b; }
      else { qty = Number(b); term = a; }
    }
    if (!Number.isFinite(qty) || qty < 1) qty = 1;
    qty = Math.min(qty, 99);
    const product = products.find((p) => p.name.toLowerCase().includes(term)) ||
                    products.find((p) => term.includes(p.name.toLowerCase().split(/\s+/)[0]));
    if (product) out.push({ product, qty });
  }
  return out;
}

async function sendCartSummary(to, session) {
  const cart = session.cart || {};
  const ids = Object.keys(cart).filter((id) => cart[id] > 0);
  if (!ids.length) {
    await sendCloudApiMessage(to, "Your cart is empty. Type *menu* to see products.");
    return;
  }
  const placeholders = ids.map(() => "?").join(",");
  const products = await query(`SELECT * FROM products WHERE id IN (${placeholders})`, ids);
  let total = 0;
  const lines = products.map((p) => {
    const qty = cart[p.id];
    const lineTotal = p.price * qty;
    total += lineTotal;
    return `• ${p.name} × ${qty} — Rs. ${lineTotal}`;
  });
  const body = `🛒 *Your cart*\n\n${lines.join("\n")}\n\n*Total: Rs. ${total}*\n\nReply *checkout* to place the order, *more* to add items, or *cancel* to clear.`;
  return cloudApiRequest({
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: body },
      action: {
        buttons: [
          { type: "reply", reply: { id: "checkout", title: "✅ Checkout" } },
          { type: "reply", reply: { id: "add_more", title: "➕ Add more" } },
          { type: "reply", reply: { id: "cancel", title: "❌ Cancel" } }
        ]
      }
    }
  });
}

async function startCheckout(from, session, profileName) {
  const localPhone = normalizeLocalPhone(from);
  const existing = await one("SELECT * FROM customers WHERE phone = ?", [localPhone]);
  if (existing && existing.name && existing.address) {
    session.profile = { name: existing.name, address: existing.address };
    session.step = "ask_payment";
    await saveWaSession(from, session);
    await sendPaymentChoice(from);
    return;
  }
  session.step = "ask_name";
  session.profile = session.profile || {};
  if (profileName) session.profile.name = profileName;
  await saveWaSession(from, session);
  const prompt = profileName
    ? `What name should we put on the order? Send *${profileName}* to confirm, or type a different name.`
    : "What name should we put on the order?";
  await sendCloudApiMessage(from, prompt);
}

async function handleNameReply(from, session, raw) {
  const name = String(raw || "").trim();
  if (!name || name.length < 2) {
    await sendCloudApiMessage(from, "Please send a name (2 or more letters).");
    return;
  }
  session.profile = session.profile || {};
  session.profile.name = name.slice(0, 80);
  session.step = "ask_house";
  await saveWaSession(from, session);
  await sendCloudApiMessage(from, `Thanks ${session.profile.name}!\n\n🏠 *Step 1 of 4*\nFlat / House no. / Building name?\n\n_e.g. 12B, Sunrise Apartments_`);
}

async function handleHouseReply(from, session, raw) {
  const value = String(raw || "").trim();
  if (value.length < 2) {
    await sendCloudApiMessage(from, "Please send your house no or building name (2 or more characters).");
    return;
  }
  session.profile = session.profile || {};
  session.profile.addrHouse = value.slice(0, 100);
  session.step = "ask_street";
  await saveWaSession(from, session);
  await sendCloudApiMessage(from, "🛣️ *Step 2 of 4*\nStreet / Area / Locality?\n\n_e.g. MG Road, Indiranagar_");
}

async function handleStreetReply(from, session, raw) {
  const value = String(raw || "").trim();
  if (value.length < 2) {
    await sendCloudApiMessage(from, "Please send your street or area name.");
    return;
  }
  session.profile = session.profile || {};
  session.profile.addrStreet = value.slice(0, 120);
  session.step = "ask_city";
  await saveWaSession(from, session);
  await sendCloudApiMessage(from, "🏙️ *Step 3 of 4*\nCity?\n\n_e.g. Bengaluru_");
}

async function handleCityReply(from, session, raw) {
  const value = String(raw || "").trim();
  if (value.length < 2) {
    await sendCloudApiMessage(from, "Please send your city name.");
    return;
  }
  session.profile = session.profile || {};
  session.profile.addrCity = value.slice(0, 60);
  session.step = "ask_pincode";
  await saveWaSession(from, session);
  await sendCloudApiMessage(from, "📮 *Step 4 of 4*\n6-digit pincode?\n\n_e.g. 560038_");
}

async function handlePincodeReply(from, session, raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length !== 6) {
    await sendCloudApiMessage(from, "That doesn't look like a valid pincode. Please send the 6-digit pincode.");
    return;
  }
  session.profile = session.profile || {};
  session.profile.addrPin = digits;
  const composed = `${session.profile.addrHouse}, ${session.profile.addrStreet}, ${session.profile.addrCity} ${session.profile.addrPin}`;
  session.profile.address = composed.slice(0, 300);

  const localPhone = normalizeLocalPhone(from);
  let customer = await one("SELECT * FROM customers WHERE phone = ?", [localPhone]);
  if (!customer) {
    const newId = id("cust");
    await query("INSERT INTO customers (id, phone, name, address) VALUES (?, ?, ?, ?)", [newId, localPhone, session.profile.name, session.profile.address]);
    customer = await one("SELECT * FROM customers WHERE id = ?", [newId]);
  } else {
    await query("UPDATE customers SET name = ?, address = ? WHERE id = ?", [session.profile.name, session.profile.address, customer.id]);
    customer = { ...customer, name: session.profile.name, address: session.profile.address };
  }

  session.step = "ask_payment";
  await saveWaSession(from, session);
  await sendPaymentChoice(from);
}

async function sendPaymentChoice(to) {
  return cloudApiRequest({
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: "💳 *Choose payment method*" },
      action: {
        buttons: [
          { type: "reply", reply: { id: "pay_cod", title: "💵 Cash on delivery" } },
          { type: "reply", reply: { id: "pay_upi", title: "📱 UPI on delivery" } },
          { type: "reply", reply: { id: "pay_online", title: "💳 Online payment" } }
        ]
      }
    }
  });
}

async function handlePaymentReply(from, session, raw) {
  const text = String(raw || "").trim().toLowerCase();
  let method = null;
  if (text === "pay_cod" || text.includes("cash")) method = "Cash on delivery";
  else if (text === "pay_upi" || text.includes("upi")) method = "UPI on delivery";
  else if (text === "pay_online" || text.includes("online")) method = "Online payment";
  if (!method) {
    await sendCloudApiMessage(from, "Please pick a payment method from the buttons above.");
    await sendPaymentChoice(from);
    return;
  }
  session.profile = session.profile || {};
  session.profile.paymentMethod = method;
  session.step = "confirm";
  await saveWaSession(from, session);
  const localPhone = normalizeLocalPhone(from);
  const customer = await one("SELECT * FROM customers WHERE phone = ?", [localPhone]);
  await sendOrderConfirmation(from, session, customer);
}

async function sendOrderConfirmation(to, session, customer) {
  const cart = session.cart || {};
  const ids = Object.keys(cart).filter((cid) => cart[cid] > 0);
  if (!ids.length) {
    await sendCloudApiMessage(to, "Your cart is empty. Type *menu* to start again.");
    session.step = "idle";
    await saveWaSession(to, session);
    return;
  }
  const placeholders = ids.map(() => "?").join(",");
  const products = await query(`SELECT * FROM products WHERE id IN (${placeholders})`, ids);
  let total = 0;
  const lines = products.map((p) => {
    const qty = cart[p.id];
    const lineTotal = p.price * qty;
    total += lineTotal;
    return `• ${p.name} × ${qty} — Rs. ${lineTotal}`;
  });
  const delivery = total >= 500 ? 0 : 49;
  const grandTotal = total + delivery;
  const paymentMethod = session.profile?.paymentMethod || "Cash on delivery";
  const body = `📋 *Confirm your order*\n\n${lines.join("\n")}\n\nSubtotal: Rs. ${total}\nDelivery: ${delivery === 0 ? "Free" : `Rs. ${delivery}`}\n*Total: Rs. ${grandTotal}*\n\n*Deliver to:* ${customer.name}\n${customer.address}\n\nPayment: ${paymentMethod}\n\nReply *yes* to confirm, or *cancel* to start over.`;
  return cloudApiRequest({
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: body },
      action: {
        buttons: [
          { type: "reply", reply: { id: "yes", title: "✅ Confirm order" } },
          { type: "reply", reply: { id: "cancel", title: "❌ Cancel" } }
        ]
      }
    }
  });
}

async function handleConfirmReply(from, session, raw) {
  const text = String(raw || "").trim().toLowerCase();
  if (text === "yes" || text === "y" || text === "confirm") {
    await placeWhatsAppOrder(from, session);
    return;
  }
  await sendCloudApiMessage(from, "Reply *yes* to confirm the order, or *cancel* to start over.");
}

async function placeWhatsAppOrder(from, session) {
  const localPhone = normalizeLocalPhone(from);
  const customer = await one("SELECT * FROM customers WHERE phone = ?", [localPhone]);
  if (!customer) {
    await sendCloudApiMessage(from, "Something went wrong — couldn't find your details. Type *hi* to start again.");
    session.step = "idle";
    await saveWaSession(from, session);
    return;
  }
  const cart = session.cart || {};
  const ids = Object.keys(cart).filter((cid) => cart[cid] > 0);
  if (!ids.length) {
    await sendCloudApiMessage(from, "Your cart is empty.");
    session.step = "idle";
    await saveWaSession(from, session);
    return;
  }
  const placeholders = ids.map(() => "?").join(",");
  const products = await query(`SELECT * FROM products WHERE id IN (${placeholders})`, ids);
  const items = products.map((p) => ({
    productId: p.id,
    name: p.name,
    size: p.size,
    qty: cart[p.id],
    price: p.price,
    lineTotal: p.price * cart[p.id]
  }));
  const subtotal = items.reduce((sum, it) => sum + it.lineTotal, 0);
  const delivery = subtotal >= 500 ? 0 : 49;
  const total = subtotal + delivery;
  const paymentMethod = session.profile?.paymentMethod || "Cash on delivery";
  const orderId = await nextOrderId();
  await query(
    `INSERT INTO orders (id, customer_id, customer_name, customer_phone, address, frequency, delivery_time, payment_method, payment_status, payment_url, status, items_json, total)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      orderId, customer.id, customer.name, customer.phone, customer.address,
      "One time", "Any time", paymentMethod, "Pending", "",
      "Received", JSON.stringify(items), total
    ]
  );
  session.step = "idle";
  session.cart = {};
  await saveWaSession(from, session);

  await sendCloudApiMessage(from, `✅ *Order confirmed!*\n\nOrder ID: *${orderId}*\nTotal: Rs. ${total}\nPayment: ${paymentMethod}\n\nWe'll deliver soon. Type *hi* anytime to order again.`);

  // Notify owner async (same pattern as website orders)
  getOwnerWhatsApp()
    .then((number) => sendWhatsApp(number, `New WhatsApp order ${orderId} from ${customer.name} (${customer.phone}). Total Rs. ${total}.`))
    .catch((err) => console.error("Owner notify failed:", err));
}

function normalizeLocalPhone(waPhone) {
  const digits = String(waPhone || "").replace(/\D/g, "");
  if (digits.startsWith("91") && digits.length === 12) return digits.slice(2);
  return digits;
}

// Product-card "Add" tapped: remember which product and ask for quantity.
async function startAddProduct(from, session, productId) {
  const product = await one("SELECT * FROM products WHERE id = ? AND sold_out = 0", [productId]);
  if (!product) {
    await sendCloudApiMessage(from, "That product isn't available anymore. Type *menu* to see what's in stock.");
    return;
  }
  session.pendingProductId = product.id;
  session.step = "ask_qty";
  await saveWaSession(from, session);
  await sendCloudApiMessage(from, `How many *${product.name}* (${product.size}) would you like?\n\nReply with a number, e.g. *2*.`);
}

async function handleQtyReply(from, session, raw) {
  const productId = session.pendingProductId;
  if (!productId) {
    // No product pending — treat the reply as normal shopping text.
    session.step = "shopping";
    await saveWaSession(from, session);
    return handleShoppingText(from, session, raw);
  }
  const qty = parseInt(String(raw).replace(/[^0-9]/g, ""), 10);
  if (!qty || qty < 1) {
    await sendCloudApiMessage(from, "Please reply with a number, e.g. *2*. How many would you like?");
    return;
  }
  const product = await one("SELECT * FROM products WHERE id = ? AND sold_out = 0", [productId]);
  if (!product) {
    session.pendingProductId = null;
    session.step = "shopping";
    await saveWaSession(from, session);
    await sendCloudApiMessage(from, "That product isn't available anymore. Type *menu* to see what's in stock.");
    return;
  }
  session.cart = session.cart || {};
  session.cart[product.id] = (session.cart[product.id] || 0) + qty;
  session.pendingProductId = null;
  session.step = "shopping";
  await saveWaSession(from, session);
  await sendCloudApiMessage(from, `Added *${qty} × ${product.name}* to your cart (total qty: ${session.cart[product.id]}).\n\nReply *more* to keep shopping, *cart* to view items, or *checkout* to place the order.`);
}

async function sendWelcomeMessage(to, name) {
  const greeting = name ? `Hello ${name}!` : "Hello!";
  const body = `${greeting} 👋\n\nWelcome to *KSiraa* — fresh dairy delivered to your door.\n\nWhat would you like to do?`;
  return cloudApiRequest({
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: body },
      action: {
        buttons: [
          { type: "reply", reply: { id: "show_products", title: "🛒 Order Now" } },
          { type: "reply", reply: { id: "my_orders", title: "📦 My Orders" } }
        ]
      }
    }
  });
}

// Fallback product image used when a product has no image_url set.
const FALLBACK_PRODUCT_IMAGE = `${publicBaseUrl.replace(/\/$/, "")}/assets/ksiraa-product.jpeg`;

function productImageUrl(p) {
  const u = String(p.image_url || "").trim();
  if (/^https?:\/\//i.test(u)) return u;
  return FALLBACK_PRODUCT_IMAGE;
}

// Chooses the best browse UI: the multi-select Flow if configured, otherwise product cards.
// Only send the Flow when it is explicitly enabled AND published. Otherwise always
// use the reliable product cards so the customer never gets a dead/empty reply.
const flowEnabled = String(process.env.WHATSAPP_FLOW_ENABLED || "").toLowerCase() === "true";

async function sendBrowseExperience(to) {
  if (flowEnabled && flowId && flowPrivateKey) {
    const result = await sendProductFlow(to);
    if (result && result.ok) return;
    console.error("[Flows] flow send rejected, falling back to cards:", result && result.error);
  }
  await sendProductCards(to);
}

// Sends the WhatsApp Flow as an interactive flow message (multi-select + quantity screens).
async function sendProductFlow(to) {
  const flowToken = `ft_${to}_${Date.now()}_${randomBytes(4).toString("hex")}`;
  return cloudApiRequest({
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "flow",
      header: { type: "text", text: "KSiraa products" },
      body: { text: "Tap *Browse products* to pick items and quantities, then submit your order in one go." },
      footer: { text: "Fresh dairy delivered to your door" },
      action: {
        name: "flow",
        parameters: {
          flow_message_version: "3",
          flow_token: flowToken,
          flow_id: flowId,
          flow_cta: "Browse products",
          mode: "published",
          flow_action: "data_exchange"
        }
      }
    }
  });
}

// Customer submitted the flow: read stashed selections, fill the cart, show the summary.
async function handleFlowCompletion(from, session, nfmReply) {
  let responseJson = {};
  try { responseJson = JSON.parse(nfmReply?.response_json || "{}"); } catch {}
  const flowToken = responseJson.flow_token || "";
  let selections = await loadFlowSelections(flowToken);
  // Fallback: some flows return the quantities directly in response_json.
  if (!selections) selections = responseJson;

  const products = await query("SELECT * FROM products WHERE sold_out = 0");
  const byId = new Map(products.map((p) => [p.id, p]));
  session.cart = session.cart || {};
  let added = 0;
  for (const [key, val] of Object.entries(selections || {})) {
    // Keys look like "qty_<productId>" or "<productId>"; values are the chosen quantity.
    const pid = key.startsWith("qty_") ? key.slice(4) : key;
    if (!byId.has(pid)) continue;
    const qty = parseInt(String(val).replace(/[^0-9]/g, ""), 10);
    if (qty > 0) {
      session.cart[pid] = (session.cart[pid] || 0) + qty;
      added += qty;
    }
  }
  session.step = "shopping";
  await saveWaSession(from, session);
  if (!added) {
    await sendCloudApiMessage(from, "Looks like no items were selected. Type *browse* to try again.");
    return;
  }
  await sendCartSummary(from, session);
}

// Sends each product as its own rich card: image + name/size/price/description + an "Add" button.
async function sendProductCards(to) {
  const products = await query("SELECT * FROM products WHERE sold_out = 0 ORDER BY sort_order ASC, created_at ASC LIMIT 10");
  if (!products.length) {
    return sendCloudApiMessage(to, "Sorry, no products available right now. Please check back later.");
  }
  await sendCloudApiMessage(to, "🛒 *Browse our products* — tap *Add* on any item you want.");
  for (const p of products) {
    await cloudApiRequest({
      messaging_product: "whatsapp",
      to,
      type: "interactive",
      interactive: {
        type: "button",
        header: { type: "image", image: { link: productImageUrl(p) } },
        body: { text: `*${p.name}*\n${p.size} · Rs. ${p.price}\n\n${p.description || ""}`.trim() },
        action: {
          buttons: [
            { type: "reply", reply: { id: `add_${p.id}`, title: "➕ Add" } }
          ]
        }
      }
    });
  }
  await sendCloudApiMessage(to, "When you're done, type *cart* to review or *checkout* to place your order.");
}

async function sendProductList(to) {
  const products = await query("SELECT * FROM products WHERE sold_out = 0 ORDER BY sort_order ASC, created_at ASC LIMIT 10");
  if (!products.length) {
    return sendCloudApiMessage(to, "Sorry, no products available right now. Please check back later.");
  }

  // WhatsApp interactive list — tap a row to add it to the cart
  const rows = products.slice(0, 10).map((p) => ({
    id: `prod_${p.id}`,
    title: truncate(p.name, 24),
    description: `${p.size} · Rs. ${p.price}`
  }));
  return cloudApiRequest({
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      header: { type: "text", text: "Today's products" },
      body: { text: "Tap any item to add it to your cart. You can also type for example _2 ghee, 1 butter_." },
      footer: { text: "Type *cart* to view, *checkout* to confirm" },
      action: {
        button: "View products",
        sections: [{ title: "Fresh dairy", rows }]
      }
    }
  });
}

function truncate(s, n) {
  const str = String(s || "");
  return str.length > n ? str.slice(0, n - 1) + "…" : str;
}

async function sendRecentOrders(to) {
  const normalized = normalizeWhatsAppPhone(to);
  const localPhone = normalized.startsWith("91") ? normalized.slice(2) : normalized;
  const customer = await one("SELECT * FROM customers WHERE phone = ?", [localPhone]);
  if (!customer) {
    return sendCloudApiMessage(to, "We don't have any orders for this number yet. Tap *Order Now* to place your first one.");
  }
  const orders = await query("SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC LIMIT 5", [customer.id]);
  if (!orders.length) {
    return sendCloudApiMessage(to, "We don't have any orders for this number yet. Tap *Order Now* to place your first one.");
  }
  const lines = orders.map((o) => `• ${o.id} — Rs. ${o.total} — ${o.status}`);
  return sendCloudApiMessage(to, `📦 *Your recent orders*\n\n${lines.join("\n")}`);
}

async function cloudApiRequest(body) {
  if (!process.env.WHATSAPP_PHONE_NUMBER_ID || !process.env.WHATSAPP_ACCESS_TOKEN) {
    console.log("[WhatsApp] Cloud API not configured, skipping send.");
    return { ok: false, error: "Not configured" };
  }
  const url = `https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`
      },
      body: JSON.stringify(body)
    });
    const text = await response.text();
    let data = {};
    try { data = JSON.parse(text); } catch {}
    if (!response.ok) {
      const err = data?.error?.message || text || `HTTP ${response.status}`;
      console.error(`[WhatsApp] → send failed: ${err}`);
      return { ok: false, error: err };
    }
    console.log(`[WhatsApp] → sent to ${body.to}`);
    return { ok: true, messageId: data?.messages?.[0]?.id };
  } catch (error) {
    console.error("[WhatsApp] → request error:", error.message);
    return { ok: false, error: error.message };
  }
}

async function sendCloudApiMessage(phone, message) {
  const to = normalizeWhatsAppPhone(phone);
  if (!to) return { ok: false, error: "Empty phone" };
  return cloudApiRequest({
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: message, preview_url: false }
  });
}

async function createPayment(order) {
  const payload = {
    orderId: order.id,
    amount: order.total,
    currency: "INR",
    customer: { name: order.customerName, phone: order.customerPhone },
    description: `KSiraa order ${order.id}`,
    returnUrl: process.env.PAYMENT_RETURN_URL || `${publicBaseUrl}/`
  };
  const response = await postProvider(process.env.PAYMENT_PROVIDER_URL, process.env.PAYMENT_PROVIDER_TOKEN, payload);
  return { paymentUrl: response?.paymentUrl || response?.short_url || response?.url || "" };
}

async function postProvider(url, token, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const text = await response.text();
    console.error(`Provider request failed: ${response.status} ${text}`);
    throw httpError(502, "Provider request failed. Please check integration credentials.");
  }
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function orderToOwnerMessage(order) {
  const lines = order.items.map((item) => `- ${item.name} (${item.size}) x ${item.qty}: Rs. ${item.lineTotal}`);
  return [
    "New KSiraa order",
    `Order: ${order.id}`,
    `Customer: ${order.customerName}`,
    `Mobile: ${order.customerPhone}`,
    `Address: ${order.address}`,
    `Delivery frequency: ${order.frequency}`,
    `Time: ${order.deliveryTime}`,
    `Payment: ${order.paymentMethod}`,
    `Payment status: ${order.paymentStatus}`,
    ...(order.paymentUrl ? [`Payment link: ${order.paymentUrl}`] : []),
    "Products:",
    ...lines,
    `Total: Rs. ${order.total}`
  ].join("\n");
}

process.on("uncaughtException", (error) => {
  if (error.status) return;
  console.error(error);
});
