import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";
import type { User } from "@supabase/supabase-js";

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (items: { name: string; value: string; options: CookieOptions }[]) => {
          try {
            items.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Server Components cannot set cookies; middleware refreshes the session.
          }
        },
      },
    },
  );
}

type ServerClient = Awaited<ReturnType<typeof createClient>>;
const usersByClient = new WeakMap<object, Promise<User | null>>();

/** Um cliente por requisicao: layout e pagina renderizam com o mesmo. */
export const getRequestClient = cache(createClient);

/**
 * Usuario logado, verificado no Supabase Auth uma unica vez por cliente.
 * Como layout e pagina usam o mesmo cliente (getRequestClient), a ida ao
 * servidor de autenticacao acontece uma vez por pagina, nao uma por componente.
 */
export async function getAuthUser(db?: Pick<ServerClient, "auth">): Promise<User | null> {
  const client = db ?? await getRequestClient();
  let user = usersByClient.get(client);
  if (!user) {
    user = client.auth.getUser().then(({ data }) => data.user);
    usersByClient.set(client, user);
  }
  return user;
}
