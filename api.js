(() => {
  const SUPABASE_URL = "https://gyatmvavtkhfuaqruxsr.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd5YXRtdmF2dGtoZnVhcXJ1eHNyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY5NDQ0MDIsImV4cCI6MjA5MjUyMDQwMn0.ygWL2dkThGYtWXFwLp8FzmaqBRC9RWBJi4nLf9cEDTw";
  const supabase = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

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
    const columns = ["order_no", "customer_id", "product", "quantity", "status", "created_at", "updated_at", "order_payload"];
    const required = ["order_no", "customer_id", "created_at"];
    let data = null;
    let error = null;
    for (let i = 0; i < 8; i += 1) {
      ({ data, error } = await supabase.from("orders").select(columns.join(", ")).order("created_at", { ascending: true }));
      if (!error) break;
      const missing = parseMissingColumnFromError(error);
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
    const columns = ["id", "name", "customer_name", "contact", "contact_phone", "contact_name", "contact_person", "phone", "email", "address", "tax_id", "remark", "created_at", "updated_at"];
    const required = ["id"];
    let data = null;
    let error = null;
    for (let i = 0; i < 8; i += 1) {
      ({ data, error } = await supabase.from("customers").select(columns.join(", ")).order("created_at", { ascending: true }));
      if (!error) break;
      const missing = parseMissingColumnFromError(error);
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
      updated_at: new Date().toISOString()
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
    const { error } = await supabase.from("customers").delete().eq("id", customerCloudId);
    if (error) throw error;
  }

  async function createOrder(order, customers = []) {
    if (!supabase || !order) return;
    let payload = toCloudOrder(order, customers);
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
    const { error } = await supabase.from("orders").delete().eq("order_no", orderNo);
    if (error) throw error;
  }

  async function checkConnection() {
    if (!supabase) throw new Error("Supabase SDK not loaded.");
    const { error } = await supabase.from("orders").select("order_no").limit(1);
    if (error) throw error;
  }

  function subscribeCloudChanges(onChange) {
    if (!supabase) return { unsubscribe() {} };
    const channel = supabase.channel("orders-customers-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, onChange)
      .on("postgres_changes", { event: "*", schema: "public", table: "customers" }, onChange)
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
  /** 邮件确认链接回跳地址（须完整加入 Supabase → Redirect URLs） */
  function authEmailRedirectTo() {
    if (typeof window === "undefined" || !window.location) return undefined;
    const { origin, pathname } = window.location;
    return `${origin}${pathname}?auth_notice=verified`;
  }

  async function login(email, password) {
    if (!supabase) return { error: { message: "Supabase SDK not loaded." } };
    return supabase.auth.signInWithPassword({ email, password });
  }
  async function register(email, password) {
    if (!supabase) return { error: { message: "Supabase SDK not loaded." } };
    const redirectTo = authEmailRedirectTo();
    return supabase.auth.signUp({
      email,
      password,
      options: redirectTo ? { emailRedirectTo: redirectTo } : {}
    });
  }

  async function resendSignupConfirmation(email) {
    if (!supabase) return { error: { message: "Supabase SDK not loaded." } };
    const redirectTo = authEmailRedirectTo();
    return supabase.auth.resend({
      type: "signup",
      email: String(email || "").trim(),
      options: redirectTo ? { emailRedirectTo: redirectTo } : {}
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
    const imgs = Array.isArray(r.image_urls) ? r.image_urls : r.image_urls ? [r.image_urls] : [];
    const firstImg = imgs[0] || r.image_url || r.thumb_url || "";
    const ref =
      safeNumber(r.ref_price) ||
      safeNumber(r.sale_price ?? r.price) ||
      safeNumber(r.cost_price);
    return {
      id: cloudId || rawId || uid(),
      cloud_id: cloudId,
      sku: String(r.sku || r.product_code || "").trim(),
      name: String(r.name || r.product_name || "").trim(),
      category: String(r.category || "成品").trim(),
      unit: String(r.unit || "件").trim(),
      warning_level: safeNumber(r.warning_level ?? r.reorder_point),
      current_stock: safeNumber(r.current_stock ?? r.stock ?? r.qty),
      ref_price: ref,
      sale_price: safeNumber(r.sale_price ?? r.price),
      cost_price: safeNumber(r.cost_price),
      warehouse_location: String(r.warehouse_location || r.location || "").trim(),
      product_remark: String(r.product_remark || r.remark || "").trim(),
      image_urls: firstImg ? [String(firstImg)] : []
    };
  }

  /**
   * 从 Supabase products 表加载产品；失败时返回 data:[] 与 error（调用方可回退本地模拟数据）
   */
  async function getInventoryProducts() {
    if (!supabase) return { data: [], error: { message: "Supabase SDK not loaded." } };
    const { data, error } = await supabase.from("products").select("*").order("sku", { ascending: true });
    if (error) return { data: [], error };
    return { data: (data || []).map(normalizeInventoryProduct), error: null };
  }

  /**
   * 写入入库流水；由触发器 apply_stock_delta 更新 products.current_stock
   * productId 须为 UUID（云端产品）；本地临时 id 无法写入
   */
  async function createStockTransaction(payload) {
    if (!supabase) throw new Error("Supabase SDK not loaded.");
    const p = payload || {};
    const productId = String(p.productId || "").trim();
    if (!isUUID(productId)) {
      throw new Error("入库失败：产品 ID 需为 Supabase 中的 UUID。请先将产品同步到云端或使用云端返回的产品。");
    }
    const qty = Math.floor(safeNumber(p.quantity));
    if (qty <= 0) throw new Error("数量须大于 0");
    let imageMeta = null;
    if (p.image) {
      imageMeta = {
        name: String(p.image.name || ""),
        type: String(p.image.type || ""),
        size: safeNumber(p.image.size)
      };
      if (p.image.dataUrl) imageMeta.has_data_url = true;
    }
    const row = {
      product_id: productId,
      type: "入库",
      quantity_delta: qty,
      remark: String(p.remark || "").trim(),
      biz_type: String(p.bizType || "").trim(),
      inbound_subtype: "",
      image_meta: imageMeta
    };
    const { error } = await supabase.from("stock_ledger").insert(row);
    if (error) throw error;
    return { ok: true };
  }

  /** 写入入库调整/出库调整流水；触发器同步库存 */
  async function adjustStock(productId, type, quantity, remark) {
    if (!supabase) throw new Error("Supabase SDK not loaded.");
    const pid = String(productId || "").trim();
    if (!isUUID(pid)) {
      throw new Error("库存调整失败：产品 ID 需为 Supabase 中的 UUID。");
    }
    const qty = Math.floor(safeNumber(quantity));
    if (qty <= 0) throw new Error("请输入大于 0 的数量");
    const dirIn = type === "in";
    const delta = dirIn ? qty : -qty;
    const row = {
      product_id: pid,
      type: dirIn ? "入库调整" : "出库调整",
      quantity_delta: delta,
      remark: String(remark || "").trim() || "—",
      biz_type: "",
      inbound_subtype: ""
    };
    const { error } = await supabase.from("stock_ledger").insert(row);
    if (error) throw error;
    return { ok: true };
  }

  /** 删除产品（级联删除 stock_ledger） */
  async function deleteInventoryProduct(productId) {
    if (!supabase) throw new Error("Supabase SDK not loaded.");
    const id = String(productId || "").trim();
    if (!isUUID(id)) throw new Error("删除失败：产品 ID 需为 Supabase 中的 UUID。");
    const { error } = await supabase.from("products").delete().eq("id", id);
    if (error) throw error;
    return { ok: true };
  }

  /**
   * 按型号（sku）查询单条产品；无匹配时 data 为 null
   */
  async function getProductByCode(code) {
    const c = String(code || "").trim();
    if (!c) return { data: null, error: null };
    if (!supabase) return { data: null, error: { message: "Supabase SDK not loaded." } };
    const { data, error } = await supabase.from("products").select("*").eq("sku", c).maybeSingle();
    if (error) return { data: null, error };
    return { data: data ? normalizeInventoryProduct(data) : null, error: null };
  }

  async function updateProductWarning(productId, warnStock) {
    if (!supabase) throw new Error("Supabase SDK not loaded.");
    const id = String(productId || "").trim();
    if (!isUUID(id)) throw new Error("更新失败：产品 ID 需为 Supabase 中的 UUID。");
    const w = Math.floor(safeNumber(warnStock));
    const { error } = await supabase.from("products").update({ warning_level: w }).eq("id", id);
    if (error) throw error;
    return { ok: true };
  }

  async function updateInventoryProduct(payload) {
    if (!supabase) throw new Error("Supabase SDK not loaded.");
    const p = payload || {};
    const id = String(p.productId || "").trim();
    if (!isUUID(id)) throw new Error("保存失败：产品 ID 需为 Supabase 中的 UUID。");
    const price = safeNumber(p.ref_price);
    const upd = {
      name: String(p.name || "").trim(),
      sku: String(p.sku || "").trim(),
      category: String(p.category || "成品").trim(),
      unit: String(p.unit || "件").trim(),
      ref_price: price,
      sale_price: price,
      cost_price: price
    };
    if (p.product_remark !== undefined) upd.product_remark = String(p.product_remark || "").trim();
    const { error } = await supabase.from("products").update(upd).eq("id", id);
    if (error) throw error;
    return { ok: true };
  }

  window.ApiService = {
    supabase,
    safeNumber,
    formatSupabaseError,
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
    getInventoryProductCloudId,
    getInventoryProducts,
    createStockTransaction,
    adjustStock,
    deleteInventoryProduct,
    getProductByCode,
    updateProductWarning,
    updateInventoryProduct
  };
})();
