const state = {
  config: {},
  products: [],
  cart: JSON.parse(localStorage.getItem("ksiraa-cart") || "{}"),
  notices: [],
  customer: null,
  customerToken: localStorage.getItem("ksiraa-customer-token") || "",
  adminToken: localStorage.getItem("ksiraa-admin-token") || "",
  admin: {
    orders: [],
    customers: []
  }
};

const els = {
  productGrid: document.querySelector("#product-grid"),
  productTemplate: document.querySelector("#product-template"),
  summaryList: document.querySelector("#summary-list"),
  orderTotal: document.querySelector("#order-total"),
  noticeList: document.querySelector("#notice-list"),
  customerStatus: document.querySelector("#customer-status"),
  adminProducts: document.querySelector("#admin-products"),
  adminOrders: document.querySelector("#admin-orders"),
  adminCustomers: document.querySelector("#admin-customers"),
  myOrders: document.querySelector("#my-orders")
};

init();

async function init() {
  bindNavigation();
  bindLogin();
  bindOrderActions();
  bindAdminActions();
  await refreshPublicData();
  await restoreCustomer();
  await restoreAdmin();
  renderAll();
}

async function refreshPublicData() {
  const [config, products, notices] = await Promise.all([
    api("/api/config"),
    api("/api/products"),
    api("/api/notices")
  ]);
  state.config = config;
  state.products = products.products;
  state.notices = notices.notices;
  document.querySelector("#admin-phone-label").textContent = config.adminPhone;
  document.querySelector("#admin-phone").value = config.adminPhone;
}

async function restoreCustomer() {
  if (!state.customerToken) return;
  try {
    const data = await api("/api/me", { token: state.customerToken });
    state.customer = data.customer;
    fillCustomerForm();
    await loadMyOrders();
  } catch {
    logoutCustomer(false);
  }
}

async function restoreAdmin() {
  if (!state.adminToken) return;
  try {
    await loadAdminDashboard();
    showAdminContent(true);
  } catch {
    logoutAdmin(false);
  }
}

function bindNavigation() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", async () => {
      document.querySelectorAll(".tab").forEach((item) => item.classList.remove("active"));
      tab.classList.add("active");
      document.querySelectorAll(".view-section").forEach((section) => section.classList.add("hidden"));
      document.querySelector(".notice-band").classList.add("hidden");

      if (tab.dataset.view === "shop") {
        document.querySelector("#shop-view").classList.remove("hidden");
        document.querySelector("#products-view").classList.remove("hidden");
        document.querySelector(".notice-band").classList.remove("hidden");
      }

      if (tab.dataset.view === "account") {
        document.querySelector("#account-view").classList.remove("hidden");
        if (!state.customer) openLogin();
        await loadMyOrders();
      }

      if (tab.dataset.view === "admin") {
        document.querySelector("#admin-view").classList.remove("hidden");
        if (state.adminToken) await loadAdminDashboard();
      }

      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });
}

function bindLogin() {
  document.querySelector("#customer-login-open").addEventListener("click", openLogin);
  document.querySelector("#login-close").addEventListener("click", closeLogin);
  document.querySelector("#customer-logout").addEventListener("click", () => logoutCustomer(true));

  document.querySelector("#otp-request-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const phone = document.querySelector("#otp-phone").value;
    const result = await api("/api/auth/request-otp", {
      method: "POST",
      body: { phone }
    });
    toast(result.message);
    document.querySelector("#otp-request-form").classList.add("hidden");
    document.querySelector("#otp-verify-form").classList.remove("hidden");
  });

  document.querySelector("#otp-verify-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = await api("/api/auth/verify-otp", {
      method: "POST",
      body: {
        phone: document.querySelector("#otp-phone").value,
        otp: document.querySelector("#otp-code").value
      }
    });
    state.customer = data.customer;
    state.customerToken = data.token;
    localStorage.setItem("ksiraa-customer-token", data.token);
    fillCustomerForm();
    closeLogin();
    renderCustomerStatus();
    await loadMyOrders();
    toast("Logged in successfully.");
  });
}

function bindOrderActions() {
  document.querySelector("#refresh-products").addEventListener("click", async () => {
    await refreshPublicData();
    renderAll();
  });

  document.querySelector("#place-order").addEventListener("click", async () => {
    if (!state.customer) {
      openLogin();
      return;
    }

    const payload = orderPayload();
    if (!payload) return;

    const result = await api("/api/orders", {
      method: "POST",
      token: state.customerToken,
      body: payload
    });
    state.cart = {};
    saveCart();
    fillCustomerForm(result.order);
    await loadMyOrders();
    await loadAdminDashboard({ silent: true });
    renderAll();
    if (result.order.paymentUrl) {
      window.open(result.order.paymentUrl, "_blank");
    }
    toast(`Order ${result.order.id} placed.`);
  });

  document.querySelector("#send-whatsapp").addEventListener("click", () => {
    const payload = orderPayload();
    if (!payload) return;
    const text = buildWhatsAppOrder(payload);
    window.open(`https://wa.me/${state.config.ownerWhatsApp}?text=${encodeURIComponent(text)}`, "_blank");
  });
}

function bindAdminActions() {
  document.querySelector("#admin-login").addEventListener("submit", async (event) => {
    event.preventDefault();
    const result = await api("/api/admin/login", {
      method: "POST",
      body: {
        phone: document.querySelector("#admin-phone").value,
        password: document.querySelector("#admin-password").value
      }
    });
    state.adminToken = result.token;
    localStorage.setItem("ksiraa-admin-token", result.token);
    showAdminContent(true);
    await loadAdminDashboard();
    toast("Admin logged in.");
  });

  document.querySelector("#product-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    await api("/api/admin/products", {
      method: "POST",
      token: state.adminToken,
      body: {
        name: document.querySelector("#new-product-name").value,
        size: document.querySelector("#new-product-size").value,
        price: document.querySelector("#new-product-price").value,
        description: document.querySelector("#new-product-description").value
      }
    });
    event.target.reset();
    await refreshPublicData();
    await loadAdminDashboard();
    renderAll();
    toast("Product added.");
  });

  els.adminProducts.addEventListener("click", async (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    const product = state.products.find((item) => item.id === button.dataset.id);
    if (!product) return;

    if (button.dataset.action === "toggle") {
      await api(`/api/admin/products/${encodeURIComponent(product.id)}`, {
        method: "PATCH",
        token: state.adminToken,
        body: { soldOut: !product.soldOut }
      });
    }

    if (button.dataset.action === "price") {
      const input = els.adminProducts.querySelector(`[data-price-input="${cssEscape(product.id)}"]`);
      const price = Number(input?.value);
      if (!Number.isFinite(price) || price <= 0) {
        toast("Enter a valid price.");
        return;
      }
      await api(`/api/admin/products/${encodeURIComponent(product.id)}`, {
        method: "PATCH",
        token: state.adminToken,
        body: { price: Math.round(price) }
      });
      toast(`${product.name} price updated.`);
    }

    if (button.dataset.action === "delete") {
      if (!confirm(`Delete ${product.name}?`)) return;
      await api(`/api/admin/products/${encodeURIComponent(product.id)}`, {
        method: "DELETE",
        token: state.adminToken
      });
    }

    await refreshPublicData();
    await loadAdminDashboard();
    renderAll();
  });

  els.adminOrders.addEventListener("change", async (event) => {
    const select = event.target.closest("select[data-order-id]");
    if (!select) return;
    await api(`/api/admin/orders/${encodeURIComponent(select.dataset.orderId)}`, {
      method: "PATCH",
      token: state.adminToken,
      body: { status: select.value }
    });
    await loadAdminDashboard();
    renderAdmin();
  });

  document.querySelector("#broadcast-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    await api("/api/admin/notices", {
      method: "POST",
      token: state.adminToken,
      body: {
        title: document.querySelector("#broadcast-title").value,
        message: document.querySelector("#broadcast-message").value
      }
    });
    event.target.reset();
    await refreshPublicData();
    await loadAdminDashboard();
    renderAll();
    toast("Update published.");
  });

  document.querySelector("#broadcast-whatsapp").addEventListener("click", () => {
    const title = document.querySelector("#broadcast-title").value.trim();
    const message = document.querySelector("#broadcast-message").value.trim();
    if (!title || !message) {
      toast("Enter a title and message first.");
      return;
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(`KSiraa update\n\n${title}\n${message}`)}`, "_blank");
  });
}

function renderAll() {
  renderNotices();
  renderProducts();
  renderSummary();
  renderCustomerStatus();
  renderAdmin();
  renderMyOrders();
}

function renderNotices() {
  els.noticeList.innerHTML = "";
  const uniqueNotices = [];
  const seen = new Set();
  state.notices.forEach((notice) => {
    const title = String(notice.title || "").toLowerCase();
    const key = title === "welcome to ksiraa" ? "welcome-to-ksiraa" : `${notice.title}|${notice.message}`.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    uniqueNotices.push(notice);
  });

  uniqueNotices.slice(0, 3).forEach((notice) => {
    const article = document.createElement("article");
    article.className = "notice";
    article.innerHTML = `<strong>${escapeHtml(notice.title)}</strong><span>${escapeHtml(notice.message)}</span>`;
    els.noticeList.append(article);
  });
}

function renderProducts() {
  els.productGrid.innerHTML = "";
  state.products.forEach((product) => {
    const node = els.productTemplate.content.firstElementChild.cloneNode(true);
    node.classList.toggle("sold-out", product.soldOut);
    node.querySelector("h3").textContent = product.name;
    node.querySelector(".product-size").textContent = product.soldOut ? `${product.size} | Sold out` : product.size;
    node.querySelector(".product-description").textContent = product.description;
    node.querySelector(".product-price").textContent = money(product.price);
    node.querySelector(".qty-value").textContent = state.cart[product.id] || 0;
    node.querySelector(".qty-minus").addEventListener("click", () => updateQty(product.id, -1));
    node.querySelector(".qty-plus").addEventListener("click", () => updateQty(product.id, 1));
    els.productGrid.append(node);
  });
}

function renderSummary() {
  const items = cartItems();
  els.summaryList.innerHTML = "";

  if (!items.length) {
    els.summaryList.innerHTML = `<p class="summary-empty">Add products to create an order.</p>`;
    els.orderTotal.textContent = money(0);
    return;
  }

  let total = 0;
  items.forEach(({ product, qty }) => {
    total += product.price * qty;
    const row = document.createElement("div");
    row.className = "summary-item";
    row.innerHTML = `<span>${escapeHtml(product.name)} x ${qty}</span><strong>${money(product.price * qty)}</strong>`;
    els.summaryList.append(row);
  });

  els.orderTotal.textContent = money(total);
}

function renderCustomerStatus() {
  if (!state.customer) {
    els.customerStatus.innerHTML = `<button class="small-action" type="button" id="inline-login">Login to save orders</button>`;
    document.querySelector("#inline-login").addEventListener("click", openLogin);
    return;
  }
  els.customerStatus.innerHTML = `<strong>${escapeHtml(state.customer.name || "Logged in")}</strong><span>${escapeHtml(state.customer.phone)}</span>`;
}

function renderMyOrders() {
  if (!state.customer) {
    els.myOrders.innerHTML = `<div class="empty-state">Login with mobile number to see your saved orders.</div>`;
    return;
  }
  const orders = state.myOrders || [];
  if (!orders.length) {
    els.myOrders.innerHTML = `<div class="empty-state">No orders yet.</div>`;
    return;
  }
  els.myOrders.innerHTML = orders.map(orderCard).join("");
}

function renderAdmin() {
  renderAdminProducts();
  renderAdminOrders();
  renderAdminCustomers();
}

function renderAdminProducts() {
  els.adminProducts.innerHTML = "";
  state.products.forEach((product) => {
    const row = document.createElement("div");
    row.className = "admin-product";
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(product.name)}</strong>
        <p>${escapeHtml(product.size)} | ${money(product.price)}</p>
        <span class="status-pill ${product.soldOut ? "sold" : "available"}">${product.soldOut ? "Sold out" : "Available"}</span>
      </div>
      <div class="admin-actions">
        <label class="price-edit">
          Price
          <input data-price-input="${product.id}" inputmode="numeric" value="${product.price}" aria-label="Price for ${escapeHtml(product.name)}">
        </label>
        <button class="mini-button" data-action="price" data-id="${product.id}" type="button">Save price</button>
        <button class="mini-button" data-action="toggle" data-id="${product.id}" type="button">${product.soldOut ? "Mark available" : "Mark sold out"}</button>
        <button class="mini-button danger" data-action="delete" data-id="${product.id}" type="button">Delete</button>
      </div>
    `;
    els.adminProducts.append(row);
  });
}

function renderAdminOrders() {
  const orders = state.admin.orders || [];
  if (!orders.length) {
    els.adminOrders.innerHTML = `<div class="empty-state">No orders yet.</div>`;
    return;
  }
  els.adminOrders.innerHTML = orders.map((order) => `
    <article class="order-card">
      <div>
        <strong>${escapeHtml(order.customerName)} | ${escapeHtml(order.customerPhone)}</strong>
        <p>${escapeHtml(order.address)}</p>
        <p>${escapeHtml(order.frequency)} | ${escapeHtml(order.deliveryTime)} | ${escapeHtml(order.paymentMethod || "Cash on delivery")} | ${money(order.total)}</p>
        <p>Payment: ${escapeHtml(order.paymentStatus || "Pending")}</p>
        <ul>${order.items.map((item) => `<li>${escapeHtml(item.name)} x ${item.qty}</li>`).join("")}</ul>
      </div>
      <label>
        Status
        <select data-order-id="${order.id}">
          ${["Received", "Preparing", "Out for delivery", "Delivered", "Paused", "Cancelled"].map((status) => `<option ${order.status === status ? "selected" : ""}>${status}</option>`).join("")}
        </select>
      </label>
    </article>
  `).join("");
}

function renderAdminCustomers() {
  const customers = state.admin.customers || [];
  if (!customers.length) {
    els.adminCustomers.innerHTML = `<div class="empty-state">No customers yet.</div>`;
    return;
  }
  els.adminCustomers.innerHTML = customers.map((customer) => `
    <div class="customer-row">
      <strong>${escapeHtml(customer.name || "Customer")}</strong>
      <span>${escapeHtml(customer.phone)}</span>
      <p>${escapeHtml(customer.address || "No address saved")}</p>
    </div>
  `).join("");
}

function updateQty(productId, delta) {
  const product = state.products.find((item) => item.id === productId);
  if (!product || product.soldOut) return;
  const next = Math.max(0, (state.cart[productId] || 0) + delta);
  if (next === 0) {
    delete state.cart[productId];
  } else {
    state.cart[productId] = next;
  }
  saveCart();
  renderProducts();
  renderSummary();
}

function orderPayload() {
  const items = cartItems();
  if (!items.length) {
    toast("Please add at least one product.");
    return null;
  }
  const payload = {
    name: document.querySelector("#customer-name").value.trim(),
    phone: document.querySelector("#customer-phone").value.trim(),
    address: document.querySelector("#customer-address").value.trim(),
    frequency: document.querySelector("#repeat-frequency").value,
    deliveryTime: document.querySelector("#delivery-time").value,
    paymentMethod: document.querySelector("#payment-method").value,
    items: items.map(({ product, qty }) => ({ productId: product.id, qty }))
  };
  if (!payload.name || !payload.phone || !payload.address) {
    toast("Name, mobile number, and address are required.");
    return null;
  }
  return payload;
}

function cartItems() {
  return Object.entries(state.cart)
    .map(([id, qty]) => ({
      product: state.products.find((item) => item.id === id),
      qty
    }))
    .filter((item) => item.product && item.qty > 0 && !item.product.soldOut);
}

function buildWhatsAppOrder(payload) {
  const items = cartItems();
  const total = items.reduce((sum, item) => sum + item.product.price * item.qty, 0);
  const lines = items.map(({ product, qty }) => `- ${product.name} (${product.size}) x ${qty}: ${money(product.price * qty)}`);
  return [
    "New KSiraa order",
    "",
    `Customer: ${payload.name}`,
    `Mobile: ${payload.phone}`,
    `Address: ${payload.address}`,
    `Delivery frequency: ${payload.frequency}`,
    `Time: ${payload.deliveryTime}`,
    `Payment: ${payload.paymentMethod}`,
    "",
    "Products:",
    ...lines,
    "",
    `Total: ${money(total)}`
  ].join("\n");
}

async function loadMyOrders() {
  if (!state.customerToken) return;
  try {
    const result = await api("/api/my-orders", { token: state.customerToken });
    state.myOrders = result.orders;
    renderMyOrders();
  } catch {
    state.myOrders = [];
  }
}

async function loadAdminDashboard(options = {}) {
  if (!state.adminToken) return;
  try {
    const result = await api("/api/admin/dashboard", { token: state.adminToken });
    state.products = result.products;
    state.admin.orders = result.orders;
    state.admin.customers = result.customers;
    state.notices = result.notices;
    renderAll();
  } catch (error) {
    if (!options.silent) toast(error.message);
    logoutAdmin(false);
  }
}

function fillCustomerForm(order) {
  const customer = state.customer || {};
  document.querySelector("#customer-name").value = order?.customerName || customer.name || "";
  document.querySelector("#customer-phone").value = order?.customerPhone || customer.phone || "";
  document.querySelector("#customer-address").value = order?.address || customer.address || "";
}

function openLogin() {
  document.querySelector("#login-modal").classList.remove("hidden");
  document.querySelector("#otp-request-form").classList.remove("hidden");
  document.querySelector("#otp-verify-form").classList.add("hidden");
  document.querySelector("#otp-phone").value = document.querySelector("#customer-phone").value || "";
}

function closeLogin() {
  document.querySelector("#login-modal").classList.add("hidden");
}

function logoutCustomer(showMessage) {
  state.customer = null;
  state.customerToken = "";
  state.myOrders = [];
  localStorage.removeItem("ksiraa-customer-token");
  renderCustomerStatus();
  renderMyOrders();
  if (showMessage) toast("Logged out.");
}

function logoutAdmin(showMessage) {
  state.adminToken = "";
  state.admin.orders = [];
  state.admin.customers = [];
  localStorage.removeItem("ksiraa-admin-token");
  showAdminContent(false);
  if (showMessage) toast("Admin logged out.");
}

function showAdminContent(show) {
  document.querySelector("#admin-login").classList.toggle("hidden", show);
  document.querySelector("#admin-content").classList.toggle("hidden", !show);
}

function saveCart() {
  localStorage.setItem("ksiraa-cart", JSON.stringify(state.cart));
}

function orderCard(order) {
  return `
    <article class="order-card">
      <div>
        <strong>${escapeHtml(order.status)} | ${money(order.total)}</strong>
        <p>${escapeHtml(order.frequency)} | ${escapeHtml(order.deliveryTime)} | ${escapeHtml(order.paymentMethod || "Cash on delivery")} | ${new Date(order.createdAt).toLocaleDateString("en-IN")}</p>
        <p>Payment: ${escapeHtml(order.paymentStatus || "Pending")}</p>
        <ul>${order.items.map((item) => `<li>${escapeHtml(item.name)} x ${item.qty}</li>`).join("")}</ul>
      </div>
    </article>
  `;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}

function money(value) {
  return `Rs. ${Number(value || 0).toLocaleString("en-IN")}`;
}

function toast(message) {
  alert(message);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function cssEscape(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}
