-- Delivery completion must only happen through the driver's OTP + proof-photo workflow.
-- The admin UI no longer exposes manual completion; remove the authenticated RPC grant
-- as a server-side guard so stale clients cannot bypass driver verification.
REVOKE EXECUTE ON FUNCTION public.admin_mark_delivery_batch_delivered(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_mark_delivery_batch_delivered(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_mark_delivery_batch_delivered(uuid) FROM authenticated;
