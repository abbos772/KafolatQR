DO $$
BEGIN
  BEGIN
    INSERT INTO public.warranty_cards (
      store_id,
      product_id,
      purchase_date,
      store_warranty_months
    )
    VALUES (
      '1d583bae-8d53-4124-9c72-b12c409fa0bd',
      'e58de6d1-30f1-419a-8924-c26f0770f2a7',
      CURRENT_DATE,
      12
    );

    RAISE EXCEPTION
      'TEST FAILED: cross-store product association was allowed';

  EXCEPTION
    WHEN foreign_key_violation THEN
      RAISE NOTICE
        'PASS: warranty_cards_product_same_store rejected cross-store product';
  END;
END $$;