-- 1. Backfill profile + roles for existing signed-up users, and grant admin from admin_emails
INSERT INTO public.profiles (id, email, display_name)
SELECT u.id, u.email, COALESCE(u.raw_user_meta_data->>'display_name', split_part(COALESCE(u.email, ''), '@', 1))
FROM auth.users u
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'user'::app_role FROM auth.users u
ON CONFLICT (user_id, role) DO NOTHING;

INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'admin'::app_role
FROM auth.users u
JOIN public.admin_emails ae ON lower(ae.email) = lower(COALESCE(u.email, ''))
ON CONFLICT (user_id, role) DO NOTHING;

-- 2. Realtime
ALTER TABLE public.conversations REPLICA IDENTITY FULL;
ALTER TABLE public.messages REPLICA IDENTITY FULL;
ALTER TABLE public.books REPLICA IDENTITY FULL;
ALTER TABLE public.zakat_settings REPLICA IDENTITY FULL;
ALTER TABLE public.usage_events REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.messages; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.books; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.zakat_settings; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.usage_events; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;