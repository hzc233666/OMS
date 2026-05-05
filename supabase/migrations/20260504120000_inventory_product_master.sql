-- =============================================================================
-- 产品主数据 + 库存位（与现有 products / stock_ledger 兼容）
-- product_master.id 与 products.id 一致；stock_ledger 仍引用 products.id
-- =============================================================================

-- 1. 产品信息库
CREATE TABLE IF NOT EXISTS public.product_master (
  id uuid PRIMARY KEY,
  name text NOT NULL DEFAULT '',
  model text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT '成品',
  unit text NOT NULL DEFAULT '件',
  default_warning_value integer NOT NULL DEFAULT 1,
  image jsonb NOT NULL DEFAULT '[]'::jsonb,
  remark text NOT NULL DEFAULT '',
  owner_id uuid REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_master_owner_id ON public.product_master (owner_id);
CREATE INDEX IF NOT EXISTS idx_product_master_model ON public.product_master (owner_id, model);

-- 2. 库存位（数量 + 可覆盖预警）
CREATE TABLE IF NOT EXISTS public.inventory_position (
  product_id uuid PRIMARY KEY REFERENCES public.product_master (id) ON DELETE CASCADE,
  quantity integer NOT NULL DEFAULT 0,
  warning_value integer,
  owner_id uuid REFERENCES auth.users (id) ON DELETE CASCADE,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_position_owner_id ON public.inventory_position (owner_id);

-- 3. 流水扩展字段（旧数据兼容，可为 NULL）
ALTER TABLE public.stock_ledger ADD COLUMN IF NOT EXISTS before_quantity integer;
ALTER TABLE public.stock_ledger ADD COLUMN IF NOT EXISTS after_quantity integer;
ALTER TABLE public.stock_ledger ADD COLUMN IF NOT EXISTS operator text;
ALTER TABLE public.stock_ledger ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE public.stock_ledger ADD COLUMN IF NOT EXISTS operation_type text;
ALTER TABLE public.stock_ledger ADD COLUMN IF NOT EXISTS outbound_subtype text;

-- 4. 从现有 products 回填（仅当主数据尚无对应 id）
INSERT INTO public.product_master (
  id, name, model, category, unit, default_warning_value, image, remark, owner_id, created_at, updated_at
)
SELECT
  p.id,
  COALESCE(NULLIF(btrim(p.name::text), ''), '未命名'),
  COALESCE(NULLIF(btrim(p.sku::text), ''), ''),
  COALESCE(NULLIF(btrim(p.category::text), ''), '成品'),
  COALESCE(NULLIF(btrim(p.unit::text), ''), '件'),
  GREATEST(0, COALESCE(p.warning_level, 1))::integer,
  '[]'::jsonb,
  COALESCE(btrim(p.product_remark::text), ''),
  p.owner_id,
  now(),
  now()
FROM public.products p
WHERE NOT EXISTS (SELECT 1 FROM public.product_master m WHERE m.id = p.id);

INSERT INTO public.inventory_position (product_id, quantity, warning_value, owner_id, updated_at)
SELECT
  p.id,
  GREATEST(0, floor(COALESCE(p.current_stock, 0))::integer),
  NULL,
  p.owner_id,
  now()
FROM public.products p
WHERE NOT EXISTS (SELECT 1 FROM public.inventory_position ip WHERE ip.product_id = p.id);

-- 5. 记账后同步 inventory_position 与 products.current_stock（触发器名 zzz_ 保证尽量靠后执行）
CREATE OR REPLACE FUNCTION public.inventory_position_sync_after_ledger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_qty integer;
  v_owner uuid;
BEGIN
  SELECT GREATEST(0, floor(COALESCE(current_stock, 0))::integer), owner_id
  INTO v_qty, v_owner
  FROM public.products
  WHERE id = NEW.product_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.inventory_position (product_id, quantity, warning_value, owner_id, updated_at)
  VALUES (NEW.product_id, v_qty, NULL, v_owner, now())
  ON CONFLICT (product_id) DO UPDATE SET
    quantity = EXCLUDED.quantity,
    owner_id = COALESCE(EXCLUDED.owner_id, public.inventory_position.owner_id),
    updated_at = now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inventory_position_sync_after_ledger ON public.stock_ledger;
DROP TRIGGER IF EXISTS zzz_inventory_position_sync_after_ledger ON public.stock_ledger;
CREATE TRIGGER zzz_inventory_position_sync_after_ledger
  AFTER INSERT ON public.stock_ledger
  FOR EACH ROW
  EXECUTE FUNCTION public.inventory_position_sync_after_ledger();

-- 6. RLS
ALTER TABLE public.product_master ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_position ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT pol.polname, c.relname
    FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = ANY (ARRAY['product_master','inventory_position']::name[])
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.polname, r.relname);
  END LOOP;
END $$;

CREATE POLICY product_master_select_own ON public.product_master
  FOR SELECT TO authenticated USING (owner_id = (SELECT auth.uid()));
CREATE POLICY product_master_insert_own ON public.product_master
  FOR INSERT TO authenticated WITH CHECK (owner_id = (SELECT auth.uid()));
CREATE POLICY product_master_update_own ON public.product_master
  FOR UPDATE TO authenticated USING (owner_id = (SELECT auth.uid())) WITH CHECK (owner_id = (SELECT auth.uid()));
CREATE POLICY product_master_delete_own ON public.product_master
  FOR DELETE TO authenticated USING (owner_id = (SELECT auth.uid()));

CREATE POLICY inventory_position_select_own ON public.inventory_position
  FOR SELECT TO authenticated USING (owner_id = (SELECT auth.uid()));
CREATE POLICY inventory_position_insert_own ON public.inventory_position
  FOR INSERT TO authenticated WITH CHECK (owner_id = (SELECT auth.uid()));
CREATE POLICY inventory_position_update_own ON public.inventory_position
  FOR UPDATE TO authenticated USING (owner_id = (SELECT auth.uid())) WITH CHECK (owner_id = (SELECT auth.uid()));
CREATE POLICY inventory_position_delete_own ON public.inventory_position
  FOR DELETE TO authenticated USING (owner_id = (SELECT auth.uid()));

REVOKE ALL ON public.product_master FROM anon;
REVOKE ALL ON public.inventory_position FROM anon;
