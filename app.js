const state = {
  config: {},
  products: [],
  cart: JSON.parse(localStorage.getItem("ksiraa-cart") || "{}"),
  notices: [],
  myOrders: [],
  customerProfile: JSON.parse(localStorage.getItem("ksiraa-customer-profile") || "null"),
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
  adminProducts: document.querySelector("#admin-products"),
  adminOrders: document.querySelector("#admin-orders"),
  adminCustomers: document.querySelector("#admin-customers"),
  myOrders: document.querySelector("#my-orders")
};

init();

async function init() {
  bindNavigation();
  bindOrderActions();
  bindAdminActions();
  await refreshPublicData();
  await restoreAdmin();
  fillCustomerForm();
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
  const adminPhoneInput = document.querySelector("#admin-phone");
  if (adminPhoneInput) adminPhoneInput.value = config.adminPhone;
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
        await loadMyOrders({ silent: true });
      }

      if (tab.dataset.view === "admin") {
        document.querySelector("#admin-view").classList.remove("hidden");
        if (state.adminToken) await loadAdminDashboard();
      }

      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });

  const brandHome = document.querySelector("#brand-home");
  if (brandHome) {
    brandHome.addEventListener("click", (event) => {
      event.preventDefault();
      document.querySelector('.tab[data-view="shop"]')?.click();
    });
  }

  document.querySelectorAll('a[href="#products-view"]').forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      document.querySelector('.tab[data-view="shop"]')?.classList.add("active");
      document.querySelector("#products-view")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

function bindOrderActions() {
  document.querySelector("#refresh-products").addEventListener("click", async () => {
    await refreshPublicData();
    renderAll();
  });


  document.querySelector("#place-order").addEventListener("click", async () => {
    const payload = orderPayload();
    if (!payload) return;

    const result = await api("/api/orders", {
      method: "POST",
      body: payload
    });
    state.cart = {};
    saveCart();
    state.customerProfile = {
      name: result.order.customerName,
      phone: result.order.customerPhone,
      address: result.order.address
    };
    localStorage.setItem("ksiraa-customer-profile", JSON.stringify(state.customerProfile));
    fillCustomerForm(result.order);
    await loadMyOrders({ silent: true });
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

  els.adminOrders.addEventListener("click", async (event) => {
    const button = event.target.closest('button[data-action="delete-order"]');
    if (!button) return;
    if (!confirm("Delete this order? This cannot be undone.")) return;
    await api(`/api/admin/orders/${encodeURIComponent(button.dataset.orderId)}`, {
      method: "DELETE",
      token: state.adminToken
    });
    await loadAdminDashboard();
    renderAdmin();
    toast("Order deleted.");
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

function renderMyOrders() {
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
        <p>Placed: ${escapeHtml(formatOrderDate(order.createdAt))}</p>
        <p>Payment: ${escapeHtml(order.paymentStatus || "Pending")}</p>
        <ul>${order.items.map((item) => `<li>${escapeHtml(item.name)} x ${item.qty}</li>`).join("")}</ul>
      </div>
      <div class="order-controls">
        <label>
          Status
          <select data-order-id="${order.id}">
            ${["Received", "Preparing", "Out for delivery", "Delivered", "Paused", "Cancelled"].map((status) => `<option ${order.status === status ? "selected" : ""}>${status}</option>`).join("")}
          </select>
        </label>
        <button class="mini-button danger" data-action="delete-order" data-order-id="${order.id}" type="button">Delete order</button>
      </div>
    </article>
  `).join("");
}

function formatOrderDate(value) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
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

async function loadMyOrders(options = {}) {
  try {
    const result = await api("/api/orders");
    state.myOrders = result.orders || [];
    renderMyOrders();
  } catch (error) {
    state.myOrders = [];
    renderMyOrders();
    if (!options.silent) toast(error.message);
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
  const profile = state.customerProfile || {};
  document.querySelector("#customer-name").value = order?.customerName || profile.name || "";
  document.querySelector("#customer-phone").value = order?.customerPhone || profile.phone || "";
  document.querySelector("#customer-address").value = order?.address || profile.address || "";
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
