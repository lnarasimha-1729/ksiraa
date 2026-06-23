const state = {
  config: {},
  products: [],
  carousel: [],
  cart: JSON.parse(localStorage.getItem("ksiraa-cart") || "{}"),
  notices: [],
  myOrders: [],
  customerProfile: JSON.parse(localStorage.getItem("ksiraa-customer-profile") || "null"),
  adminToken: localStorage.getItem("ksiraa-admin-token") || "",
  admin: {
    orders: [],
    customers: [],
    editingCustomerId: null,
    selectedCustomerIds: new Set(),
    customerSearch: ""
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
  adminNotices: document.querySelector("#admin-notices"),
  adminCarousel: document.querySelector("#admin-carousel"),
  myOrders: document.querySelector("#my-orders"),
  orderSuccessModal: document.querySelector("#order-success-modal"),
  orderSuccessId: document.querySelector("#order-success-id"),
  orderSuccessClose: document.querySelector("#order-success-close")
};

init();

async function init() {
  bindNavigation();
  bindOrderActions();
  bindAdminActions();
  bindOrderSuccessModal();
  await refreshPublicData();
  await restoreAdmin();
  fillCustomerForm();
  renderAll();
}

function bindOrderSuccessModal() {
  if (!els.orderSuccessModal) return;
  els.orderSuccessClose?.addEventListener("click", hideOrderSuccess);
  els.orderSuccessModal.addEventListener("click", (event) => {
    if (event.target === els.orderSuccessModal) hideOrderSuccess();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !els.orderSuccessModal.classList.contains("hidden")) {
      hideOrderSuccess();
    }
  });
}

// Default slide shown when the admin hasn't uploaded any carousel images yet.
const fallbackCarousel = [{ imageUrl: "assets/ksiraa-product.jpeg" }];
let carouselTimer = null;

function renderHeroCarousel() {
  const carousel = document.querySelector("#hero-carousel");
  const track = document.querySelector("#carousel-track");
  if (!carousel || !track) return;

  if (carouselTimer) {
    clearInterval(carouselTimer);
    carouselTimer = null;
  }

  // Stops auto-advance (used when a user starts playing a video).
  const stopAuto = () => {
    if (carouselTimer) clearInterval(carouselTimer);
    carouselTimer = null;
  };

  const images = (state.carousel && state.carousel.length) ? state.carousel : fallbackCarousel;
  const prevBtn = carousel.querySelector("#carousel-prev");
  const nextBtn = carousel.querySelector("#carousel-next");
  const dotsWrap = carousel.querySelector("#carousel-dots");

  track.innerHTML = "";
  dotsWrap.innerHTML = "";
  // Holds the play/pause wiring for each video slide so the rotation logic can pause/check them.
  const videoControllers = [];
  images.forEach((slide) => {
    const wrap = document.createElement("div");
    wrap.className = "carousel-slide";
    if (slide.mediaType === "video") {
      wrap.classList.add("is-video");
      const video = document.createElement("video");
      video.src = slide.imageUrl;
      video.loop = false;
      video.playsInline = true;
      video.setAttribute("playsinline", "");
      video.preload = "metadata";

      const playBtn = document.createElement("button");
      playBtn.type = "button";
      playBtn.className = "carousel-play";
      playBtn.setAttribute("aria-label", "Play video");
      playBtn.innerHTML = '<span class="carousel-play-ring" aria-hidden="true"></span>' +
        '<span class="carousel-play-core" aria-hidden="true">' +
        '<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><path d="M6 4.5v15a1 1 0 0 0 1.53.85l12-7.5a1 1 0 0 0 0-1.7l-12-7.5A1 1 0 0 0 6 4.5z"/></svg>' +
        '</span>';

      const toggle = (event) => {
        event.stopPropagation();
        if (video.paused) {
          stopAuto();                 // user is watching — don't advance the carousel
          const p = video.play();
          // play() returns a promise that rejects if the source can't be played.
          if (p && typeof p.catch === "function") {
            p.catch((err) => {
              console.warn("Carousel video could not play:", err?.message || err);
              wrap.classList.add("video-error");
            });
          }
        } else {
          video.pause();
        }
      };
      playBtn.addEventListener("click", toggle);
      video.addEventListener("click", toggle);
      video.addEventListener("play", () => { wrap.classList.add("playing"); stopAuto(); });
      video.addEventListener("pause", () => { wrap.classList.remove("playing"); });
      video.addEventListener("ended", () => { wrap.classList.remove("playing"); });
      video.addEventListener("error", () => { wrap.classList.add("video-error"); });

      wrap.appendChild(video);
      wrap.appendChild(playBtn);
      videoControllers.push({ video });
    } else {
      const img = document.createElement("img");
      img.src = slide.imageUrl;
      img.alt = "KSiraa";
      img.loading = "lazy";
      wrap.appendChild(img);
    }
    track.appendChild(wrap);
  });

  const single = images.length <= 1;
  prevBtn?.classList.toggle("hidden", single);
  nextBtn?.classList.toggle("hidden", single);
  if (single) {
    track.style.transform = "translateX(0)";
    return;
  }

  // Clone the first slide and append it, so advancing past the last slide can
  // animate forward into the clone, then snap (no transition) back to the real first.
  const firstClone = track.firstElementChild.cloneNode(true);
  firstClone.setAttribute("aria-hidden", "true");
  track.appendChild(firstClone);

  const realCount = images.length;
  let position = 0; // 0..realCount (realCount === the clone)
  const setTransform = (animate) => {
    track.style.transition = animate ? "transform 0.5s ease" : "none";
    track.style.transform = `translateX(-${position * 100}%)`;
  };
  const syncDots = () => {
    const active = position % realCount;
    dotsWrap.querySelectorAll(".carousel-dot").forEach((dot, i) => {
      dot.classList.toggle("active", i === active);
      dot.setAttribute("aria-selected", i === active ? "true" : "false");
    });
  };

  const next = () => {
    if (position >= realCount) return; // already animating into clone
    position += 1;
    setTransform(true);
    syncDots();
  };
  const prev = () => {
    if (position <= 0) {
      // Jump (no animation) to the clone position, then animate back one step.
      position = realCount;
      setTransform(false);
      void track.offsetWidth; // force reflow so the next transition animates
    }
    position -= 1;
    setTransform(true);
    syncDots();
  };
  const goTo = (index) => {
    position = index;
    setTransform(true);
    syncDots();
  };

  // After the forward animation into the clone finishes, snap back to the real first slide.
  track.addEventListener("transitionend", () => {
    if (position >= realCount) {
      position = 0;
      setTransform(false);
    }
  });

  const anyVideoPlaying = () => videoControllers.some((c) => !c.video.paused && !c.video.ended);
  const pauseAllVideos = () => videoControllers.forEach((c) => { if (!c.video.paused) c.video.pause(); });

  const start = () => {
    if (carouselTimer) clearInterval(carouselTimer);
    if (anyVideoPlaying()) return; // don't auto-advance while a video is playing
    carouselTimer = setInterval(next, 5000);
  };

  // Manual navigation: stop any playing video so it doesn't keep going off-screen.
  const navNext = () => { pauseAllVideos(); next(); start(); };
  const navPrev = () => { pauseAllVideos(); prev(); start(); };

  images.forEach((_, i) => {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "carousel-dot";
    dot.setAttribute("role", "tab");
    dot.setAttribute("aria-label", `Go to image ${i + 1}`);
    dot.addEventListener("click", () => { pauseAllVideos(); goTo(i); start(); });
    dotsWrap.appendChild(dot);
  });

  nextBtn.onclick = navNext;
  prevBtn.onclick = navPrev;
  carousel.onmouseenter = stopAuto;
  carousel.onmouseleave = start;

  // When a played video finishes or is paused, resume the auto-rotation.
  videoControllers.forEach((c) => {
    c.video.addEventListener("ended", start);
    c.video.addEventListener("pause", start);
  });

  position = 0;
  setTransform(false);
  syncDots();
  start();
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
  // Carousel is optional — a failure here (e.g. older server) must not blank the page.
  try {
    const carousel = await api("/api/carousel");
    state.carousel = carousel.slides || [];
  } catch {
    state.carousel = [];
  }
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
  const path = location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll(".tab.tab-link").forEach((link) => {
    const href = link.getAttribute("href") || "";
    if (href === path || (href === "index.html" && (path === "" || path === "index.html"))) {
      link.classList.add("active");
    }
  });

  document.querySelectorAll("[data-view]").forEach((tab) => {
    tab.addEventListener("click", async () => {
      document.querySelectorAll("[data-view]").forEach((item) => item.classList.remove("active"));
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
      const onHome = location.pathname.endsWith("/") || location.pathname.endsWith("index.html");
      if (!onHome) return;
      event.preventDefault();
      document.querySelectorAll("[data-view]").forEach((item) => item.classList.remove("active"));
      document.querySelectorAll(".view-section").forEach((section) => section.classList.add("hidden"));
      document.querySelector("#shop-view")?.classList.remove("hidden");
      document.querySelector("#products-view")?.classList.remove("hidden");
      document.querySelector(".notice-band")?.classList.remove("hidden");
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  const menuToggle = document.querySelector("#nav-menu-toggle");
  const menuDropdown = document.querySelector("#nav-menu-dropdown");
  if (menuToggle && menuDropdown) {
    const closeMenu = () => {
      menuDropdown.classList.add("hidden");
      menuToggle.setAttribute("aria-expanded", "false");
    };
    const openMenu = () => {
      menuDropdown.classList.remove("hidden");
      menuToggle.setAttribute("aria-expanded", "true");
    };
    menuToggle.addEventListener("click", (event) => {
      event.stopPropagation();
      if (menuDropdown.classList.contains("hidden")) openMenu();
      else closeMenu();
    });
    menuDropdown.addEventListener("click", () => closeMenu());
    document.addEventListener("click", (event) => {
      if (!menuDropdown.contains(event.target) && !menuToggle.contains(event.target)) closeMenu();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeMenu();
    });
  }

  document.querySelectorAll('a[href="#products-view"]').forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      document.querySelector('.tab[data-view="shop"]')?.classList.add("active");
      const topbar = document.querySelector(".topbar");
      const topbarH = topbar ? topbar.getBoundingClientRect().height : 0;
      const products = document.querySelector("#products-view");
      const target = products ? products.getBoundingClientRect().top + window.scrollY - topbarH - 16 : 0;
      window.scrollTo({ top: target, behavior: "smooth" });
    });
  });
}

function bindOrderActions() {
  document.querySelector("#place-order").addEventListener("click", async (event) => {
    const payload = orderPayload();
    if (!payload) return;

    const button = event.currentTarget;
    button.disabled = true;
    showOrderProcessing();
    try {
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
      renderProducts();
      renderSummary();
      if (result.order.paymentUrl) {
        window.open(result.order.paymentUrl, "_blank");
      }
      showOrderSuccess();
      loadMyOrders({ silent: true }).catch(() => {});
      loadAdminDashboard({ silent: true }).catch(() => {});
    } catch (error) {
      hideOrderSuccess();
      toast(error.message || "Could not place the order.");
    } finally {
      button.disabled = false;
    }
  });

  document.querySelector("#send-whatsapp").addEventListener("click", () => {
    const payload = orderPayload();
    if (!payload) return;
    const text = buildWhatsAppOrder(payload);
    window.open(`https://wa.me/${state.config.ownerWhatsApp}?text=${encodeURIComponent(text)}`, "_blank");
  });
}

function bindAdminActions() {
  document.querySelectorAll("[data-admin-tab]").forEach((tab) => {
    tab.addEventListener("click", () => {
      const target = tab.dataset.adminTab;
      document.querySelectorAll("[data-admin-tab]").forEach((item) => item.classList.toggle("active", item === tab));
      document.querySelectorAll("[data-admin-panel]").forEach((panel) => {
        panel.classList.toggle("hidden", panel.dataset.adminPanel !== target);
      });
    });
  });

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

  const carouselFile = document.querySelector("#carousel-file");
  const carouselPreview = document.querySelector("#carousel-preview");
  const carouselPreviewVideo = document.querySelector("#carousel-preview-video");
  carouselFile?.addEventListener("change", () => {
    const file = carouselFile.files?.[0];
    carouselPreview?.classList.add("hidden");
    carouselPreviewVideo?.classList.add("hidden");
    if (!file) return;
    const isVideo = file.type.startsWith("video/");
    const reader = new FileReader();
    reader.onload = () => {
      if (isVideo && carouselPreviewVideo) {
        carouselPreviewVideo.src = reader.result;
        carouselPreviewVideo.classList.remove("hidden");
      } else if (carouselPreview) {
        carouselPreview.src = reader.result;
        carouselPreview.classList.remove("hidden");
      }
    };
    reader.readAsDataURL(file);
  });

  document.querySelector("#carousel-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const file = carouselFile?.files?.[0];
    if (!file) {
      toast("Choose an image or video to upload.");
      return;
    }
    const isVideo = file.type.startsWith("video/");
    const maxBytes = isVideo ? 40 * 1024 * 1024 : 6 * 1024 * 1024;
    if (file.size > maxBytes) {
      toast(isVideo ? "Video is too large (max 40 MB)." : "Image is too large (max 6 MB).");
      return;
    }
    const dataUrl = await fileToDataUrl(file);
    await api("/api/admin/carousel", {
      method: "POST",
      token: state.adminToken,
      body: { image: dataUrl }
    });
    event.target.reset();
    carouselPreview?.classList.add("hidden");
    carouselPreviewVideo?.classList.add("hidden");
    await refreshPublicData();
    renderAll();
    toast(isVideo ? "Video added to carousel." : "Image added to carousel.");
  });

  els.adminCarousel?.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const action = button.dataset.action;

    if (action === "delete-slide") {
      if (!confirm("Remove this item from the carousel?")) return;
      await api(`/api/admin/carousel/${encodeURIComponent(button.dataset.id)}`, {
        method: "DELETE",
        token: state.adminToken
      });
      await refreshPublicData();
      renderAll();
      toast("Removed.");
      return;
    }

    if (action === "move-up" || action === "move-down") {
      const ids = (state.carousel || []).map((s) => s.id);
      const from = ids.indexOf(button.dataset.id);
      const to = action === "move-up" ? from - 1 : from + 1;
      if (from < 0 || to < 0 || to >= ids.length) return;
      [ids[from], ids[to]] = [ids[to], ids[from]];
      await saveCarouselOrder(ids);
    }
  });

  // Drag-and-drop reordering of carousel rows.
  bindCarouselDragReorder();

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

    if (button.dataset.action === "size") {
      const input = els.adminProducts.querySelector(`[data-size-input="${cssEscape(product.id)}"]`);
      const size = String(input?.value || "").trim();
      if (!size) {
        toast("Enter a weight.");
        return;
      }
      await api(`/api/admin/products/${encodeURIComponent(product.id)}`, {
        method: "PATCH",
        token: state.adminToken,
        body: { size }
      });
      toast(`${product.name} weight updated.`);
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

  els.adminCustomers.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const customerId = button.dataset.customerId;
    const action = button.dataset.action;

    if (action === "edit-customer") {
      state.admin.editingCustomerId = customerId;
      renderAdminCustomers();
      return;
    }

    if (action === "cancel-customer") {
      state.admin.editingCustomerId = null;
      renderAdminCustomers();
      return;
    }

    if (action === "save-customer") {
      const root = els.adminCustomers;
      const name = root.querySelector(`[data-customer-field="name"][data-customer-id="${cssEscape(customerId)}"]`)?.value || "";
      const phone = root.querySelector(`[data-customer-field="phone"][data-customer-id="${cssEscape(customerId)}"]`)?.value || "";
      const address = root.querySelector(`[data-customer-field="address"][data-customer-id="${cssEscape(customerId)}"]`)?.value || "";
      if (!name.trim() || !phone.trim() || !address.trim()) {
        toast("Name, phone, and address are required.");
        return;
      }
      await api(`/api/admin/customers/${encodeURIComponent(customerId)}`, {
        method: "PATCH",
        token: state.adminToken,
        body: { name, phone, address }
      });
      state.admin.editingCustomerId = null;
      await loadAdminDashboard();
      renderAdmin();
      toast("Customer updated.");
      return;
    }

    if (action === "delete-customer") {
      if (!confirm("Delete this customer? Their past orders will remain.")) return;
      await api(`/api/admin/customers/${encodeURIComponent(customerId)}`, {
        method: "DELETE",
        token: state.adminToken
      });
      state.admin.selectedCustomerIds.delete(customerId);
      await loadAdminDashboard();
      renderAdmin();
      toast("Customer deleted.");
    }
  });

  els.adminCustomers.addEventListener("change", (event) => {
    const rowCheckbox = event.target.closest("input[data-customer-select]");
    if (rowCheckbox) {
      const id = rowCheckbox.dataset.customerSelect;
      if (rowCheckbox.checked) state.admin.selectedCustomerIds.add(id);
      else state.admin.selectedCustomerIds.delete(id);
      renderAdminCustomers();
      return;
    }
    const allCheckbox = event.target.closest("#customer-select-all");
    if (allCheckbox) {
      const customers = state.admin.customers || [];
      const query = String(state.admin.customerSearch || "").trim().toLowerCase();
      const targets = query
        ? customers.filter((c) => `${c.name || ""} ${c.phone || ""} ${c.address || ""}`.toLowerCase().includes(query))
        : customers;
      const everySelected = targets.every((c) => state.admin.selectedCustomerIds.has(c.id));
      if (everySelected) {
        targets.forEach((c) => state.admin.selectedCustomerIds.delete(c.id));
      } else {
        targets.forEach((c) => state.admin.selectedCustomerIds.add(c.id));
      }
      renderAdminCustomers();
    }
  });

  let customerSearchTimer = null;
  els.adminCustomers.addEventListener("input", (event) => {
    const input = event.target.closest("#customer-search-input");
    if (!input) return;
    const value = input.value;
    clearTimeout(customerSearchTimer);
    customerSearchTimer = setTimeout(() => {
      state.admin.customerSearch = value;
      renderAdminCustomers();
    }, 120);
  });

  els.adminCustomers.addEventListener("click", (event) => {
    const clearBtn = event.target.closest("#customer-search-clear");
    if (!clearBtn) return;
    state.admin.customerSearch = "";
    renderAdminCustomers();
  });

  els.adminNotices?.addEventListener("click", async (event) => {
    const button = event.target.closest('button[data-action="delete-notice"]');
    if (!button) return;
    if (!confirm("Delete this update?")) return;
    await api(`/api/admin/notices/${encodeURIComponent(button.dataset.noticeId)}`, {
      method: "DELETE",
      token: state.adminToken
    });
    await refreshPublicData();
    await loadAdminDashboard();
    renderAll();
    toast("Update deleted.");
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

  document.querySelector("#broadcast-whatsapp").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const title = document.querySelector("#broadcast-title").value.trim();
    const message = document.querySelector("#broadcast-message").value.trim();
    if (!title || !message) {
      toast("Enter a title and message first.");
      return;
    }

    const selectedIds = Array.from(state.admin.selectedCustomerIds);
    // WhatsApp only ever goes to the customers that are ticked. No selection → nothing is sent.
    if (!selectedIds.length) {
      toast("Select at least one customer to send WhatsApp.");
      return;
    }

    button.disabled = true;
    const originalLabel = button.textContent;
    button.textContent = `Sending to ${selectedIds.length}…`;
    try {
      const result = await api("/api/admin/whatsapp/send", {
        method: "POST",
        token: state.adminToken,
        body: { title, message, customerIds: selectedIds, toAll: false }
      });
      if (result.demo) {
        toast(`Demo mode — ${result.sent} would be sent. Set WHATSAPP_PHONE_NUMBER_ID + WHATSAPP_ACCESS_TOKEN to enable real send.`);
      } else if (result.failed) {
        const firstError = result.failures?.[0]?.error || "Unknown";
        toast(`Sent ${result.sent}, ${result.failed} failed. First error: ${firstError}`);
      } else {
        toast(`Sent WhatsApp to ${result.sent} customer${result.sent === 1 ? "" : "s"}.`);
      }
    } catch (error) {
      toast(error.message || "Failed to send WhatsApp.");
    } finally {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  });
}


function renderAll() {
  renderNotices();
  renderProducts();
  renderSummary();
  renderAdmin();
  renderMyOrders();
  renderHeroCarousel();
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
  renderAdminNotices();
  renderAdminCarousel();
}

function renderAdminCarousel() {
  if (!els.adminCarousel) return;
  const slides = state.carousel || [];
  if (!slides.length) {
    els.adminCarousel.innerHTML = `<div class="empty-state">No carousel items yet. The default product image is shown.</div>`;
    return;
  }
  els.adminCarousel.innerHTML = slides.map((slide, i) => {
    const media = slide.mediaType === "video"
      ? `<video src="${escapeHtml(slide.imageUrl)}" muted loop playsinline></video>`
      : `<img src="${escapeHtml(slide.imageUrl)}" alt="Slide ${i + 1}">`;
    const last = i === slides.length - 1;
    return `
    <div class="carousel-admin-row" draggable="true" data-id="${escapeHtml(slide.id)}">
      <span class="carousel-drag-handle" aria-hidden="true" title="Drag to reorder">&#8942;&#8942;</span>
      ${media}
      <div class="carousel-row-actions">
        <button class="mini-button order-btn" data-action="move-up" data-id="${escapeHtml(slide.id)}" type="button" aria-label="Move up"${i === 0 ? " disabled" : ""}>&#8593;</button>
        <button class="mini-button order-btn" data-action="move-down" data-id="${escapeHtml(slide.id)}" type="button" aria-label="Move down"${last ? " disabled" : ""}>&#8595;</button>
        <button class="mini-button danger" data-action="delete-slide" data-id="${escapeHtml(slide.id)}" type="button">Delete</button>
      </div>
    </div>`;
  }).join("");
}

async function saveCarouselOrder(ids) {
  try {
    const result = await api("/api/admin/carousel/reorder", {
      method: "POST",
      token: state.adminToken,
      body: { ids }
    });
    state.carousel = result.slides || [];
    renderAll();
  } catch (error) {
    toast(error.message || "Could not save the new order.");
    await refreshPublicData();
    renderAll();
  }
}

// Lets the admin drag carousel rows up/down to reorder them.
function bindCarouselDragReorder() {
  const list = els.adminCarousel;
  if (!list || list.dataset.dragBound === "1") return;
  list.dataset.dragBound = "1"; // bind the listeners once; rows are recreated on each render

  let draggingId = null;

  list.addEventListener("dragstart", (event) => {
    const row = event.target.closest(".carousel-admin-row");
    if (!row) return;
    draggingId = row.dataset.id;
    row.classList.add("dragging");
    event.dataTransfer.effectAllowed = "move";
  });

  list.addEventListener("dragend", () => {
    list.querySelectorAll(".carousel-admin-row").forEach((r) => r.classList.remove("dragging", "drag-over"));
    draggingId = null;
  });

  list.addEventListener("dragover", (event) => {
    event.preventDefault(); // allow drop
    const over = event.target.closest(".carousel-admin-row");
    list.querySelectorAll(".carousel-admin-row").forEach((r) => r.classList.toggle("drag-over", r === over && !r.classList.contains("dragging")));
  });

  list.addEventListener("drop", async (event) => {
    event.preventDefault();
    const target = event.target.closest(".carousel-admin-row");
    if (!target || !draggingId || target.dataset.id === draggingId) return;
    const ids = (state.carousel || []).map((s) => s.id);
    const from = ids.indexOf(draggingId);
    const to = ids.indexOf(target.dataset.id);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]); // move dragged item to target position
    await saveCarouselOrder(ids);
  });
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read the image file."));
    reader.readAsDataURL(file);
  });
}

function renderAdminNotices() {
  if (!els.adminNotices) return;
  const notices = state.notices || [];
  if (!notices.length) {
    els.adminNotices.innerHTML = `<div class="empty-state">No updates sent yet.</div>`;
    return;
  }
  els.adminNotices.innerHTML = notices.map((notice) => `
    <div class="notice-row">
      <div>
        <strong>${escapeHtml(notice.title)}</strong>
        <p>${escapeHtml(notice.message)}</p>
        <span class="notice-date">${escapeHtml(formatOrderDate(notice.createdAt))}</span>
      </div>
      <button class="mini-button danger" data-action="delete-notice" data-notice-id="${notice.id}" type="button">Delete</button>
    </div>
  `).join("");
}

function renderAdminProducts() {
  els.adminProducts.innerHTML = "";
  state.products.forEach((product) => {
    const row = document.createElement("div");
    row.className = "admin-product";
    row.innerHTML = `
      <div class="admin-product-head">
        <strong>${escapeHtml(product.name)}</strong>
        <span class="status-pill ${product.soldOut ? "sold" : "available"}">${product.soldOut ? "Sold out" : "Available"}</span>
      </div>
      <div class="admin-product-fields">
        <label class="field">
          <span>Price</span>
          <div class="field-row">
            <input data-price-input="${product.id}" inputmode="numeric" value="${product.price}" aria-label="Price for ${escapeHtml(product.name)}">
            <button class="mini-button" data-action="price" data-id="${product.id}" type="button">Save</button>
          </div>
        </label>
        <label class="field">
          <span>Weight</span>
          <div class="field-row">
            <input data-size-input="${product.id}" value="${escapeHtml(product.size)}" aria-label="Weight for ${escapeHtml(product.name)}" placeholder="e.g. 500 g">
            <button class="mini-button" data-action="size" data-id="${product.id}" type="button">Save</button>
          </div>
        </label>
      </div>
      <div class="admin-product-buttons">
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
    updateBroadcastSelectedCount();
    return;
  }

  const validIds = new Set(customers.map((c) => c.id));
  for (const id of Array.from(state.admin.selectedCustomerIds)) {
    if (!validIds.has(id)) state.admin.selectedCustomerIds.delete(id);
  }

  const query = String(state.admin.customerSearch || "").trim().toLowerCase();
  const filtered = query
    ? customers.filter((c) => {
        const haystack = `${c.name || ""} ${c.phone || ""} ${c.address || ""}`.toLowerCase();
        return haystack.includes(query);
      })
    : customers;

  const filteredAllSelected = filtered.length > 0 && filtered.every((c) => state.admin.selectedCustomerIds.has(c.id));
  const someSelected = state.admin.selectedCustomerIds.size > 0;

  const searchBar = `
    <div class="customer-search">
      <input type="search" id="customer-search-input" placeholder="Search by name, phone, or address" value="${escapeHtml(state.admin.customerSearch || "")}" autocomplete="off">
      ${query ? `<button class="mini-button" id="customer-search-clear" type="button">Clear</button>` : ""}
    </div>
  `;

  const header = `
    <div class="customer-select-bar">
      <label class="customer-select-all">
        <input type="checkbox" id="customer-select-all" ${filteredAllSelected ? "checked" : ""}>
        <span>${filteredAllSelected ? "Deselect all" : "Select all"}${query ? " (filtered)" : ""}</span>
      </label>
      <span class="customer-select-count">${state.admin.selectedCustomerIds.size} of ${customers.length} selected${query ? ` · ${filtered.length} shown` : ""}</span>
    </div>
  `;

  if (!filtered.length) {
    els.adminCustomers.innerHTML = searchBar + header + `<div class="empty-state">No customers match "${escapeHtml(query)}".</div>`;
    const input = els.adminCustomers.querySelector("#customer-search-input");
    if (input) {
      const v = input.value;
      input.focus();
      input.setSelectionRange(v.length, v.length);
    }
    updateBroadcastSelectedCount();
    return;
  }

  const rows = filtered.map((customer) => {
    if (state.admin.editingCustomerId === customer.id) {
      return `
        <div class="customer-row customer-row-editing">
          <div class="customer-edit-fields">
            <label class="field">
              <span>Name</span>
              <input data-customer-field="name" data-customer-id="${customer.id}" value="${escapeHtml(customer.name || "")}" placeholder="Customer name">
            </label>
            <label class="field">
              <span>Phone</span>
              <input data-customer-field="phone" data-customer-id="${customer.id}" inputmode="tel" value="${escapeHtml(customer.phone || "")}" placeholder="10 digit mobile">
            </label>
            <label class="field">
              <span>Address</span>
              <textarea data-customer-field="address" data-customer-id="${customer.id}" rows="2" placeholder="House, area, landmark">${escapeHtml(customer.address || "")}</textarea>
            </label>
          </div>
          <div class="customer-edit-actions">
            <button class="mini-button" data-action="save-customer" data-customer-id="${customer.id}" type="button">Save</button>
            <button class="mini-button" data-action="cancel-customer" data-customer-id="${customer.id}" type="button">Cancel</button>
          </div>
        </div>
      `;
    }
    const isSelected = state.admin.selectedCustomerIds.has(customer.id);
    return `
      <div class="customer-row${isSelected ? " customer-row-selected" : ""}">
        <label class="customer-select" aria-label="Select ${escapeHtml(customer.name || customer.phone)}">
          <input type="checkbox" data-customer-select="${customer.id}" ${isSelected ? "checked" : ""}>
        </label>
        <div>
          <strong>${escapeHtml(customer.name || "Customer")}</strong>
          <span>${escapeHtml(customer.phone)}</span>
          <p>${escapeHtml(customer.address || "No address saved")}</p>
        </div>
        <div class="customer-row-actions">
          <button class="mini-button" data-action="edit-customer" data-customer-id="${customer.id}" type="button">Edit</button>
          <button class="mini-button danger" data-action="delete-customer" data-customer-id="${customer.id}" type="button">Delete</button>
        </div>
      </div>
    `;
  }).join("");

  els.adminCustomers.innerHTML = searchBar + header + rows;
  const allCheckbox = els.adminCustomers.querySelector("#customer-select-all");
  if (allCheckbox && someSelected && !filteredAllSelected) allCheckbox.indeterminate = true;
  const input = els.adminCustomers.querySelector("#customer-search-input");
  if (input && query) {
    const v = input.value;
    input.focus();
    input.setSelectionRange(v.length, v.length);
  }
  updateBroadcastSelectedCount();
}

function updateBroadcastSelectedCount() {
  const count = state.admin.selectedCustomerIds.size;
  const node = document.querySelector("#broadcast-selected-count");
  if (!node) return;
  if (!count) {
    node.textContent = "";
    node.hidden = true;
  } else {
    node.textContent = `Sending to ${count} selected customer${count === 1 ? "" : "s"}`;
    node.hidden = false;
  }
}

function updateQty(productId, delta) {
  const product = state.products.find((item) => item.id === productId);
  if (!product || product.soldOut) return;
  const prev = state.cart[productId] || 0;
  const next = Math.max(0, prev + delta);
  if (next === 0) {
    delete state.cart[productId];
  } else {
    state.cart[productId] = next;
  }
  saveCart();
  renderProducts();
  renderSummary();
  if (delta > 0 && prev === 0) {
    showCartToast(product);
  }
}

function showCartToast(product) {
  const existing = document.querySelector("#cart-toast");
  if (existing) existing.remove();
  const toastEl = document.createElement("div");
  toastEl.id = "cart-toast";
  toastEl.className = "cart-toast";
  toastEl.innerHTML = `
    <div class="cart-toast-body">
      <strong>${escapeHtml(product.name)} added</strong>
      <span>Continue shopping or review your order.</span>
    </div>
    <button class="cart-toast-cta" type="button">Go to your order →</button>
  `;
  document.body.append(toastEl);
  requestAnimationFrame(() => toastEl.classList.add("cart-toast-in"));

  const dismiss = () => {
    toastEl.classList.remove("cart-toast-in");
    setTimeout(() => toastEl.remove(), 280);
  };

  toastEl.querySelector(".cart-toast-cta").addEventListener("click", () => {
    const orderPanel = document.querySelector(".order-panel");
    if (orderPanel) {
      const topbar = document.querySelector(".topbar");
      const offset = topbar ? topbar.getBoundingClientRect().height : 0;
      const top = orderPanel.getBoundingClientRect().top + window.scrollY - offset - 16;
      window.scrollTo({ top, behavior: "smooth" });
      const nameInput = document.querySelector("#customer-name");
      setTimeout(() => nameInput?.focus({ preventScroll: true }), 600);
    }
    dismiss();
  });

  clearTimeout(showCartToast._timer);
  showCartToast._timer = setTimeout(dismiss, 4200);
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

function showOrderProcessing() {
  if (!els.orderSuccessModal) return;
  const panel = els.orderSuccessModal.querySelector(".order-success-panel");
  panel?.setAttribute("data-state", "processing");
  panel?.querySelector(".order-success-processing")?.classList.remove("hidden");
  panel?.querySelector(".order-success-done")?.classList.add("hidden");
  els.orderSuccessClose?.classList.add("hidden");
  els.orderSuccessModal.classList.remove("hidden");
  els.orderSuccessModal.setAttribute("aria-hidden", "false");
}

function showOrderSuccess() {
  if (!els.orderSuccessModal) {
    toast("Order placed.");
    return;
  }
  const panel = els.orderSuccessModal.querySelector(".order-success-panel");
  panel?.setAttribute("data-state", "done");
  panel?.querySelector(".order-success-processing")?.classList.add("hidden");
  panel?.querySelector(".order-success-done")?.classList.remove("hidden");
  els.orderSuccessClose?.classList.remove("hidden");
  els.orderSuccessModal.classList.remove("hidden");
  els.orderSuccessModal.setAttribute("aria-hidden", "false");
}

function hideOrderSuccess() {
  if (!els.orderSuccessModal) return;
  els.orderSuccessModal.classList.add("hidden");
  els.orderSuccessModal.setAttribute("aria-hidden", "true");
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
