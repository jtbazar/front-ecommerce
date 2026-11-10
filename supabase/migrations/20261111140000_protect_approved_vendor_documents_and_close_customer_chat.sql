-- Prevent both customers and administrators from appending messages to resolved customer tickets.
CREATE OR REPLACE FUNCTION private.prevent_customer_support_reply_when_resolved()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT lower(status)
    INTO v_status
    FROM public.customer_support_tickets
   WHERE id = NEW.ticket_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'Customer support ticket does not exist.';
  END IF;

  IF v_status IN ('resolved', 'closed') THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = 'This support ticket is resolved. Reopen it before sending a reply.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.prevent_customer_support_reply_when_resolved() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS customer_support_messages_block_resolved ON public.customer_support_messages;
CREATE TRIGGER customer_support_messages_block_resolved
BEFORE INSERT ON public.customer_support_messages
FOR EACH ROW
EXECUTE FUNCTION private.prevent_customer_support_reply_when_resolved();

-- Keep the private KYC bucket readable only by its owner and authorized admins,
-- and freeze vendor-side writes once that vendor has been approved.
DROP POLICY IF EXISTS vendor_documents_owner_insert ON storage.objects;
DROP POLICY IF EXISTS vendor_documents_owner_update ON storage.objects;
DROP POLICY IF EXISTS vendor_documents_owner_delete ON storage.objects;
DROP POLICY IF EXISTS vendor_documents_owner_or_admin_delete ON storage.objects;
DROP POLICY IF EXISTS vendor_documents_admin_delete ON storage.objects;

CREATE POLICY vendor_documents_owner_insert
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'vendor-documents'
  AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  AND NOT EXISTS (
    SELECT 1 FROM public.seller_profiles s
    WHERE s.user_id = (SELECT auth.uid())
      AND s.status = 'approved'::public.seller_status
  )
);

CREATE POLICY vendor_documents_owner_update
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'vendor-documents'
  AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  AND NOT EXISTS (
    SELECT 1 FROM public.seller_profiles s
    WHERE s.user_id = (SELECT auth.uid())
      AND s.status = 'approved'::public.seller_status
  )
)
WITH CHECK (
  bucket_id = 'vendor-documents'
  AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  AND NOT EXISTS (
    SELECT 1 FROM public.seller_profiles s
    WHERE s.user_id = (SELECT auth.uid())
      AND s.status = 'approved'::public.seller_status
  )
);

CREATE POLICY vendor_documents_owner_delete
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'vendor-documents'
  AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  AND NOT EXISTS (
    SELECT 1 FROM public.seller_profiles s
    WHERE s.user_id = (SELECT auth.uid())
      AND s.status = 'approved'::public.seller_status
  )
);

CREATE POLICY vendor_documents_admin_delete
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'vendor-documents'
  AND (SELECT private.has_role('admin'::public.app_role))
);

CREATE INDEX IF NOT EXISTS customer_support_messages_ticket_created_idx
ON public.customer_support_messages(ticket_id, created_at ASC);
