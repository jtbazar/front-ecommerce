alter table public.customer_addresses
  add column if not exists location_label text,
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;

alter table public.customer_addresses
  add constraint customer_addresses_coordinates_pair_check
  check (
    (latitude is null and longitude is null)
    or (latitude between -90 and 90 and longitude between -180 and 180)
  );

alter table public.customer_addresses
  add constraint customer_addresses_location_label_length_check
  check (location_label is null or char_length(btrim(location_label)) between 1 and 60);
