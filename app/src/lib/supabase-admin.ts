import { createClient as createAdminClient } from "@supabase/supabase-js";

let adminClient: ReturnType<typeof createAdminClient<any>> | null = null;

export function createAdmin() {
    if (!adminClient) {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
        const serviceKey =
            process.env.SUPABASE_SERVICE_ROLE_KEY ||
            process.env.SUPABASE_SECRET_KEY ||
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

        adminClient = createAdminClient(supabaseUrl, serviceKey);
    }

    return adminClient;
}
