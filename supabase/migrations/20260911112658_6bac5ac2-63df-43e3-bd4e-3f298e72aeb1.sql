INSERT INTO public.admin_emails (email) VALUES ('brototypewithfaru@gmail.com') ON CONFLICT DO NOTHING;

INSERT INTO public.user_roles (user_id, role)
SELECT p.id, 'admin'::app_role FROM public.profiles p
WHERE lower(p.email) = 'brototypewithfaru@gmail.com'
ON CONFLICT DO NOTHING;