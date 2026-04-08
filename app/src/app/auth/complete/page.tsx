import { redirect } from "next/navigation";

import { AuthCompleteClient } from "./auth-complete-client";
import { createClient } from "@/lib/supabase-server";
import { getBetaLoginHref, getBetaTargetPath } from "@/lib/beta-access";

function readSearchParam(value: string | string[] | undefined) {
    if (Array.isArray(value)) return value[0];
    return value;
}

export default async function AuthCompletePage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const params = await searchParams;
    const nextPath = getBetaTargetPath(readSearchParam(params.next));

    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (user) {
        redirect(nextPath);
    }

    return (
        <AuthCompleteClient
            nextPath={nextPath}
            loginHref={getBetaLoginHref(nextPath)}
        />
    );
}
