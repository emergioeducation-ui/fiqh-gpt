CREATE EXTENSION IF NOT EXISTS vector;

-- ROLES ----------------------------------------------------------------
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_own_select" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "profiles_own_update" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_roles_own_select" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE TABLE public.admin_emails (
  email text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.admin_emails TO service_role;
ALTER TABLE public.admin_emails ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_emails_admin_all" ON public.admin_emails FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_emails TO authenticated;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(COALESCE(NEW.email, ''), '@', 1)))
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user') ON CONFLICT DO NOTHING;

  IF EXISTS (SELECT 1 FROM public.admin_emails ae WHERE lower(ae.email) = lower(COALESCE(NEW.email, ''))) THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin') ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- CHAT -----------------------------------------------------------------
CREATE TABLE public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'New chat',
  mode text NOT NULL DEFAULT 'fatwa',
  school text NOT NULL DEFAULT 'general',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversations TO authenticated;
GRANT ALL ON public.conversations TO service_role;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "conversations_own_all" ON public.conversations FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX conversations_user_updated_idx ON public.conversations (user_id, updated_at DESC);

CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL,
  content text NOT NULL,
  citations jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "messages_own_all" ON public.messages FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX messages_conversation_idx ON public.messages (conversation_id, created_at);

-- LIBRARY --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_arabic(input text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path = public AS $$
  SELECT lower(
    regexp_replace(
      translate(
        regexp_replace(input, '[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]', '', 'g'),
        'أإآٱىئؤةﻻ', 'ااااييوه ل'
      ),
      '\s+', ' ', 'g'
    )
  );
$$;

CREATE TABLE public.books (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  title_arabic text,
  author text,
  school text NOT NULL DEFAULT 'general',
  topic text NOT NULL DEFAULT 'general',
  language text NOT NULL DEFAULT 'ar',
  file_url text,
  file_public_id text,
  file_type text,
  status text NOT NULL DEFAULT 'pending',
  status_message text,
  passage_count integer NOT NULL DEFAULT 0,
  notes text,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.books TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.books TO authenticated;
GRANT ALL ON public.books TO service_role;
ALTER TABLE public.books ENABLE ROW LEVEL SECURITY;
CREATE POLICY "books_public_read" ON public.books FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "books_admin_write" ON public.books FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.book_passages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  school text NOT NULL DEFAULT 'general',
  topic text NOT NULL DEFAULT 'general',
  chapter text,
  page_label text,
  position integer NOT NULL DEFAULT 0,
  content text NOT NULL,
  content_norm text GENERATED ALWAYS AS (public.normalize_arabic(content)) STORED,
  embedding vector(3072),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.book_passages TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.book_passages TO authenticated;
GRANT ALL ON public.book_passages TO service_role;
ALTER TABLE public.book_passages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "passages_public_read" ON public.book_passages FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "passages_admin_write" ON public.book_passages FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX book_passages_book_idx ON public.book_passages (book_id, position);
CREATE INDEX book_passages_school_topic_idx ON public.book_passages (school, topic);
CREATE INDEX book_passages_fts_idx ON public.book_passages USING gin (to_tsvector('simple', content_norm));
CREATE INDEX book_passages_embedding_idx ON public.book_passages USING hnsw ((embedding::halfvec(3072)) halfvec_cosine_ops);

CREATE OR REPLACE FUNCTION public.match_book_passages(
  query_embedding vector(3072),
  query_text text,
  p_schools text[],
  p_topics text[],
  match_count int DEFAULT 8
)
RETURNS TABLE (
  id uuid,
  book_id uuid,
  book_title text,
  book_author text,
  school text,
  topic text,
  chapter text,
  page_label text,
  content text,
  score double precision
)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH q AS (SELECT public.normalize_arabic(COALESCE(query_text, '')) AS nq),
  semantic AS (
    SELECT p.id,
           1 - (p.embedding::halfvec(3072) <=> query_embedding::halfvec(3072)) AS s
    FROM public.book_passages p
    WHERE p.embedding IS NOT NULL
      AND (p_schools IS NULL OR p.school = ANY (p_schools))
      AND (p_topics IS NULL OR p.topic = ANY (p_topics))
    ORDER BY p.embedding::halfvec(3072) <=> query_embedding::halfvec(3072)
    LIMIT match_count * 4
  ),
  lexical AS (
    SELECT p.id,
           ts_rank(to_tsvector('simple', p.content_norm), plainto_tsquery('simple', (SELECT nq FROM q))) AS s
    FROM public.book_passages p
    WHERE (SELECT nq FROM q) <> ''
      AND to_tsvector('simple', p.content_norm) @@ plainto_tsquery('simple', (SELECT nq FROM q))
      AND (p_schools IS NULL OR p.school = ANY (p_schools))
      AND (p_topics IS NULL OR p.topic = ANY (p_topics))
    ORDER BY s DESC
    LIMIT match_count * 4
  ),
  merged AS (
    SELECT COALESCE(sm.id, lx.id) AS id,
           COALESCE(sm.s, 0) * 0.7 + LEAST(COALESCE(lx.s, 0) * 4, 1) * 0.3 AS score
    FROM semantic sm FULL OUTER JOIN lexical lx ON sm.id = lx.id
  )
  SELECT p.id, p.book_id, b.title, b.author, p.school, p.topic, p.chapter, p.page_label, p.content, m.score
  FROM merged m
  JOIN public.book_passages p ON p.id = m.id
  JOIN public.books b ON b.id = p.book_id
  ORDER BY m.score DESC
  LIMIT match_count;
$$;

-- ZAKAT SETTINGS -------------------------------------------------------
CREATE TABLE public.zakat_settings (
  key text PRIMARY KEY,
  value numeric NOT NULL,
  unit text,
  label text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.zakat_settings TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.zakat_settings TO authenticated;
GRANT ALL ON public.zakat_settings TO service_role;
ALTER TABLE public.zakat_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "zakat_public_read" ON public.zakat_settings FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "zakat_admin_write" ON public.zakat_settings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.zakat_settings (key, value, unit, label) VALUES
  ('gold_price_per_gram', 75, 'USD', 'Gold price per gram'),
  ('silver_price_per_gram', 0.9, 'USD', 'Silver price per gram'),
  ('gold_nisab_grams', 85, 'g', 'Nisab of gold (85g / 20 mithqal)'),
  ('silver_nisab_grams', 595, 'g', 'Nisab of silver (595g / 200 dirham)'),
  ('fitr_saa_kg', 2.5, 'kg', 'One saa of staple food (approx. kg)'),
  ('fitr_food_price_per_kg', 2, 'USD', 'Price per kg of staple food');

-- USAGE ----------------------------------------------------------------
CREATE TABLE public.usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  mode text NOT NULL,
  school text,
  question text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.usage_events TO authenticated;
GRANT ALL ON public.usage_events TO service_role;
ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "usage_admin_read" ON public.usage_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER books_touch BEFORE UPDATE ON public.books FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER conversations_touch BEFORE UPDATE ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();