-- =============================================================================
-- 多租户数据隔离：owner_id + RLS（仅 authenticated，拒绝 anon 直读业务表）
-- 应用前请备份。已有数据若 owner_id 为 NULL，在 SELECT 策略下对任何 JWT 均不可见。
-- 可在 SQL Editor 中按需删除孤儿数据或手工 UPDATE 指定 owner_id 后再继续。
-- =============================================================================

-- 1. 列与索引
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES auth.users (id) ON DELETE CASCADE;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES auth.users (id) ON DELETE CASCADE;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES auth.users (id) ON DELETE CASCADE;
ALTER TABLE public.stock_ledger ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES auth.users (id) ON DELETE CASCADE;

ALTER TABLE public.customers ALTER COLUMN owner_id SET DEFAULT auth.uid();
ALTER TABLE public.orders ALTER COLUMN owner_id SET DEFAULT auth.uid();
ALTER TABLE public.products ALTER COLUMN owner_id SET DEFAULT auth.uid();

CREATE INDEX IF NOT EXISTS idx_customers_owner_id ON public.customers (owner_id);
CREATE INDEX IF NOT EXISTS idx_orders_owner_id ON public.orders (owner_id);
CREATE INDEX IF NOT EXISTS idx_products_owner_id ON public.products (owner_id);
CREATE INDEX IF NOT EXISTS idx_stock_ledger_owner_id ON public.stock_ledger (owner_id);

-- 2. 流水 owner_id 与产品归属一致（禁止对非本人产品记账）
CREATE OR REPLACE FUNCTION public.stock_ledger_set_owner_from_product()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
BEGIN
  IF NEW.product_id IS NULL THEN
    RAISE EXCEPTION 'stock_ledger: product_id 不能为空';
  END IF;
  SELECT p.owner_id INTO v_owner
  FROM public.products p
  WHERE p.id = NEW.product_id;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'stock_ledger: 产品不存在或不可访问';
  END IF;
  IF v_owner <> (SELECT auth.uid()) THEN
    RAISE EXCEPTION 'stock_ledger: 无权对该产品记账';
  END IF;
  NEW.owner_id := v_owner;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stock_ledger_set_owner ON public.stock_ledger;
CREATE TRIGGER trg_stock_ledger_set_owner
  BEFORE INSERT OR UPDATE OF product_id ON public.stock_ledger
  FOR EACH ROW
  EXECUTE FUNCTION public.stock_ledger_set_owner_from_product();

-- 3. 删除 public 下上述表的旧策略（避免遗留 using (true) 等）
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT pol.polname AS polname, c.relname AS relname
    FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = ANY (ARRAY['customers','orders','products','stock_ledger']::name[])
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.polname, r.relname);
  END LOOP;
END $$;

-- 4. 启用 RLS
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_ledger ENABLE ROW LEVEL SECURITY;

-- 5. 策略：仅本人数据（SELECT / INSERT / UPDATE / DELETE 分离）
-- customers
CREATE POLICY customers_select_own ON public.customers
  FOR SELECT TO authenticated USING (owner_id = (SELECT auth.uid()));
CREATE POLICY customers_insert_own ON public.customers
  FOR INSERT TO authenticated WITH CHECK (owner_id = (SELECT auth.uid()));
CREATE POLICY customers_update_own ON public.customers
  FOR UPDATE TO authenticated USING (owner_id = (SELECT auth.uid())) WITH CHECK (owner_id = (SELECT auth.uid()));
CREATE POLICY customers_delete_own ON public.customers
  FOR DELETE TO authenticated USING (owner_id = (SELECT auth.uid()));

-- orders
CREATE POLICY orders_select_own ON public.orders
  FOR SELECT TO authenticated USING (owner_id = (SELECT auth.uid()));
CREATE POLICY orders_insert_own ON public.orders
  FOR INSERT TO authenticated WITH CHECK (owner_id = (SELECT auth.uid()));
CREATE POLICY orders_update_own ON public.orders
  FOR UPDATE TO authenticated USING (owner_id = (SELECT auth.uid())) WITH CHECK (owner_id = (SELECT auth.uid()));
CREATE POLICY orders_delete_own ON public.orders
  FOR DELETE TO authenticated USING (owner_id = (SELECT auth.uid()));

-- products
CREATE POLICY products_select_own ON public.products
  FOR SELECT TO authenticated USING (owner_id = (SELECT auth.uid()));
CREATE POLICY products_insert_own ON public.products
  FOR INSERT TO authenticated WITH CHECK (owner_id = (SELECT auth.uid()));
CREATE POLICY products_update_own ON public.products
  FOR UPDATE TO authenticated USING (owner_id = (SELECT auth.uid())) WITH CHECK (owner_id = (SELECT auth.uid()));
CREATE POLICY products_delete_own ON public.products
  FOR DELETE TO authenticated USING (owner_id = (SELECT auth.uid()));

-- stock_ledger（owner_id 由触发器写入，须与 auth.uid() 一致）
CREATE POLICY stock_ledger_select_own ON public.stock_ledger
  FOR SELECT TO authenticated USING (owner_id = (SELECT auth.uid()));
CREATE POLICY stock_ledger_insert_own ON public.stock_ledger
  FOR INSERT TO authenticated WITH CHECK (owner_id = (SELECT auth.uid()));
CREATE POLICY stock_ledger_update_own ON public.stock_ledger
  FOR UPDATE TO authenticated USING (owner_id = (SELECT auth.uid())) WITH CHECK (owner_id = (SELECT auth.uid()));
CREATE POLICY stock_ledger_delete_own ON public.stock_ledger
  FOR DELETE TO authenticated USING (owner_id = (SELECT auth.uid()));

-- 6. anon 角色：显式撤销业务表权限（若项目曾授予过）
REVOKE ALL ON public.customers FROM anon;
REVOKE ALL ON public.orders FROM anon;
REVOKE ALL ON public.products FROM anon;
REVOKE ALL ON public.stock_ledger FROM anon;
