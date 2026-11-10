create policy commission_settings_no_client_access
on public.commission_settings
for all
to anon, authenticated
using (false)
with check (false);