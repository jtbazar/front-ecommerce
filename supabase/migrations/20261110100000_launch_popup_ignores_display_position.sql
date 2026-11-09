-- A launch popup is not a homepage placement. Enforce this even if an admin form
-- still submits a display_position value from a previously selected dropdown.
alter table public.promotions
  alter column display_position drop not null;

create or replace function public.normalize_launch_promotion()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.show_on_launch then
    new.campaign_type := 'popup';
    new.display_position := null;
  end if;
  return new;
end;
$$;

drop trigger if exists promotions_normalize_launch_promotion on public.promotions;
create trigger promotions_normalize_launch_promotion
before insert or update of show_on_launch, campaign_type, display_position
on public.promotions
for each row
execute function public.normalize_launch_promotion();

comment on column public.promotions.display_position is
  'Homepage placement for banner campaigns; NULL for launch popup campaigns.';
