(() => {
  const SUPABASE_URL = "https://gyatmvavtkhfuaqruxsr.supabase.co";
  /** 仅使用 anon（publishable）公钥；切勿把 SERVICE_ROLE_KEY 写进前端 */
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd5YXRtdmF2dGtoZnVhcXJ1eHNyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY5NDQ0MDIsImV4cCI6MjA5MjUyMDQwMn0.ygWL2dkThGYtWXFwLp8FzmaqBRC9RWBJi4nLf9cEDTw";
  const AUTH_EMAIL_REDIRECT_OVERRIDE = "";
  const supabase = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

  /** 当前登录用户 UUID；请求经 anon 客户端发出并自动携带 JWT */
  async function requireAuthUserId() {
    if (!supabase) throw new Error("Supabase SDK not loaded.");
    const { data: authData, error } = await supabase.auth.getUser();
    if (error) throw error;
    const uid = authData?.user?.id;
    if (!uid) throw new Error("请先登录");
    return uid;
  }

  function safeNumber(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function isUUID(v) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v || ""));
  }
  /**
   * 将 products.image_urls 规范为字符串数组（兼容 jsonb / text / JSON 字符串、单列 URL）
   */
  function parseImageUrls(raw) {
    if (raw == null || raw === "") return [];
    if (Array.isArray(raw)) {
      return raw
        .filter(v => v != null && String(v).trim() !== "")
        .map(v => String(v).trim());
    }
    if (typeof raw === "object") {
      const keys = Object.keys(raw)
        .filter(k => /^\d+$/.test(k))
        .sort((a, b) => Number(a) - Number(b));
      if (keys.length) return keys.map(k => String(raw[k]).trim()).filter(Boolean);
    }
    if (typeof raw === "string") {
      const s = raw.trim();
      if (!s) return [];
      if (s.startsWith("[") && s.endsWith("]")) {
        try {
          const j = JSON.parse(s);
          if (Array.isArray(j)) {
            return j
              .filter(v => v != null && String(v).trim() !== "")
              .map(v => String(v).trim());
          }
        } catch (_) {
          /* 非 JSON 则当作单条 URL */
        }
      }
      return [s];
    }
    return [String(raw)].map(x => x.trim()).filter(Boolean);
  }
  function createUUID() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
  function parseMissingColumnFromError(error) {
    const text = String(error?.message || "");
    const pgMatch = text.match(/column\s+[^\s]+\.(\w+)\s+does not exist/i);
    if (pgMatch) return pgMatch[1];
    const pgrstMatch = text.match(/could not find the ['"](\w+)['"] column/i);
    if (pgrstMatch) return pgrstMatch[1];
    const triggerNewMatch = text.match(/record\s+["']new["']\s+has\s+no\s+field\s+["'](\w+)["']/i);
    if (triggerNewMatch) return triggerNewMatch[1];
    return "";
  }

  /**
   * 未执行多租户迁移（无 owner_id 列）时的兼容：去掉 SELECT/WHERE 中的 owner 条件。
   * 已迁移的数据库应保留为 true，以保证用户间隔离。
   */
  const ownerScope = { orders: true, customers: true, products: true };

  function formatSupabaseError(error) {
    if (!error) return "unknown";
    if (error instanceof Error && error.code == null && error.details == null && error.hint == null) {
      return error.message || "unknown";
    }
    return [
      `message: ${error.message || "unknown"}`,
      `code: ${error.code || "n/a"}`,
      `details: ${error.details || "n/a"}`,
      `hint: ${error.hint || "n/a"}`
    ].join("\n");
  }

  function normalizeCustomer(c) {
    const customerName = String(c.customer_name || c.name || "").trim();
    const contactPerson = String(c.contact_person || c.contact_name || "").trim();
    const phone = String(c.phone || c.contact_phone || c.contact || "").trim();
    const email = String(c.email || "").trim();
    const address = String(c.address || "").trim();
    const taxId = String(c.tax_id || "").trim();
    const remark = String(c.remark || "").trim();
    return {
      id: String(c.id || uid()),
      name: customerName,
      customer_name: customerName,
      contact: phone || contactPerson,
      contact_person: contactPerson,
      phone,
      email,
      address,
      tax_id: taxId,
      remark,
      cloud_id: isUUID(c.cloud_id) ? String(c.cloud_id) : (isUUID(c.id) ? String(c.id) : createUUID()),
      created_at: String(c.created_at || new Date().toISOString()),
      updated_at: String(c.updated_at || "")
    };
  }
  function normalizeOrder(o) {
    return {
      id: String(o.id || uid()),
      customer_name: String(o.customer_name || ""),
      customer_cloud_id: isUUID(o.customer_cloud_id) ? String(o.customer_cloud_id) : (isUUID(o.customer_id) ? String(o.customer_id) : ""),
      contract_no: String(o.contract_no || ""),
      created_at: String(o.created_at || new Date().toISOString()),
      status: String(o.status || "pending"),
      order_items: Array.isArray(o.order_items) ? o.order_items.map(i => ({
        product_name: String(i.product_name || ""),
        product_spec: String(i.product_spec || ""),
        quantity: safeNumber(i.quantity),
        unit_price: safeNumber(i.unit_price)
      })) : [],
      shipments: Array.isArray(o.shipments) ? o.shipments.map(s => ({
        shipment_id: String(s.shipment_id || uid()),
        shipment_no: String(s.shipment_no || ""),
        shipped_at: String(s.shipped_at || ""),
        items: Array.isArray(s.items) ? s.items.map(i => ({
          product_name: String(i.product_name || ""),
          quantity_shipped: safeNumber(i.quantity_shipped)
        })) : []
      })) : []
    };
  }
  function deriveOrderStatus(order) {
    const items = Array.isArray(order?.order_items) ? order.order_items : [];
    if (!items.length) return "pending";
    const shippedMap = {};
    (Array.isArray(order?.shipments) ? order.shipments : []).forEach(s =>
      (Array.isArray(s.items) ? s.items : []).forEach(i => {
        shippedMap[i.product_name] = safeNumber(shippedMap[i.product_name]) + safeNumber(i.quantity_shipped);
      })
    );
    let hasShipped = false;
    let allDone = true;
    items.forEach(i => {
      const ordered = safeNumber(i.quantity);
      const shipped = Math.min(ordered, safeNumber(shippedMap[i.product_name]));
      if (shipped > 0) hasShipped = true;
      if (shipped < ordered) allDone = false;
    });
    if (allDone) return "done";
    if (hasShipped) return "shipped";
    return "pending";
  }

  function toCloudOrder(order, customers = []) {
    const nOrder = normalizeOrder(order);
    const nItems = (nOrder.order_items || []).map(i => ({
      product_name: String(i.product_name || "").trim(),
      product_spec: String(i.product_spec || "").trim(),
      quantity: safeNumber(i.quantity),
      unit_price: safeNumber(i.unit_price)
    })).filter(i => i.product_name && i.quantity > 0);
    let customerId = nOrder.customer_cloud_id || "";
    if (!isUUID(customerId)) {
      const byName = customers.find(c => c.name === nOrder.customer_name);
      customerId = byName?.cloud_id || "";
    }
    return {
      order_no: String(nOrder.contract_no || ""),
      customer_id: isUUID(customerId) ? customerId : null,
      product: JSON.stringify(nItems),
      quantity: nItems.reduce((s, i) => s + safeNumber(i.quantity), 0),
      status: deriveOrderStatus(nOrder),
      created_at: nOrder.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
      order_payload: JSON.stringify(nOrder)
    };
  }

  function fromCloudOrder(row) {
    const payload = row?.order_payload;
    if (payload) {
      try {
        const parsed = typeof payload === "string" ? JSON.parse(payload) : payload;
        return normalizeOrder(parsed);
      } catch (_e) {}
    }
    let items = [];
    try {
      const parsed = typeof row?.product === "string" ? JSON.parse(row.product) : row?.product;
      if (Array.isArray(parsed)) {
        items = parsed.map(i => ({
          product_name: String(i.product_name || ""),
          product_spec: String(i.product_spec || ""),
          quantity: safeNumber(i.quantity),
          unit_price: safeNumber(i.unit_price)
        }));
      }
    } catch (_e2) {}
    return normalizeOrder({
      id: uid(),
      customer_name: "",
      customer_cloud_id: isUUID(row?.customer_id) ? String(row.customer_id) : "",
      contract_no: String(row?.order_no || ""),
      created_at: String(row?.created_at || new Date().toISOString()),
      status: String(row?.status || "pending"),
      order_items: items,
      shipments: []
    });
  }

  async function getOrders() {
    if (!supabase) return [];
    const uid = await requireAuthUserId();
    const columns = ["order_no", "customer_id", "product", "quantity", "status", "created_at", "updated_at", "order_payload", "owner_id"];
    const required = ["order_no", "customer_id", "created_at"];
    let data = null;
    let error = null;
    for (let i = 0; i < 8; i += 1) {
      let q = supabase.from("orders").select(columns.join(", "));
      if (ownerScope.orders) q = q.eq("owner_id", uid);
      ({ data, error } = await q.order("created_at", { ascending: true }));
      if (!error) break;
      const missing = parseMissingColumnFromError(error);
      if (missing === "owner_id") {
        ownerScope.orders = false;
        const idx = columns.indexOf("owner_id");
        if (idx >= 0) columns.splice(idx, 1);
        continue;
      }
      if (!missing || required.includes(missing)) break;
      const idx = columns.indexOf(missing);
      if (idx < 0) break;
      columns.splice(idx, 1);
    }
    if (error) throw error;
    return Array.isArray(data) ? data.map(fromCloudOrder) : [];
  }

  async function getCustomers() {
    if (!supabase) return [];
    const uid = await requireAuthUserId();
    const columns = [
      "id",
      "name",
      "customer_name",
      "contact",
      "contact_phone",
      "contact_name",
      "contact_person",
      "phone",
      "email",
      "address",
      "tax_id",
      "remark",
      "created_at",
      "updated_at",
      "owner_id"
    ];
    const required = ["id"];
    let data = null;
    let error = null;
    for (let i = 0; i < 8; i += 1) {
      let q = supabase.from("customers").select(columns.join(", "));
      if (ownerScope.customers) q = q.eq("owner_id", uid);
      ({ data, error } = await q.order("created_at", { ascending: true }));
      if (!error) break;
      const missing = parseMissingColumnFromError(error);
      if (missing === "owner_id") {
        ownerScope.customers = false;
        const idx = columns.indexOf("owner_id");
        if (idx >= 0) columns.splice(idx, 1);
        continue;
      }
      if (!missing || required.includes(missing)) break;
      const idx = columns.indexOf(missing);
      if (idx < 0) break;
      columns.splice(idx, 1);
    }
    if (error) throw error;
    return Array.isArray(data) ? data.map(row => normalizeCustomer({
      id: row.id,
      cloud_id: row.id,
      name: row.name || row.customer_name,
      customer_name: row.customer_name || row.name,
      contact: row.contact || row.contact_phone || row.contact_name,
      contact_person: row.contact_person || row.contact_name || "",
      phone: row.phone || row.contact_phone || "",
      email: row.email || "",
      address: row.address,
      tax_id: row.tax_id || "",
      remark: row.remark || "",
      created_at: row.created_at,
      updated_at: row.updated_at
    })) : [];
  }

  async function createOrUpdateCustomer(customer) {
    if (!supabase || !customer) return null;
    const uid = await requireAuthUserId();
    const c = normalizeCustomer(customer);
    let payload = {
      id: isUUID(c.cloud_id) ? c.cloud_id : createUUID(),
      name: c.customer_name || c.name,
      customer_name: c.customer_name || c.name,
      contact: c.contact || c.phone || c.contact_person,
      contact_phone: c.phone || c.contact || "",
      contact_name: c.contact_person || "",
      contact_person: c.contact_person || "",
      phone: c.phone || "",
      email: c.email || "",
      address: c.address,
      tax_id: c.tax_id || "",
      remark: c.remark || "",
      created_at: c.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
      owner_id: uid
    };
    let error = null;
    for (let i = 0; i < 8; i += 1) {
      ({ error } = await supabase.from("customers").upsert(payload, { onConflict: "id" }));
      if (!error) break;
      const missing = parseMissingColumnFromError(error);
      if (!missing || !(missing in payload)) break;
      const { [missing]: _drop, ...next } = payload;
      payload = next;
    }
    if (error) throw error;
    return payload.id;
  }

  async function deleteCustomer(customerCloudId) {
    if (!supabase || !isUUID(customerCloudId)) return;
    const uid = await requireAuthUserId();
    let q = supabase.from("customers").delete().eq("id", customerCloudId);
    if (ownerScope.customers) q = q.eq("owner_id", uid);
    let { error } = await q;
    if (error && parseMissingColumnFromError(error) === "owner_id") {
      ownerScope.customers = false;
      ({ error } = await supabase.from("customers").delete().eq("id", customerCloudId));
    }
    if (error) throw error;
  }

  async function createOrder(order, customers = []) {
    if (!supabase || !order) return;
    const uid = await requireAuthUserId();
    let payload = toCloudOrder(order, customers);
    payload.owner_id = uid;
    if (!payload.order_no) return;
    const required = ["order_no", "customer_id", "created_at"];
    let error = null;
    for (let i = 0; i < 8; i += 1) {
      ({ error } = await supabase.from("orders").upsert(payload, { onConflict: "order_no" }));
      if (!error) break;
      if (error.code === "22P02" && Object.prototype.hasOwnProperty.call(payload, "customer_id")) {
        const { customer_id, ...next } = payload;
        payload = next;
        continue;
      }
      const missing = parseMissingColumnFromError(error);
      if (!missing || required.includes(missing) || !(missing in payload)) break;
      const { [missing]: _drop, ...next } = payload;
      payload = next;
    }
    if (error) throw error;
  }

  async function createShipment(order, shipment, customers = []) {
    const nextOrder = normalizeOrder({
      ...order,
      shipments: [...(Array.isArray(order?.shipments) ? order.shipments : []), shipment]
    });
    await createOrder(nextOrder, customers);
  }

  async function deleteOrder(orderNo) {
    if (!supabase || !orderNo) return;
    const uid = await requireAuthUserId();
    let q = supabase.from("orders").delete().eq("order_no", orderNo);
    if (ownerScope.orders) q = q.eq("owner_id", uid);
    let { error } = await q;
    if (error && parseMissingColumnFromError(error) === "owner_id") {
      ownerScope.orders = false;
      ({ error } = await supabase.from("orders").delete().eq("order_no", orderNo));
    }
    if (error) throw error;
  }

  async function checkConnection() {
    if (!supabase) throw new Error("Supabase SDK not loaded.");
    const uid = await requireAuthUserId();
    let q = supabase.from("orders").select("order_no");
    if (ownerScope.orders) q = q.eq("owner_id", uid);
    let { error } = await q.limit(1);
    if (error && parseMissingColumnFromError(error) === "owner_id") {
      ownerScope.orders = false;
      ({ error } = await supabase.from("orders").select("order_no").limit(1));
    }
    if (error) throw error;
  }

  async function subscribeCloudChanges(onChange) {
    if (!supabase) return { unsubscribe() {} };
    const { data: authData, error } = await supabase.auth.getUser();
    if (error || !authData?.user?.id) return { unsubscribe() {} };
    const uid = authData.user.id;
    const ordersEv = { event: "*", schema: "public", table: "orders" };
    if (ownerScope.orders) ordersEv.filter = `owner_id=eq.${uid}`;
    const customersEv = { event: "*", schema: "public", table: "customers" };
    if (ownerScope.customers) customersEv.filter = `owner_id=eq.${uid}`;
    const channel = supabase
      .channel(`orders-customers-${uid.slice(0, 12)}`)
      .on("postgres_changes", ordersEv, onChange)
      .on("postgres_changes", customersEv, onChange)
      .subscribe();
    return { unsubscribe: () => supabase.removeChannel(channel) };
  }

  async function getSession() {
    if (!supabase) return null;
    const { data } = await supabase.auth.getSession();
    return data?.session || null;
  }
  function onAuthStateChange(handler) {
    if (!supabase) return { data: { subscription: { unsubscribe() {} } } };
    return supabase.auth.onAuthStateChange((_evt, session) => handler(session));
  }
  function authEmailRedirectTo() {
    const override = String(AUTH_EMAIL_REDIRECT_OVERRIDE || "").trim().replace(/\/$/, "");
    if (override) return override;
    if (typeof window === "undefined" || !window.location) return undefined;
    const { protocol, origin, pathname } = window.location;
    if (protocol === "file:") return undefined;
    if (!/^https?:/i.test(protocol)) return undefined;
    if (!origin || origin === "null") return undefined;
    return `${origin}${pathname || "/"}`;
  }

  function authRedirectBlockedReason() {
    if (typeof window === "undefined" || !window.location) return "";
    if (window.location.protocol === "file:") return "请用 http:// 打开本页面，不要用 file://。";
    return "";
  }

  async function login(email, password) {
    if (!supabase) return { error: { message: "Supabase SDK not loaded." } };
    return supabase.auth.signInWithPassword({ email, password });
  }
  async function register(email, password) {
    if (!supabase) return { error: { message: "Supabase SDK not loaded." } };
    const blocked = authRedirectBlockedReason();
    if (blocked) return { data: null, error: { message: blocked } };
    const redirectTo = authEmailRedirectTo();
    if (!redirectTo)
      return {
        data: null,
        error: { message: "回跳地址无效：请用 http(s) 打开本页，或在 api.js 设置 AUTH_EMAIL_REDIRECT_OVERRIDE 为地址栏完整 URL。" }
      };
    return supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: redirectTo }
    });
  }

  async function resendSignupConfirmation(email) {
    if (!supabase) return { error: { message: "Supabase SDK not loaded." } };
    const blocked = authRedirectBlockedReason();
    if (blocked) return { error: { message: blocked } };
    const redirectTo = authEmailRedirectTo();
    if (!redirectTo) return { error: { message: "回跳地址无效：请用 http(s) 打开本页或设置 AUTH_EMAIL_REDIRECT_OVERRIDE。" } };
    return supabase.auth.resend({
      type: "signup",
      email: String(email || "").trim(),
      options: { emailRedirectTo: redirectTo }
    });
  }
  async function logout() {
    if (!supabase) return { error: { message: "Supabase SDK not loaded." } };
    return supabase.auth.signOut();
  }

  /** 库存产品写入 Supabase 时使用的行 id（UUID）；本地演示用的 p1 / p-adhoc 等返回空字符串 */
  function getInventoryProductCloudId(product) {
    const p = product || {};
    const c = String(p.cloud_id || "").trim();
    if (isUUID(c)) return c;
    const id = String(p.id || "").trim();
    return isUUID(id) ? id : "";
  }

  /** 将 products 表行规范为前端库存页使用的结构（单预警阈值 ref_price 参考价，不含安全库存） */
  function normalizeInventoryProduct(row) {
    const r = row || {};
    const rawId = r.id != null ? String(r.id) : "";
    const cloudId = isUUID(rawId) ? rawId : "";
    let imgs = parseImageUrls(r.image_urls);
    if (!imgs.length) imgs = parseImageUrls(r.image);
    if (!imgs.length) imgs = parseImageUrls(r.image_url);
    if (!imgs.length) imgs = parseImageUrls(r.thumb_url);
    const firstImg = imgs[0] || String(r.image_url || r.thumb_url || "").trim();
    const ref =
      safeNumber(r.ref_price) ||
      safeNumber(r.sale_price ?? r.price) ||
      safeNumber(r.cost_price);
    const defW = safeNumber(r.default_warning_value);
    const warnEff =
      r.warning_value != null && r.warning_value !== ""
        ? safeNumber(r.warning_value)
        : safeNumber(r.warning_level ?? r.reorder_point ?? (defW || 1));
    return {
      id: cloudId || rawId || uid(),
      cloud_id: cloudId,
      sku: String(r.sku || r.model || r.product_code || "").trim(),
      name: String(r.name || r.product_name || "").trim(),
      category: String(r.category || "成品").trim(),
      unit: String(r.unit || "件").trim(),
      default_warning_value: defW || safeNumber(r.warning_level ?? 1),
      warning_level: warnEff,
      current_stock: safeNumber(r.current_stock ?? r.stock ?? r.qty),
      ref_price: ref,
      sale_price: safeNumber(r.sale_price ?? r.price),
      cost_price: safeNumber(r.cost_price),
      warehouse_location: String(r.warehouse_location || r.location || "").trim(),
      product_remark: String(r.product_remark || r.remark || "").trim(),
      warning_remark: String(r.warning_remark || "").trim(),
      image_urls: imgs.length ? imgs : firstImg ? [String(firstImg).trim()] : []
    };
  }

  async function getAuthOperatorLabel() {
    if (!supabase) return "";
    const { data: authData } = await supabase.auth.getUser();
    const u = authData?.user;
    if (!u) return "";
    return String(u.email || u.id || "").trim();
  }

  async function insertStockLedgerRow(initialRow) {
    let row = { ...initialRow };
    let lastErr = null;
    for (let i = 0; i < 24; i += 1) {
      const { error } = await supabase.from("stock_ledger").insert(row);
      if (!error) return;
      lastErr = error;
      const miss = parseMissingColumnFromError(error);
      if (!miss || !Object.prototype.hasOwnProperty.call(row, miss)) throw error;
      const next = { ...row };
      delete next[miss];
      row = next;
    }
    throw lastErr || new Error("stock_ledger insert failed");
  }

  function normalizeMergedMasterRow(m, prodExtra) {
    const pos = Array.isArray(m.inventory_position) ? m.inventory_position[0] : m.inventory_position;
    const qty = pos != null ? safeNumber(pos.quantity) : 0;
    const wOverride = pos != null && pos.warning_value != null ? safeNumber(pos.warning_value) : null;
    const defW = safeNumber(m.default_warning_value ?? 1);
    const pe = prodExtra || {};
    const imgs = parseImageUrls(m.image);
    const pimgs = parseImageUrls(pe.image_urls);
    const mergedImgs = imgs.length ? imgs : pimgs;
    return normalizeInventoryProduct({
      id: m.id,
      sku: m.model,
      name: m.name,
      category: m.category,
      unit: m.unit,
      default_warning_value: defW,
      warning_value: wOverride,
      warning_level: wOverride != null ? wOverride : defW,
      current_stock: qty,
      ref_price: pe.ref_price,
      sale_price: pe.sale_price,
      cost_price: pe.cost_price,
      warehouse_location: pe.warehouse_location,
      product_remark: m.remark,
      warning_remark: pe.warning_remark,
      image_urls: mergedImgs.length ? mergedImgs : pe.image_urls
    });
  }

  async function getInventoryProductsFromProductsTable(uid) {
    let q = supabase.from("products").select("*").order("sku", { ascending: true });
    if (ownerScope.products) q = q.eq("owner_id", uid);
    let { data, error } = await q;
    if (error && parseMissingColumnFromError(error) === "owner_id") {
      ownerScope.products = false;
      ({ data, error } = await supabase.from("products").select("*").order("sku", { ascending: true }));
    }
    return { data: (data || []).map(normalizeInventoryProduct), error };
  }

  /**
   * 优先 product_master + inventory_position；无表或无数据时回退 products
   */
  async function getInventoryProducts() {
    if (!supabase) return { data: [], error: { message: "Supabase SDK not loaded." } };
    let uid;
    try {
      uid = await requireAuthUserId();
    } catch (e) {
      return { data: [], error: e };
    }
    let mq = supabase
      .from("product_master")
      .select("id, name, model, category, unit, default_warning_value, image, remark, inventory_position ( quantity, warning_value )")
      .order("model", { ascending: true });
    mq = mq.eq("owner_id", uid);
    const { data: masters, error: me } = await mq;
    const missingRel =
      me &&
      (String(me.message || "").indexOf("product_master") >= 0 ||
        String(me.code || "") === "42P01" ||
        String(me.message || "").toLowerCase().indexOf("does not exist") >= 0);
    if (missingRel || (me && parseMissingColumnFromError(me) === "owner_id")) {
      const fb = await getInventoryProductsFromProductsTable(uid);
      if (fb.error) return { data: [], error: fb.error };
      return { data: fb.data, error: null };
    }
    if (me) return { data: [], error: me };
    if (!masters || masters.length === 0) {
      const fb = await getInventoryProductsFromProductsTable(uid);
      if (!fb.error && fb.data && fb.data.length) return { data: fb.data, error: null };
      return { data: [], error: null };
    }
    const ids = masters.map(m => m.id);
    let pq = supabase.from("products").select("id, ref_price, sale_price, cost_price, warehouse_location, image_urls, warning_remark").in("id", ids);
    if (ownerScope.products) pq = pq.eq("owner_id", uid);
    let { data: prows, error: pe } = await pq;
    if (pe && parseMissingColumnFromError(pe) === "owner_id") {
      ownerScope.products = false;
      ({ data: prows } = await supabase.from("products").select("id, ref_price, sale_price, cost_price, warehouse_location, image_urls, warning_remark").in("id", ids));
    }
    const pmap = Object.fromEntries((prows || []).map(p => [p.id, p]));
    const rows = masters.map(m => normalizeMergedMasterRow(m, pmap[m.id]));
    return { data: rows, error: null };
  }

  /**
   * 新建产品主数据 + 库存位 + products（满足 stock_ledger 触发器对 products 的依赖）
   */
  /** 须与 Supabase Storage 中实际 bucket 名称一致；若不存在会报错，需在控制台新建同名 public bucket */
  const INVENTORY_IMAGE_BUCKET = "inventory-images";

  /**
   * 将 data URL 上传到 Storage，返回公网 URL。
   * 依赖 Storage 中已存在名为 inventory-images 的 bucket（公开读 + 对应上传策略）。
   */
  async function uploadInventoryImageFromDataUrl(dataUrl, suggestedName) {
    if (!supabase) throw new Error("Supabase SDK not loaded.");
    await requireAuthUserId();
    const raw = String(dataUrl || "").trim();
    if (!raw.startsWith("data:")) {
      if (/^https?:\/\//i.test(raw)) return raw;
      throw new Error("无效的图片数据。");
    }
    const m = raw.match(/^data:([^;]+);base64,(.+)$/);
    if (!m) throw new Error("无法解析图片 data URL。");
    const mime = m[1] || "image/png";
    let bin;
    try {
      bin = Uint8Array.from(atob(m[2]), c => c.charCodeAt(0));
    } catch (_) {
      throw new Error("图片 Base64 解码失败。");
    }
    const blob = new Blob([bin], { type: mime });
    const ext = (mime.split("/")[1] || "png").replace(/[^a-z0-9]/gi, "").slice(0, 8) || "png";
    /** Storage 对象键禁止 : * ? 等字符（与 S3 规则一致）；含冒号的文件名（如「概念:图.png」）会直接报 Invalid key */
    let base = String(suggestedName || "inbound").replace(/\.[^.]+$/, "");
    try {
      base = base.normalize("NFKC");
    } catch (_) {
      /* ignore */
    }
    base = base
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .replace(/[:\\*?|[\]{}#%"<>~`'+;=&^]/g, "_")
      .replace(/[\uff1a\uff1b\u2236\u02f8\u205c\u05c3\u1361\u16ec\u204f\u003a]/g, "_")
      .replace(/[^\w\u3400-\u9fff._-]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 40);
    if (!base) base = "inbound";
    const path = `${createUUID()}-${base}.${ext}`;
    const { error: upErr } = await supabase.storage.from(INVENTORY_IMAGE_BUCKET).upload(path, blob, {
      contentType: mime,
      upsert: false
    });
    if (upErr) {
      const um = String(upErr.message || "");
      if (/bucket not found/i.test(um) || (String(upErr.statusCode || "") === "404" && /bucket/i.test(um))) {
        const err = new Error("NO_STORAGE_BUCKET");
        err.noStorageBucket = true;
        err.bucketId = INVENTORY_IMAGE_BUCKET;
        err.details = upErr;
        throw err;
      }
      throw upErr;
    }
    const { data: pub } = supabase.storage.from(INVENTORY_IMAGE_BUCKET).getPublicUrl(path);
    const url = pub?.publicUrl || "";
    if (!url) throw new Error("Storage 未返回图片 URL。");
    return url;
  }

  async function createProductMaster(fields) {
    if (!supabase) throw new Error("Supabase SDK not loaded.");
    const uid = await requireAuthUserId();
    const id = createUUID();
    const name = String(fields.name || "").trim() || "未命名";
    /** 型号为空时不能与同租户下另一条空 sku 共存（products_owner_sku_unique），用行 id 占位保证唯一 */
    let model = String(fields.model ?? fields.sku ?? "").trim();
    if (!model) model = id;
    const category = String(fields.category || "成品").trim() || "成品";
    const unit = String(fields.unit || "件").trim() || "件";
    const dwRaw = fields.default_warning_value ?? fields.warning_level;
    const default_warning_value =
      dwRaw === "" || dwRaw === undefined || dwRaw === null
        ? 1
        : Math.max(0, Math.floor(safeNumber(dwRaw)));
    const remark = String(fields.remark || "").trim();
    const image_urls = parseImageUrls(fields.image_urls);
    const refP = safeNumber(fields.ref_price ?? fields.unit_price);
    const prodRow = {
      id,
      name,
      sku: model,
      category,
      unit,
      warning_level: default_warning_value,
      current_stock: 0,
      ref_price: refP > 0 ? refP : 0,
      sale_price: refP > 0 ? refP : 0,
      cost_price: refP > 0 ? refP : 0,
      product_remark: remark,
      image_urls,
      owner_id: uid
    };
    const { error: e0 } = await supabase.from("products").insert(prodRow);
    if (e0) throw e0;
    const masterRow = {
      id,
      name,
      model,
      category,
      unit,
      default_warning_value,
      image: image_urls.length ? image_urls : [],
      remark,
      owner_id: uid
    };
    const { error: e1 } = await supabase.from("product_master").insert(masterRow);
    if (e1) {
      const missingMaster =
        String(e1.message || "").toLowerCase().indexOf("product_master") >= 0 ||
        String(e1.code || "") === "42P01" ||
        String(e1.message || "").toLowerCase().indexOf("does not exist") >= 0;
      if (missingMaster) {
        return { id, masterSkipped: true };
      }
      await supabase.from("products").delete().eq("id", id);
      throw e1;
    }
    const { error: e2 } = await supabase.from("inventory_position").insert({
      product_id: id,
      quantity: 0,
      warning_value: null,
      owner_id: uid
    });
    if (e2) {
      await supabase.from("product_master").delete().eq("id", id);
      await supabase.from("products").delete().eq("id", id);
      throw e2;
    }
    return { id };
  }

  /**
   * 写入入库流水；由触发器 apply_stock_delta 更新 products.current_stock
   * productId 须为 UUID（云端产品）；本地临时 id 无法写入
   */
  async function createStockTransaction(payload) {
    if (!supabase) throw new Error("Supabase SDK not loaded.");
    await requireAuthUserId();
    const p = payload || {};
    const productId = String(p.productId || "").trim();
    if (!isUUID(productId)) {
      throw new Error("入库失败：产品 ID 需为 Supabase 中的 UUID。请先将产品同步到云端或使用云端返回的产品。");
    }
    const qty = Math.floor(safeNumber(p.quantity));
    if (qty <= 0) throw new Error("数量须大于 0");
    let uploadedUrl = String(p.image_url || "").trim();
    let imageMeta = null;
    if (p.image) {
      imageMeta = {
        name: String(p.image.name || ""),
        type: String(p.image.type || ""),
        size: safeNumber(p.image.size)
      };
      if (p.image.dataUrl) imageMeta.has_data_url = true;
    }
    if (uploadedUrl) imageMeta = { ...(imageMeta || {}), public_url: uploadedUrl };
    const opLabel = String(p.operator_name || p.operator || (await getAuthOperatorLabel())).trim();
    const src = String(p.source || "手动").trim() || "手动";
    const opType = String(p.operation_type || "入库").trim() || "入库";
    const inboundSub = String(p.inbound_subtype || p.inboundSource || p.source_type || "").trim();
    const dir = String(p.direction || "IN").toUpperCase() === "OUT" ? "OUT" : "IN";
    const row = {
      product_id: productId,
      type: "入库",
      quantity_delta: qty,
      remark: String(p.remark || "").trim(),
      biz_type: String(p.bizType || "").trim(),
      inbound_subtype: inboundSub,
      direction: dir,
      source_type: String(p.source_type || "").trim() || null,
      target_type: String(p.target_type || "").trim() || null,
      biz_order_no: String(p.biz_order_no || "").trim() || null,
      purpose: String(p.purpose || "").trim() || null,
      image_meta: imageMeta,
      before_quantity: p.before_quantity != null ? Math.floor(safeNumber(p.before_quantity)) : null,
      after_quantity: p.after_quantity != null ? Math.floor(safeNumber(p.after_quantity)) : null,
      operator: opLabel || null,
      operator_name: String(p.operator_name || "").trim() || null,
      source: src,
      operation_type: opType,
      outbound_subtype: p.outbound_subtype != null ? String(p.outbound_subtype).trim() || null : null,
      image_url: uploadedUrl || null
    };
    await insertStockLedgerRow(row);
    return { ok: true };
  }

  /** 入库上传图：写入 products.image_urls（新图插到数组首位，列表主图取第一张） */
  async function mergeInboundProductImage(productId, dataUrl) {
    if (!supabase) throw new Error("Supabase SDK not loaded.");
    const uid = await requireAuthUserId();
    const id = String(productId || "").trim();
    const url = String(dataUrl || "").trim();
    if (!isUUID(id) || !url) return { ok: true };
    let sel = supabase.from("products").select("image_urls").eq("id", id);
    if (ownerScope.products) sel = sel.eq("owner_id", uid);
    let { data, error } = await sel.maybeSingle();
    if (error && parseMissingColumnFromError(error) === "owner_id") {
      ownerScope.products = false;
      ({ data, error } = await supabase.from("products").select("image_urls").eq("id", id).maybeSingle());
    }
    if (error) throw error;
    const raw = data?.image_urls;
    const existing = parseImageUrls(raw);
    const next = [url, ...existing.filter(u => u !== url)];
    let upd = supabase.from("products").update({ image_urls: next }).eq("id", id);
    if (ownerScope.products) upd = upd.eq("owner_id", uid);
    let { error: uerr } = await upd;
    if (uerr && parseMissingColumnFromError(uerr) === "owner_id") {
      ownerScope.products = false;
      ({ error: uerr } = await supabase.from("products").update({ image_urls: next }).eq("id", id));
    }
    if (uerr) throw uerr;
    const imgArr = next;
    const { error: merr } = await supabase
      .from("product_master")
      .update({ image: imgArr, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (merr && String(merr.message || "").indexOf("product_master") < 0 && String(merr.code || "") !== "42P01") {
      console.warn("[库存] product_master 图片同步", merr);
    }
    return { ok: true };
  }

  /**
   * type: in | out | adjust（盘点）；quantity 为正整数；adjust 时 quantity 表示盘点「变化量」绝对值由 meta.sign 或 delta 传入
   * meta: { delta, before_quantity, after_quantity, source, operation_type, outbound_subtype, biz_type, inbound_subtype, operator }
   */
  async function adjustStock(productId, type, quantity, remark, meta) {
    if (!supabase) throw new Error("Supabase SDK not loaded.");
    await requireAuthUserId();
    const pid = String(productId || "").trim();
    if (!isUUID(pid)) {
      throw new Error("库存调整失败：产品 ID 需为 Supabase 中的 UUID。");
    }
    const m = meta || {};
    const qty = Math.floor(safeNumber(quantity));
    if (qty <= 0) throw new Error("请输入大于 0 的数量");
    const t = String(type || "in").toLowerCase();
    let delta;
    let ledgerType;
    let opType;
    if (t === "adjust") {
      delta = Math.floor(safeNumber(m.delta !== undefined ? m.delta : qty));
      if (delta === 0) throw new Error("盘点调整数量不能为 0");
      ledgerType = "盘点调整";
      opType = String(m.operation_type || "调整").trim() || "调整";
    } else {
      const dirIn = t === "in";
      delta = dirIn ? qty : -qty;
      ledgerType = dirIn ? "入库调整" : "出库调整";
      opType = String(m.operation_type || (dirIn ? "入库" : "出库")).trim() || (dirIn ? "入库" : "出库");
    }
    const opLabel = String(m.operator_name || m.operator || (await getAuthOperatorLabel())).trim();
    const src = String(m.source || "手动").trim() || "手动";
    const dirAdj =
      t === "adjust"
        ? "ADJ"
        : String(m.direction || (t === "in" ? "IN" : "OUT")).toUpperCase();
    const row = {
      product_id: pid,
      type: ledgerType,
      quantity_delta: delta,
      remark: String(remark || "").trim() || "—",
      biz_type: String(m.biz_type || "").trim(),
      inbound_subtype: String(m.inbound_subtype || m.source_type || "").trim(),
      before_quantity: m.before_quantity != null ? Math.floor(safeNumber(m.before_quantity)) : null,
      after_quantity: m.after_quantity != null ? Math.floor(safeNumber(m.after_quantity)) : null,
      operator: opLabel || null,
      operator_name: String(m.operator_name || "").trim() || null,
      source: src,
      operation_type: opType,
      outbound_subtype:
        m.outbound_subtype != null ? String(m.outbound_subtype).trim() || null : String(m.target_type || "").trim() || null,
      direction: dirAdj,
      source_type: String(m.source_type || "").trim() || null,
      target_type: String(m.target_type || "").trim() || null,
      biz_order_no: String(m.biz_order_no || "").trim() || null,
      purpose: String(m.purpose || "").trim() || null
    };
    await insertStockLedgerRow(row);
    return { ok: true };
  }

  /** 删除产品（级联删除 stock_ledger） */
  async function deleteInventoryProduct(productId) {
    if (!supabase) throw new Error("Supabase SDK not loaded.");
    const uid = await requireAuthUserId();
    const id = String(productId || "").trim();
    if (!isUUID(id)) throw new Error("删除失败：产品 ID 需为 Supabase 中的 UUID。");
    let q = supabase.from("products").delete().eq("id", id);
    if (ownerScope.products) q = q.eq("owner_id", uid);
    let { error } = await q;
    if (error && parseMissingColumnFromError(error) === "owner_id") {
      ownerScope.products = false;
      ({ error } = await supabase.from("products").delete().eq("id", id));
    }
    if (error) throw error;
    await supabase.from("product_master").delete().eq("id", id);
    return { ok: true };
  }

  /**
   * 按型号（sku）查询单条产品；无匹配时 data 为 null
   */
  async function getProductByCode(code) {
    const c = String(code || "").trim();
    if (!c) return { data: null, error: null };
    if (!supabase) return { data: null, error: { message: "Supabase SDK not loaded." } };
    let uid;
    try {
      uid = await requireAuthUserId();
    } catch (e) {
      return { data: null, error: e };
    }
    const { data: mrow, error: me } = await supabase
      .from("product_master")
      .select("id, name, model, category, unit, default_warning_value, image, remark, inventory_position ( quantity, warning_value )")
      .eq("model", c)
      .eq("owner_id", uid)
      .maybeSingle();
    if (!me && mrow) {
      let pq = supabase.from("products").select("id, ref_price, sale_price, cost_price, warehouse_location, image_urls, warning_remark").eq("id", mrow.id);
      if (ownerScope.products) pq = pq.eq("owner_id", uid);
      let { data: pe } = await pq.maybeSingle();
      if (!pe) {
        ({ data: pe } = await supabase.from("products").select("id, ref_price, sale_price, cost_price, warehouse_location, image_urls, warning_remark").eq("id", mrow.id).maybeSingle());
      }
      return { data: normalizeMergedMasterRow(mrow, pe || {}), error: null };
    }
    let pq = supabase.from("products").select("*").eq("sku", c);
    if (ownerScope.products) pq = pq.eq("owner_id", uid);
    let { data, error } = await pq.maybeSingle();
    if (error && parseMissingColumnFromError(error) === "owner_id") {
      ownerScope.products = false;
      ({ data, error } = await supabase.from("products").select("*").eq("sku", c).maybeSingle());
    }
    if (error) return { data: null, error };
    return { data: data ? normalizeInventoryProduct(data) : null, error: null };
  }

  async function updateProductWarning(productId, warnStock, warningRemark) {
    if (!supabase) throw new Error("Supabase SDK not loaded.");
    const uid = await requireAuthUserId();
    const id = String(productId || "").trim();
    if (!isUUID(id)) throw new Error("更新失败：产品 ID 需为 Supabase 中的 UUID。");
    const w = Math.floor(safeNumber(warnStock));
    const upd = { warning_level: w };
    if (warningRemark !== undefined) upd.warning_remark = String(warningRemark ?? "").trim();
    let uq = supabase.from("products").update(upd).eq("id", id);
    if (ownerScope.products) uq = uq.eq("owner_id", uid);
    let { error } = await uq;
    if (error && parseMissingColumnFromError(error) === "owner_id") {
      ownerScope.products = false;
      ({ error } = await supabase.from("products").update(upd).eq("id", id));
    }
    if (error) throw error;
    let posQ = supabase.from("inventory_position").select("quantity").eq("product_id", id).maybeSingle();
    if (ownerScope.products) posQ = posQ.eq("owner_id", uid);
    let { data: posRow } = await posQ;
    const posQty = posRow != null && posRow.quantity != null ? Math.floor(safeNumber(posRow.quantity)) : null;
    let pq0 = supabase.from("products").select("current_stock").eq("id", id).maybeSingle();
    if (ownerScope.products) pq0 = pq0.eq("owner_id", uid);
    const { data: pr } = await pq0;
    const qty = posQty != null ? posQty : Math.floor(safeNumber(pr?.current_stock ?? 0));
    const posUp = {
      product_id: id,
      quantity: Math.max(0, qty),
      warning_value: w,
      owner_id: uid,
      updated_at: new Date().toISOString()
    };
    const { error: pe } = await supabase.from("inventory_position").upsert(posUp, { onConflict: "product_id" });
    if (pe && String(pe.message || "").indexOf("inventory_position") < 0 && String(pe.code || "") !== "42P01") throw pe;
    await supabase.from("product_master").update({ default_warning_value: w, updated_at: new Date().toISOString() }).eq("id", id);
    return { ok: true };
  }

  async function updateInventoryProduct(payload) {
    if (!supabase) throw new Error("Supabase SDK not loaded.");
    const uid = await requireAuthUserId();
    const p = payload || {};
    const id = String(p.productId || "").trim();
    if (!isUUID(id)) throw new Error("保存失败：产品 ID 需为 Supabase 中的 UUID。");
    const price = safeNumber(p.ref_price);
    const sku = String(p.sku || "").trim();
    const name = String(p.name || "").trim();
    const category = String(p.category || "成品").trim();
    const unit = String(p.unit || "件").trim();
    const upd = {
      name,
      sku,
      category,
      unit,
      ref_price: price,
      sale_price: price,
      cost_price: price
    };
    if (p.product_remark !== undefined) upd.product_remark = String(p.product_remark || "").trim();
    let uq2 = supabase.from("products").update(upd).eq("id", id);
    if (ownerScope.products) uq2 = uq2.eq("owner_id", uid);
    let { error } = await uq2;
    if (error && parseMissingColumnFromError(error) === "owner_id") {
      ownerScope.products = false;
      ({ error } = await supabase.from("products").update(upd).eq("id", id));
    }
    if (error) throw error;
    const imgs = parseImageUrls(p.image_urls);
    const mupd = {
      name,
      model: sku,
      category,
      unit,
      updated_at: new Date().toISOString()
    };
    if (p.product_remark !== undefined) mupd.remark = String(p.product_remark || "").trim();
    if (imgs.length) mupd.image = imgs;
    const { error: me } = await supabase.from("product_master").update(mupd).eq("id", id);
    if (me && String(me.message || "").indexOf("product_master") < 0 && String(me.code || "") !== "42P01") throw me;
    return { ok: true };
  }

  window.ApiService = {
    supabase,
    safeNumber,
    formatSupabaseError,
    getAuthOperatorLabel,
    normalizeOrder,
    normalizeCustomer,
    deriveOrderStatus,
    getOrders,
    getCustomers,
    createOrUpdateCustomer,
    deleteCustomer,
    createOrder,
    createShipment,
    deleteOrder,
    checkConnection,
    subscribeCloudChanges,
    getSession,
    onAuthStateChange,
    login,
    register,
    resendSignupConfirmation,
    logout,
    normalizeInventoryProduct,
    parseImageUrls,
    getInventoryProductCloudId,
    getInventoryProducts,
    createProductMaster,
    createStockTransaction,
    mergeInboundProductImage,
    uploadInventoryImageFromDataUrl,
    adjustStock,
    deleteInventoryProduct,
    getProductByCode,
    updateProductWarning,
    updateInventoryProduct
  };
})();
