-- Migration 027 — email em profiles + índice financeiro

-- Adiciona coluna email em profiles (sincronizada com auth.users via trigger)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email TEXT;

-- Índice para busca por email
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(company_id, email);

-- Popula email dos usuários existentes a partir do auth.users
UPDATE public.profiles p
SET email = u.email
FROM auth.users u
WHERE p.id = u.id AND p.email IS NULL;

-- Trigger para sincronizar email quando auth.users mudar
CREATE OR REPLACE FUNCTION public.sync_profile_email()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.profiles SET email = NEW.email WHERE id = NEW.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_email_changed ON auth.users;
CREATE TRIGGER on_auth_user_email_changed
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.sync_profile_email();

-- Índice para paginação financeira eficiente
CREATE INDEX IF NOT EXISTS idx_financial_entries_company_due
  ON public.financial_entries(company_id, due_date, status);
