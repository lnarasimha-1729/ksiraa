import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
loadEnvFile(join(root, ".env"));

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

createServer(async (request, response) => {
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
}).listen(port, host, () => {
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
    await sendWhatsApp(await getOwnerWhatsApp(), orderToOwnerMessage(orderRowToApi(saved)));
    json(response, 201, { order: orderRowToApi(saved) });
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
      "INSERT INTO products (id, name, size, price, description, sold_out, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [product.id, product.name, product.size, product.price, product.description, product.soldOut ? 1 : 0, maxOrder]
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
      "UPDATE products SET name = ?, size = ?, price = ?, description = ?, sold_out = ? WHERE id = ?",
      [product.name, product.size, product.price, product.description, product.soldOut ? 1 : 0, product.id]
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
    id: id("order"),
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
  if (!process.env.WHATSAPP_API_URL) {
    console.log(`[WhatsApp demo] ${phone}: ${message}`);
    return;
  }
  await postProvider(process.env.WHATSAPP_API_URL, process.env.WHATSAPP_API_TOKEN, { to: phone, message });
}

async function sendWhatsAppBroadcast(notice) {
  if (!process.env.WHATSAPP_API_URL) {
    console.log(`[WhatsApp broadcast demo] ${notice.title}: ${notice.message}`);
    return;
  }
  const message = `KSiraa update\n\n${notice.title}\n${notice.message}`;
  const customers = await query("SELECT phone FROM customers");
  await Promise.allSettled(customers.map((customer) => postProvider(process.env.WHATSAPP_API_URL, process.env.WHATSAPP_API_TOKEN, {
    to: `91${customer.phone}`,
    message
  })));
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
