/**
 * ERP 侧栏菜单（path / key / lucide 图标名，供 Lucide UMD 渲染）
 * Hash：#/dashboard、#/customer …
 */
(function (global) {
  var MENU = [
    { title: "看板", key: "dashboard", path: "/dashboard", lucide: "layout-dashboard" },
    {
      title: "客户/供应商管理",
      key: "crm",
      lucide: "handshake",
      children: [
        { title: "客户管理", path: "/customer", lucide: "user-circle" },
        { title: "供应商管理", path: "/customer/suppliers", lucide: "truck" }
      ]
    },
    { title: "产品中心", key: "product", path: "/product", lucide: "package" },
    { title: "订单系统", key: "order", path: "/order", lucide: "file-text" },
    { title: "库存系统", key: "inventory", path: "/inventory/ledger", lucide: "warehouse" },
    {
      title: "采购管理",
      key: "purchase",
      lucide: "shopping-cart",
      children: [
        { title: "采购订单", path: "/purchase/orders", lucide: "clipboard-list" },
        { title: "收货管理", path: "/purchase/receiving", lucide: "package-open" },
        { title: "应付账款", path: "/purchase/payable", lucide: "wallet" }
      ]
    },
    { title: "对账中心", key: "finance", path: "/finance", lucide: "credit-card" },
    { title: "数据分析", key: "analytics", path: "/analytics", lucide: "bar-chart-2" },
    { title: "系统管理", key: "settings", path: "/settings", lucide: "settings" }
  ];

  function normPath(p) {
    var s = String(p || "").split("?")[0].replace(/\/+$/, "") || "/dashboard";
    if (!s.startsWith("/")) s = "/" + s;
    return s;
  }

  function walk(items, fn) {
    (items || []).forEach(function (item) {
      fn(item);
      if (item.children) walk(item.children, fn);
    });
  }

  function findTitle(path) {
    var p = normPath(path);
    if (p.indexOf("/product/detail/") === 0) return "产品详情";
    if (p === "/product" || p === "/product/list") return "产品中心";
    if (p === "/purchase") return "采购管理";
    var title = null;
    walk(MENU, function (item) {
      if (item.path === p) title = item.title;
    });
    return title || "ERP 系统";
  }

  function findContext(path) {
    var p = normPath(path);
    if (p.indexOf("/product/detail/") === 0) return { module: "产品中心", page: "产品详情", key: "product" };
    if (p === "/product" || p === "/product/list") return { module: "产品中心", page: "产品列表", key: "product" };
    if (p === "/customer/suppliers") return { module: "客户/供应商管理", page: "供应商管理", key: "supplier" };
    if (p === "/customer") return { module: "客户/供应商管理", page: "客户管理", key: "customer" };
    for (var i = 0; i < MENU.length; i++) {
      var m = MENU[i];
      if (m.path === p) return { module: m.title, page: m.title, key: m.key };
      if (m.children) {
        for (var j = 0; j < m.children.length; j++) {
          var c = m.children[j];
          if (c.path === p) return { module: m.title, page: c.title, key: c.key };
        }
      }
    }
    return { module: "ERP", page: findTitle(p), key: "" };
  }

  global.ERP_MENU = MENU;
  global.erpMenuNormPath = normPath;
  global.erpMenuFindTitle = findTitle;
  global.erpMenuFindContext = findContext;
})(window);
