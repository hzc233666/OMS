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
    return "";
  }
  function formatSupabaseError(error) {
    if (!error) return "unknown";
    return [
      `message: ${error.message || "unknown"}`,
      `code: ${error.code || "n/a"}`,
      `details: ${error.details || "n/a"}`,
      `hint: ${error.hint || "n/a"}`
    ].join("\n");
  }

  function normalizeCustomer(c) {
    return {
      id: String(c.id || uid()),
      name: String(c.name || "").trim(),
      contact: String(c.contact || c.contact_phone || c.contact_name || "").trim(),
      address: String(c.address || "").trim(),
      cloud_id: isUUID(c.cloud_id) ? String(c.cloud_id) : (isUUID(c.id) ? String(c.id) : createUUID()),
      created_at: String(c.created_at || new Date().toISOString())
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
    const columns = ["id", "name", "contact", "contact_phone", "contact_name", "address", "created_at", "updated_at"];
    const required = ["id", "name"];
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
      name: row.name,
      contact: row.contact || row.contact_phone || row.contact_name,
      address: row.address,
      created_at: row.created_at
    })) : [];
  }

  async function createOrUpdateCustomer(customer) {
    if (!supabase || !customer) return null;
    const c = normalizeCustomer(customer);
    let payload = {
      id: isUUID(c.cloud_id) ? c.cloud_id : createUUID(),
      name: c.name,
      contact: c.contact,
      contact_phone: c.contact,
      contact_name: c.contact,
      address: c.address,
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
  async function login(email, password) {
    if (!supabase) return { error: { message: "Supabase SDK not loaded." } };
    return supabase.auth.signInWithPassword({ email, password });
  }
  async function register(email, password) {
    if (!supabase) return { error: { message: "Supabase SDK not loaded." } };
    return supabase.auth.signUp({ email, password });
  }
  async function logout() {
    if (!supabase) return { error: { message: "Supabase SDK not loaded." } };
    return supabase.auth.signOut();
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
    logout
  };
})();
