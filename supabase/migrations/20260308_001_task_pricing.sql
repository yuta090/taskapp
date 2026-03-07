-- Task Pricing: 原価・売値・マージン管理テーブル
-- agency_mode=true のスペースでのみ使用

CREATE TABLE task_pricing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  space_id uuid NOT NULL REFERENCES spaces(id),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,

  -- 原価（制作会社の見積もり）
  cost_hours numeric(8,2) DEFAULT NULL,
  cost_unit_price numeric(12,2) DEFAULT NULL,
  cost_total numeric(14,2) GENERATED ALWAYS AS (cost_hours * cost_unit_price) STORED,

  -- 売値モード
  sell_mode text NOT NULL DEFAULT 'margin'
    CHECK (sell_mode IN ('margin', 'fixed')),

  -- マージン率（%）
  margin_rate numeric(5,2) DEFAULT NULL
    CHECK (margin_rate IS NULL OR (margin_rate >= 0 AND margin_rate <= 999.99)),

  -- 売値合計（円）
  -- margin モード: アプリ側で cost_total * (1 + margin_rate/100) を計算して格納
  -- fixed モード: 手動入力
  sell_total numeric(14,2) DEFAULT NULL,

  -- 承認状態
  vendor_submitted_at timestamptz DEFAULT NULL,
  agency_approved_at timestamptz DEFAULT NULL,
  client_approved_at timestamptz DEFAULT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE(task_id)
);

-- インデックス
CREATE INDEX idx_task_pricing_space ON task_pricing(space_id);
CREATE INDEX idx_task_pricing_org ON task_pricing(org_id);

COMMENT ON TABLE task_pricing IS '代理店モード用タスク価格管理（原価・マージン・売値）';
COMMENT ON COLUMN task_pricing.cost_hours IS '工数（時間）— ベンダーが入力';
COMMENT ON COLUMN task_pricing.cost_unit_price IS '原価単価（円/時間）— ベンダーが入力';
COMMENT ON COLUMN task_pricing.cost_total IS '原価合計（自動計算: cost_hours * cost_unit_price）';
COMMENT ON COLUMN task_pricing.sell_mode IS '売値計算モード: margin=マージン率から自動計算, fixed=直接入力';
COMMENT ON COLUMN task_pricing.margin_rate IS 'マージン率（%）— 代理店が設定';
COMMENT ON COLUMN task_pricing.sell_total IS '売値合計（円）— クライアントに提示する金額';
COMMENT ON COLUMN task_pricing.vendor_submitted_at IS '制作会社が見積もり提出した日時';
COMMENT ON COLUMN task_pricing.agency_approved_at IS '代理店が原価を承認した日時';
COMMENT ON COLUMN task_pricing.client_approved_at IS 'クライアントが売値を承認した日時';

-- updated_at 自動更新トリガー
CREATE OR REPLACE FUNCTION update_task_pricing_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_task_pricing_updated_at
  BEFORE UPDATE ON task_pricing
  FOR EACH ROW
  EXECUTE FUNCTION update_task_pricing_updated_at();
