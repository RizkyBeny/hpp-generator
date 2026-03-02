-- ==========================================
-- FINAL SCHEMA REPAIR & SYNCHRONIZATION
-- ==========================================

-- 1. FIX TRANSACTIONS TABLE COLUMNS
DO $$ 
BEGIN 
  -- Rename 'total' to 'total_amount' if it hasn't been renamed yet
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'transactions' AND column_name = 'total') THEN
    ALTER TABLE transactions RENAME COLUMN total TO total_amount;
  END IF;

  -- Add 'total_hpp' if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'transactions' AND column_name = 'total_hpp') THEN
    ALTER TABLE transactions ADD COLUMN total_hpp DECIMAL(12,2) NOT NULL DEFAULT 0;
  END IF;
  
  -- Ensure 'subtotal' and 'discount' exist (just in case)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'transactions' AND column_name = 'subtotal') THEN
    ALTER TABLE transactions ADD COLUMN subtotal DECIMAL(12,2) NOT NULL DEFAULT 0;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'transactions' AND column_name = 'discount') THEN
    ALTER TABLE transactions ADD COLUMN discount DECIMAL(12,2) NOT NULL DEFAULT 0;
  END IF;

  -- Fix stock_movements column name if it used 'type' instead of 'movement_type'
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'stock_movements' AND column_name = 'type') THEN
    ALTER TABLE stock_movements RENAME COLUMN type TO movement_type;
  END IF;
END $$;

-- 2. RE-CREATE process_sale FUNCTION WITH CORRECT SCHEMA
-- Drop both potential variants to avoid ambiguity
DROP FUNCTION IF EXISTS public.process_sale(uuid, varchar, varchar, varchar, varchar, numeric, text, date, time, jsonb);
DROP FUNCTION IF EXISTS public.process_sale(uuid, text, text, text, text, numeric, text, date, time, jsonb);

CREATE OR REPLACE FUNCTION process_sale(
  p_user_id         UUID,
  p_sale_channel    TEXT,
  p_payment_method  TEXT,
  p_customer_name   TEXT,
  p_customer_contact TEXT,
  p_discount        DECIMAL,
  p_notes           TEXT,
  p_sale_date       DATE,
  p_sale_time       TIME,
  p_items           JSONB -- Array of {recipe_id, recipe_name, quantity, unit_price, hpp_at_sale}
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_transaction_id   UUID := gen_random_uuid();
  v_receipt_number   TEXT;
  v_subtotal         DECIMAL := 0;
  v_total_amount     DECIMAL;
  v_total_hpp        DECIMAL := 0;
  v_item             JSONB;
  v_ri               RECORD;
  v_warnings         TEXT[] := '{}';
BEGIN
  -- 1. Generate receipt number
  v_receipt_number := 'INV-' || to_char(p_sale_date, 'YYYYMMDD') || '-' || upper(substring(gen_random_uuid()::text, 1, 6));

  -- 2. Calculate subtotal
  SELECT SUM((item->>'unit_price')::DECIMAL * (item->>'quantity')::INT)
  INTO v_subtotal
  FROM jsonb_array_elements(p_items) AS item;

  v_total_amount := v_subtotal - COALESCE(p_discount, 0);

  -- 3. Insert transaction header
  INSERT INTO transactions (
    id, user_id, receipt_number, sale_channel, payment_method,
    customer_name, customer_contact, subtotal, discount, total_amount,
    notes, sale_date, sale_time
  ) VALUES (
    v_transaction_id, p_user_id, v_receipt_number, p_sale_channel, p_payment_method,
    p_customer_name, p_customer_contact, v_subtotal, COALESCE(p_discount, 0), v_total_amount,
    p_notes, p_sale_date, p_sale_time
  );

  -- 4. Process items and deduct stock
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    -- Insert transaction item
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

    -- Deduct stock logic
    FOR v_ri IN
      SELECT ri.ingredient_id, ri.quantity, ri.unit, ing.name as ing_name, ing.stock_quantity as current_stock
      FROM recipe_ingredients ri
      JOIN ingredients ing ON ing.id = ri.ingredient_id
      WHERE ri.recipe_id = (v_item->>'recipe_id')::UUID
    LOOP
      DECLARE
        v_deduct_qty DECIMAL := v_ri.quantity * (v_item->>'quantity')::INT;
        v_qty_after DECIMAL := v_ri.current_stock - v_deduct_qty;
      BEGIN
        IF v_ri.current_stock < v_deduct_qty THEN
          v_warnings := array_append(v_warnings, 'Stok ' || v_ri.ing_name || ' tidak cukup');
        END IF;

        UPDATE ingredients 
        SET stock_quantity = v_qty_after 
        WHERE id = v_ri.ingredient_id;

        INSERT INTO stock_movements (
          user_id, ingredient_id, ingredient_name, movement_type, quantity_change, 
          quantity_before, quantity_after, unit, reference_id, reference_type
        ) VALUES (
          p_user_id, v_ri.ingredient_id, v_ri.ing_name, 'sale', -v_deduct_qty,
          v_ri.current_stock, v_qty_after, v_ri.unit, v_transaction_id, 'transaction'
        );
      END;
    END LOOP;
  END LOOP;

  -- 5. Update final HPP
  UPDATE transactions SET total_hpp = v_total_hpp WHERE id = v_transaction_id;

  RETURN jsonb_build_object(
    'transaction_id', v_transaction_id,
    'receipt_number', v_receipt_number,
    'total_amount', v_total_amount,
    'total_hpp', v_total_hpp,
    'stock_warnings', v_warnings
  );
END;
$$;

-- 3. RE-CREATE void_transaction FUNCTION
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
