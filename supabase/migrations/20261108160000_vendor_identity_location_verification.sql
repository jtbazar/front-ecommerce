BEGIN;

ALTER TABLE public.seller_profiles
  ADD COLUMN IF NOT EXISTS vendor_type text,
  ADD COLUMN IF NOT EXISTS owner_full_name text,
  ADD COLUMN IF NOT EXISTS cnic_number text,
  ADD COLUMN IF NOT EXISTS shop_location_text text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.seller_profiles'::regclass
      AND conname = 'seller_profiles_vendor_type_check'
  ) THEN
    ALTER TABLE public.seller_profiles
      ADD CONSTRAINT seller_profiles_vendor_type_check
      CHECK (
        vendor_type IS NULL OR vendor_type IN (
          'individual_seller',
          'registered_business',
          'sole_proprietor',
          'partnership',
          'company'
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.seller_profiles'::regclass
      AND conname = 'seller_profiles_pending_identity_location_check'
  ) THEN
    ALTER TABLE public.seller_profiles
      ADD CONSTRAINT seller_profiles_pending_identity_location_check
      CHECK (
        status <> 'pending'
        OR (
          vendor_type IS NOT NULL
          AND length(btrim(COALESCE(owner_full_name, ''))) >= 3
          AND cnic_number ~ '^[0-9]{13}$'
          AND length(btrim(COALESCE(shop_location_text, ''))) >= 10
          AND shop_lat IS NOT NULL
          AND shop_lng IS NOT NULL
          AND shop_lat BETWEEN -90 AND 90
          AND shop_lng BETWEEN -180 AND 180
        )
      ) NOT VALID;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION private.validate_seller_identity_location()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'pending' THEN
    IF NEW.vendor_type IS NULL OR NEW.vendor_type NOT IN (
      'individual_seller',
      'registered_business',
      'sole_proprietor',
      'partnership',
      'company'
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'Select a valid seller or business type.';
    END IF;

    IF length(btrim(COALESCE(NEW.owner_full_name, ''))) < 3 THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'Owner full legal name is required.';
    END IF;

    IF NEW.cnic_number IS NULL OR NEW.cnic_number !~ '^[0-9]{13}$' THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'A valid 13-digit CNIC number without dashes is required.';
    END IF;

    IF length(btrim(COALESCE(NEW.shop_location_text, ''))) < 10 THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'Complete shop location/address is required.';
    END IF;

    IF NEW.shop_lat IS NULL OR NEW.shop_lng IS NULL
      OR NEW.shop_lat NOT BETWEEN -90 AND 90
      OR NEW.shop_lng NOT BETWEEN -180 AND 180 THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'A valid shop map pin is required.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS seller_profiles_validate_identity_location
  ON public.seller_profiles;

CREATE TRIGGER seller_profiles_validate_identity_location
  BEFORE INSERT OR UPDATE OF
    status, vendor_type, owner_full_name, cnic_number,
    shop_location_text, shop_lat, shop_lng
  ON public.seller_profiles
  FOR EACH ROW
  EXECUTE FUNCTION private.validate_seller_identity_location();

REVOKE ALL ON FUNCTION private.validate_seller_identity_location()
  FROM PUBLIC, anon, authenticated;

COMMIT;
