import { createClient } from "@/lib/supabase-server";
import { NextRequest, NextResponse } from "next/server";
import { checkPremium } from "@/lib/check-premium";
import { enqueueValidationJob } from "@/lib/queue";
import { isValidDepth, DEFAULT_DEPTH, type ValidationDepth } from "@/lib/validation-depth";

const validateTimestamps = new Map<string, number[]>();
const MAX_VALIDATIONS_PER_HOUR = 5;

function checkRateLimit(userId: string): boolean {
    const now = Date.now();
    const hourAgo = now - 3600_000;
    const stamps = (validateTimestamps.get(userId) || []).filter((time) => time > hourAgo);

    if (stamps.length >= MAX_VALIDATIONS_PER_HOUR) return false;

    stamps.push(now);
    validateTimestamps.set(userId, stamps);
    return true;
}

export async function POST(req: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        if (!checkRateLimit(user.id)) {
            return NextResponse.json({ error: "Rate limit exceeded — max 5 validations per hour" }, { status: 429 });
        }

        const { isPremium } = await checkPremium(supabase, user.id);
        if (!isPremium) {
            return NextResponse.json({ error: "Premium subscription required" }, { status: 403 });
        }

        const body = await req.json();
        const idea = typeof body?.idea === "string" ? body.idea : "";
        if (idea.trim().length < 10) {
            return NextResponse.json({ error: "Idea must be at least 10 characters" }, { status: 400 });
        }

        const trimmedIdea = idea.trim().slice(0, 2000);
        const depth: ValidationDepth = isValidDepth(body?.depth) ? body.depth : DEFAULT_DEPTH;

        const { data: validation, error } = await supabase
            .from("idea_validations")
            .insert({
                user_id: user.id,
                idea_text: trimmedIdea,
                model: "multi-brain",
                status: "queued",
                depth,
            })
            .select()
            .single();

        if (error || !validation) {
            console.error("Validation insert error:", error?.code, error?.message);
            return NextResponse.json({
                error: error?.code === "42P01"
                    ? "idea_validations table not found — run schema_validations.sql in Supabase SQL Editor first!"
                    : error?.message || "Could not create validation job",
            }, { status: 500 });
        }

        try {
            const jobId = await enqueueValidationJob({
                validationId: validation.id,
                userId: user.id,
                idea: trimmedIdea,
                depth,
            });

            return NextResponse.json({
                job_id: jobId,
                validationId: validation.id,
                status: "queued",
            });
        } catch (queueError) {
            const message = queueError instanceof Error ? queueError.message : "Failed to enqueue validation";

            const { error: persistError } = await supabase
                .from("idea_validations")
                .update({
                    status: "failed",
                    report: JSON.stringify({ error: message, failure_stage: "queue_enqueue" }),
                    completed_at: new Date().toISOString(),
                })
                .eq("id", validation.id);

            if (persistError) {
                console.error("[Validate] Failed to persist enqueue failure:", persistError);
            }

            console.error("[Validate] Queue enqueue error:", message);
            return NextResponse.json({ error: message }, { status: 500 });
        }
    } catch (error) {
        console.error("Validate POST error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

export async function GET() {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { data: validations } = await supabase
            .from("idea_validations")
            .select("*")
            .eq("user_id", user.id)
            .order("created_at", { ascending: false })
            .limit(20);

        return NextResponse.json({ validations: validations || [] });
    } catch {
        return NextResponse.json({ validations: [] });
    }
}
