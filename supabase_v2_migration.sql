-- ============================================================
-- HargaKu Phase 2 Migration: POS & Inventory Integration
-- ============================================================

-- 1. EXTEND ingredients table
ALTER TABLE ingredients
  ADD COLUMN IF NOT EXISTS user_id           UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS stock_quantity    DECIMAL(10,3),
  ADD COLUMN IF NOT EXISTS stock_unit        VARCHAR(20),
  ADD COLUMN IF NOT EXISTS min_stock_alert   DECIMAL(10,3),
  ADD COLUMN IF NOT EXISTS last_restocked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stock_notes       TEXT;

CREATE INDEX IF NOT EXISTS idx_ingredients_user_stock
  ON ingredients(user_id, stock_quantity, min_stock_alert);

-- 2. CREATE transactions table
CREATE TABLE IF NOT EXISTS transactions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  receipt_number      VARCHAR(25) UNIQUE,
  sale_channel    VARCHAR(20) NOT NULL DEFAULT 'walkin', -- walkin | whatsapp | manual
  status          VARCHAR(20) NOT NULL DEFAULT 'completed', -- completed | voided
  payment_method  VARCHAR(20), -- cash | transfer | qris | cod | null
  customer_name   VARCHAR(255),
  customer_contact VARCHAR(100),
  subtotal        DECIMAL(12,2) NOT NULL,
  discount        DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_amount    DECIMAL(12,2) NOT NULL, -- Renamed from total
  total_hpp       DECIMAL(12,2) NOT NULL DEFAULT 0, -- Added for rekap HPP
  notes           TEXT,
  sale_date       DATE         NOT NULL DEFAULT CURRENT_DATE,
  sale_time       TIME,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  voided_at       TIMESTAMPTZ,
  voided_by       UUID         REFERENCES auth.users(id),
  voided_reason   TEXT
);

CREATE INDEX IF NOT EXISTS idx_transactions_user_date
  ON transactions(user_id, sale_date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_status
  ON transactions(user_id, status);

-- 3. CREATE transaction_items table
CREATE TABLE IF NOT EXISTS transaction_items (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id  UUID        NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  recipe_id       UUID        REFERENCES recipes(id) ON DELETE SET NULL,
  recipe_name     VARCHAR(255) NOT NULL, -- SNAPSHOT
  quantity        INTEGER     NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price      DECIMAL(12,2) NOT NULL, -- SNAPSHOT
  hpp_at_sale     DECIMAL(12,2), -- SNAPSHOT
  subtotal        DECIMAL(12,2) NOT NULL -- unit_price * quantity
);

CREATE INDEX IF NOT EXISTS idx_transaction_items_transaction
  ON transaction_items(transaction_id);

-- 4. CREATE stock_movements table
CREATE TABLE IF NOT EXISTS stock_movements (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ingredient_id    UUID        REFERENCES ingredients(id) ON DELETE SET NULL,
  ingredient_name  VARCHAR(255) NOT NULL, -- SNAPSHOT
  movement_type    VARCHAR(20)  NOT NULL, -- sale | restock | adjustment | void | initial
  quantity_change  DECIMAL(10,3) NOT NULL,
  quantity_before  DECIMAL(10,3),
  quantity_after   DECIMAL(10,3),
  unit             VARCHAR(20),
  reference_id     UUID, -- transaction_id or restock_log_id
  reference_type   VARCHAR(20), -- transaction | restock | adjustment
  notes            TEXT,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_ingredient
  ON stock_movements(ingredient_id, created_at DESC);

-- 5. CREATE restock_logs table
CREATE TABLE IF NOT EXISTS restock_logs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ingredient_id   UUID        NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  quantity_added  DECIMAL(10,3) NOT NULL CHECK (quantity_added > 0),
  unit            VARCHAR(20)  NOT NULL,
  purchase_price  DECIMAL(12,2),
  update_base_price BOOLEAN   DEFAULT false,
  supplier_name   VARCHAR(255),
  notes           TEXT,
  purchased_at    DATE         NOT NULL DEFAULT CURRENT_DATE,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- 6. RPC: convert_unit
-- This function mimics the business logic from unitConversion.ts
CREATE OR REPLACE FUNCTION convert_unit(
  p_qty           DECIMAL,
  p_from_unit     TEXT,
  p_to_unit       TEXT
) RETURNS DECIMAL
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  -- Mass
  IF p_from_unit = 'kg' AND p_to_unit = 'gr' THEN RETURN p_qty * 1000;
  ELSIF p_from_unit = 'gr' AND p_to_unit = 'kg' THEN RETURN p_qty / 1000;
  
  -- Volume
  ELSIF p_from_unit = 'L' AND p_to_unit = 'ml' THEN RETURN p_qty * 1000;
  ELSIF p_from_unit = 'ml' AND p_to_unit = 'L' THEN RETURN p_qty / 1000;
  
  -- Count
  ELSIF p_from_unit = 'lusin' AND p_to_unit = 'pcs' THEN RETURN p_qty * 12;
  ELSIF p_from_unit = 'pcs' AND p_to_unit = 'lusin' THEN RETURN p_qty / 12;

  -- Identity
  ELSIF p_from_unit = p_to_unit THEN RETURN p_qty;
  
  ELSE
    RAISE EXCEPTION 'UNSUPPORTED_UNIT_CONVERSION: % to %', p_from_unit, p_to_unit;
  END IF;
END;
$$;

-- 7. RPC: process_sale
CREATE OR REPLACE FUNCTION process_sale(
  p_user_id        UUID,
  p_sale_channel   TEXT,
  p_payment_method TEXT,
  p_customer_name  TEXT,
  p_customer_contact TEXT,
  p_discount       DECIMAL,
  p_notes          TEXT,
  p_sale_date      DATE,
  p_sale_time      TIME,
  p_items          JSONB     -- array of {recipe_id, recipe_name, quantity, unit_price, hpp_at_sale}
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_receipt_number       TEXT;
  v_subtotal         DECIMAL := 0;
  v_total_amount     DECIMAL;
  v_total_hpp        DECIMAL := 0;
  v_item             JSONB;
  v_ri               RECORD;
  v_ingredient       RECORD;
  v_deduction        DECIMAL;
  v_qty_before       DECIMAL;
  v_warnings         JSONB := '[]'::JSONB;
  v_skipped          JSONB := '[]'::JSONB;
BEGIN
  -- Generate trx number: TRX-YYYYMMDD-XXXX
  SELECT 'TRX-' || TO_CHAR(p_sale_date, 'YYYYMMDD') || '-' ||
         LPAD(COALESCE((
           SELECT (COUNT(*) + 1)::TEXT FROM transactions
           WHERE user_id = p_user_id AND sale_date = p_sale_date
         ), '1'), 4, '0')
  INTO v_receipt_number;

  -- Calculate subtotal
  SELECT SUM((item->>'unit_price')::DECIMAL * (item->>'quantity')::INT)
  INTO v_subtotal
  FROM jsonb_array_elements(p_items) AS item;

  v_total_amount := v_subtotal - COALESCE(p_discount, 0);

  -- Insert header
  INSERT INTO transactions (
    id, user_id, receipt_number, sale_channel, payment_method,
    customer_name, customer_contact, subtotal, discount, total_amount,
    notes, sale_date, sale_time
  ) VALUES (
    v_transaction_id, p_user_id, v_receipt_number, p_sale_channel, p_payment_method,
    p_customer_name, p_customer_contact, v_subtotal, COALESCE(p_discount, 0), v_total_amount,
    p_notes, p_sale_date, p_sale_time
  );

  -- Process items
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    
    -- Insert detail
    INSERT INTO transaction_items (
      transaction_id, recipe_id, recipe_name, quantity, unit_price, hpp_at_sale, subtotal
    ) VALUES (
      v_transaction_id,
      (v_item->>'recipe_id')::UUID,
      v_item->>'recipe_name',
      (v_item->>'quantity')::INT,
      (v_item->>'unit_price')::DECIMAL,
      (v_item->>'hpp_at_sale')::DECIMAL,
      (v_item->>'unit_price')::DECIMAL * (v_item->>'quantity')::INT
    );

    -- Accumulate total HPP
    v_total_hpp := v_total_hpp + (COALESCE((v_item->>'hpp_at_sale')::DECIMAL, 0) * (v_item->>'quantity')::INT);

    -- Deduct stock
    FOR v_ri IN
      SELECT ri.ingredient_id, ri.quantity, ri.unit, r.portions
      FROM recipe_ingredients ri
      JOIN recipes r ON r.id = ri.recipe_id
      WHERE ri.recipe_id = (v_item->>'recipe_id')::UUID
    LOOP
      SELECT * INTO v_ingredient FROM ingredients WHERE id = v_ri.ingredient_id;

      -- Skip if stock not initialized
      IF v_ingredient.stock_quantity IS NULL THEN
        v_skipped := v_skipped || jsonb_build_object(
          'ingredient_name', v_ingredient.name,
          'reason', 'stock_not_initialized'
        );
        CONTINUE;
      END IF;

      -- Convert and calculate usage
      BEGIN
        v_deduction := convert_unit(
          (v_ri.quantity / NULLIF(v_ri.portions, 0)) * (v_item->>'quantity')::INT,
          v_ri.unit,
          v_ingredient.stock_unit
        );
      EXCEPTION WHEN OTHERS THEN
        v_skipped := v_skipped || jsonb_build_object(
          'ingredient_name', v_ingredient.name,
          'reason', 'unit_mismatch'
        );
        CONTINUE;
      END;

      v_qty_before := v_ingredient.stock_quantity;

      -- Update stock
      UPDATE ingredients
      SET stock_quantity = stock_quantity - v_deduction
      WHERE id = v_ingredient.id;

      -- Log movement
      INSERT INTO stock_movements (
        user_id, ingredient_id, ingredient_name, movement_type,
        quantity_change, quantity_before, quantity_after,
        unit, reference_id, reference_type
      ) VALUES (
        p_user_id, v_ingredient.id, v_ingredient.name, 'sale',
        -v_deduction, v_qty_before, v_qty_before - v_deduction,
        v_ingredient.stock_unit, v_transaction_id, 'transaction'
      );

      -- Check warnings
      IF v_ingredient.min_stock_alert IS NOT NULL AND
         (v_qty_before - v_deduction) < v_ingredient.min_stock_alert THEN
        v_warnings := v_warnings || jsonb_build_object(
          'ingredient_id', v_ingredient.id,
          'ingredient_name', v_ingredient.name,
          'stock_remaining', v_qty_before - v_deduction,
          'unit', v_ingredient.stock_unit,
          'min_alert', v_ingredient.min_stock_alert
        );
      END IF;
    END LOOP;
  END LOOP;

  -- Update total_hpp in header
  UPDATE transactions SET total_hpp = v_total_hpp WHERE id = v_transaction_id;

  RETURN jsonb_build_object(
    'transaction_id', v_transaction_id,
    'receipt_number', v_receipt_number,
    'total_amount', v_total_amount,
    'total_hpp', v_total_hpp,
    'stock_warnings', v_warnings,
    'skipped_deductions', v_skipped
  );
END;
$$;

-- 8. RPC: void_transaction
CREATE OR REPLACE FUNCTION void_transaction(
  p_transaction_id UUID,
  p_void_reason    TEXT,
  p_user_id        UUID DEFAULT auth.uid()
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_trx      RECORD;
  v_movement RECORD;
BEGIN
  SELECT * INTO v_trx FROM transactions
  WHERE id = p_transaction_id AND user_id = p_user_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'TRANSACTION_NOT_FOUND'; END IF;
  IF v_trx.status = 'voided' THEN RAISE EXCEPTION 'ALREADY_VOIDED'; END IF;
  
  -- Same day rule (optional but recommended in PRD)
  IF v_trx.sale_date < CURRENT_DATE THEN
    RAISE EXCEPTION 'VOID_WINDOW_EXPIRED';
  END IF;

  UPDATE transactions
  SET status = 'voided', voided_at = NOW(), voided_reason = p_void_reason
  WHERE id = p_transaction_id;

  FOR v_movement IN
    SELECT * FROM stock_movements
    WHERE reference_id = p_transaction_id AND movement_type = 'sale'
  LOOP
    UPDATE ingredients
    SET stock_quantity = stock_quantity + ABS(v_movement.quantity_change)
    WHERE id = v_movement.ingredient_id;

    INSERT INTO stock_movements (
      user_id, ingredient_id, ingredient_name, movement_type,
      quantity_change, quantity_before, quantity_after,
      unit, reference_id, reference_type, notes
    ) VALUES (
      p_user_id, v_movement.ingredient_id, v_movement.ingredient_name, 'void',
      ABS(v_movement.quantity_change),
      v_movement.quantity_after,
      v_movement.quantity_after + ABS(v_movement.quantity_change),
      v_movement.unit, p_transaction_id, 'transaction',
      'Stock reversal for void: ' || p_void_reason
    );
  END LOOP;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- 9. RPC: restock_ingredient
CREATE OR REPLACE FUNCTION restock_ingredient(
  p_user_id           UUID,
  p_ingredient_id     UUID,
  p_quantity_added    DECIMAL,
  p_unit              TEXT,
  p_purchase_price    DECIMAL,
  p_update_base_price BOOLEAN,
  p_notes             TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_ing           RECORD;
  v_qty_before    DECIMAL;
BEGIN
  -- Get current state
  SELECT * INTO v_ing FROM ingredients 
  WHERE id = p_ingredient_id AND user_id = p_user_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'INGREDIENT_NOT_FOUND'; END IF;

  v_qty_before := COALESCE(v_ing.stock_quantity, 0);

  -- Update ingredient
  UPDATE ingredients
  SET 
    stock_quantity = v_qty_before + p_quantity_added,
    last_restocked_at = NOW(),
    buy_price = CASE WHEN p_update_base_price THEN p_purchase_price ELSE buy_price END
  WHERE id = p_ingredient_id;

  -- Log to restock_logs
  INSERT INTO restock_logs (
    user_id, ingredient_id, quantity_added, unit, 
    purchase_price, update_base_price, notes
  ) VALUES (
    p_user_id, p_ingredient_id, p_quantity_added, p_unit,
    p_purchase_price, p_update_base_price, p_notes
  );

  -- Log to stock_movements
  INSERT INTO stock_movements (
    user_id, ingredient_id, ingredient_name, movement_type,
    quantity_change, quantity_before, quantity_after,
    unit, reference_id, reference_type, notes
  ) VALUES (
    p_user_id, p_ingredient_id, v_ing.name, 'restock',
    p_quantity_added, v_qty_before, v_qty_before + p_quantity_added,
    p_unit, NULL, 'restock', p_notes
  );

  RETURN jsonb_build_object('success', true, 'new_quantity', v_qty_before + p_quantity_added);
END;
$$;

-- 10. RLS POLICIES
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE transaction_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE restock_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "transactions_user_policy" ON transactions;
CREATE POLICY "transactions_user_policy" ON transactions FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "transaction_items_user_policy" ON transaction_items;
CREATE POLICY "transaction_items_user_policy" ON transaction_items FOR ALL USING (
  EXISTS (SELECT 1 FROM transactions t WHERE t.id = transaction_id AND t.user_id = auth.uid())
);

DROP POLICY IF EXISTS "stock_movements_user_policy" ON stock_movements;
CREATE POLICY "stock_movements_user_policy" ON stock_movements FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "restock_logs_user_policy" ON restock_logs;
CREATE POLICY "restock_logs_user_policy" ON restock_logs FOR ALL USING (auth.uid() = user_id);
