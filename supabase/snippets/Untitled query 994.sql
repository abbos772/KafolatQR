BEGIN;

SET LOCAL ROLE authenticated;

DO $$
BEGIN
  BEGIN
    INSERT INTO public.payment_transactions (
      store_id,
      subscription_id,
      provider,
      provider_payment_id,
      amount_minor_units,
      currency,
      status
    )
    VALUES (
      '6e55e69d-3da9-4167-a0a1-2aea142ae30b',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'rls-test',
      'rls-test-payment-001',
      100,
      'USD',
      'pending'
    );

    RAISE EXCEPTION
      'TEST FAILED: authenticated inserted a payment transaction';

  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE
        'PASS: authenticated cannot insert payment transactions';
  END;
END $$;

ROLLBACK;