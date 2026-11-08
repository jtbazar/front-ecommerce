BEGIN;

ALTER TABLE public.seller_profiles
  ADD COLUMN IF NOT EXISTS cnic_front_path text,
  ADD COLUMN IF NOT EXISTS cnic_back_path text;

GRANT INSERT (cnic_front_path, cnic_back_path)
  ON TABLE public.seller_profiles TO authenticated;
GRANT UPDATE (cnic_front_path, cnic_back_path)
  ON TABLE public.seller_profiles TO authenticated;

-- Verification files are never public. Applicants can upload/read their own
-- files; only marketplace administrators can read application evidence.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('vendor-documents', 'vendor-documents', false, 10485760,
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']::text[])
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS vendor_documents_owner_insert ON storage.objects;
DROP POLICY IF EXISTS vendor_documents_owner_read ON storage.objects;
DROP POLICY IF EXISTS vendor_documents_admin_read ON storage.objects;
DROP POLICY IF EXISTS vendor_documents_owner_delete ON storage.objects;

CREATE POLICY vendor_documents_owner_insert ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (
    bucket_id = 'vendor-documents'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  );
CREATE POLICY vendor_documents_owner_read ON storage.objects
  FOR SELECT TO authenticated USING (
    bucket_id = 'vendor-documents'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  );
CREATE POLICY vendor_documents_admin_read ON storage.objects
  FOR SELECT TO authenticated USING (
    bucket_id = 'vendor-documents'
    AND (SELECT private.has_role('admin'::public.app_role))
  );
CREATE POLICY vendor_documents_owner_delete ON storage.objects
  FOR DELETE TO authenticated USING (
    bucket_id = 'vendor-documents'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  );

ALTER TABLE public.seller_profiles
  DROP CONSTRAINT IF EXISTS seller_profiles_pending_requires_document_check;
ALTER TABLE public.seller_profiles
  ADD CONSTRAINT seller_profiles_pending_requires_document_check
  CHECK (
    status <> 'pending'::public.seller_status
    OR (
      document_path IS NOT NULL
      AND cnic_front_path IS NOT NULL
      AND cnic_back_path IS NOT NULL
    )
  );

CREATE OR REPLACE FUNCTION private.validate_seller_application_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'pending' THEN
    IF length(btrim(COALESCE(NEW.shop_name, ''))) < 2 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Shop name is required.';
    END IF;
    IF NEW.slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A valid shop URL is required.';
    END IF;
    IF length(btrim(COALESCE(NEW.description, ''))) < 10 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A shop description of at least 10 characters is required.';
    END IF;
    IF NEW.contact_email IS NULL OR NEW.contact_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A valid business contact email is required.';
    END IF;
    IF NEW.phone IS NULL OR NEW.phone !~ '^(03[0-9]{9}|[+]923[0-9]{9})$' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A valid Pakistani business phone number is required.';
    END IF;
    IF length(btrim(COALESCE(NEW.current_address, ''))) < 3 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Current Address is required.';
    END IF;
    IF length(btrim(COALESCE(NEW.complete_address, ''))) < 10 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Complete Address is required.';
    END IF;
    IF NEW.document_path IS NULL OR btrim(NEW.document_path) = ''
      OR NEW.cnic_front_path IS NULL OR btrim(NEW.cnic_front_path) = ''
      OR NEW.cnic_back_path IS NULL OR btrim(NEW.cnic_back_path) = '' THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'CNIC front, CNIC back and identity/business registration documents are required.';
    END IF;
    IF split_part(NEW.document_path, '/', 1) <> NEW.user_id::text
      OR split_part(NEW.cnic_front_path, '/', 1) <> NEW.user_id::text
      OR split_part(NEW.cnic_back_path, '/', 1) <> NEW.user_id::text THEN
      RAISE EXCEPTION USING ERRCODE = '42501',
        MESSAGE = 'All verification documents must belong to the applicant.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.validate_seller_application_fields() FROM PUBLIC, anon, authenticated;

COMMIT;
