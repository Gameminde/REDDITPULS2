import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { createBrowserClient } from "@supabase/ssr";

function loadEnvFiles() {
    const files = [
        path.resolve(process.cwd(), ".env.local"),
        path.resolve(process.cwd(), "..", ".env"),
    ];

    for (const file of files) {
        try {
            process.loadEnvFile(file);
        } catch {
            // Ignore missing files.
        }
    }
}

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function spawnCommand(command: string, args: string[], cwd: string) {
    const child = spawn(process.env.ComSpec || "cmd.exe", ["/c", command, ...args], {
        cwd,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
    });

    return {
        child,
        getStdout: () => stdout,
        getStderr: () => stderr,
    };
}

async function waitForHttp(baseUrl: string, timeoutMs: number) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
        try {
            const response = await fetch(baseUrl, { redirect: "manual" });
            if (response.status >= 200 || response.status === 307 || response.status === 308) {
                return;
            }
        } catch {
            // Keep polling until the server is reachable.
        }

        await sleep(500);
    }

    throw new Error(`HTTP server at ${baseUrl} did not become reachable in time`);
}

async function waitForLog(
    proc: ReturnType<typeof spawnCommand>,
    matcher: RegExp,
    label: string,
    timeoutMs: number,
) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
        if (matcher.test(proc.getStdout()) || matcher.test(proc.getStderr())) {
            return;
        }

        const exitCode = proc.child.exitCode;
        if (exitCode !== null) {
            throw new Error(`${label} exited early with code ${exitCode}\nSTDOUT:\n${proc.getStdout()}\nSTDERR:\n${proc.getStderr()}`);
        }

        await sleep(500);
    }

    throw new Error(`${label} did not become ready in time\nSTDOUT:\n${proc.getStdout()}\nSTDERR:\n${proc.getStderr()}`);
}

function stopProcess(child: ChildProcess) {
    if (child.exitCode !== null) return;
    child.kill();
}

async function main() {
    loadEnvFiles();

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    const dbUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;

    if (!supabaseUrl || !publishableKey || !secretKey) {
        throw new Error("Missing Supabase API env for verification.");
    }

    if (!dbUrl) {
        throw new Error("Missing SUPABASE_DB_URL or DATABASE_URL for queue verification.");
    }

    const appDir = process.cwd();
    const port = process.env.QUEUE_VERIFY_PORT || "3010";
    const server = spawnCommand("npx", ["next", "dev", "--hostname", "127.0.0.1", "--port", port], appDir);
    const worker = spawnCommand("npm", ["run", "worker"], appDir);

    try {
        await waitForLog(server, /ready|local:/i, "Next dev server", 30_000);
        await waitForHttp(`http://127.0.0.1:${port}`, 15_000);
        await waitForLog(worker, /Validation queue worker started/i, "Queue worker", 30_000);

        const admin = createClient(supabaseUrl, secretKey);
        const email = `queue-verify-${Date.now()}@example.com`;
        const password = "QueueVerify123";

        const { data: createdUser, error: createUserError } = await admin.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
        });
        if (createUserError || !createdUser.user) {
            throw createUserError || new Error("Could not create verification user.");
        }

        const userId = createdUser.user.id;
        const { error: profileError } = await admin
            .from("profiles")
            .upsert({
                id: userId,
                email,
                full_name: "Queue Verify",
                plan: "pro",
            }, { onConflict: "id" });

        if (profileError) {
            throw profileError;
        }

        const jar: Array<{ name: string; value: string; options?: unknown }> = [];
        const browser = createBrowserClient(supabaseUrl, publishableKey, {
            isSingleton: false,
            cookies: {
                getAll() {
                    return jar;
                },
                setAll(cookies) {
                    for (const cookie of cookies) {
                        const index = jar.findIndex((entry) => entry.name === cookie.name);
                        if (index >= 0) jar[index] = cookie;
                        else jar.push(cookie);
                    }
                },
            },
        });

        const { error: signInError } = await browser.auth.signInWithPassword({ email, password });
        if (signInError) {
            throw signInError;
        }

        const cookieHeader = jar.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
        const baseUrl = `http://127.0.0.1:${port}`;

        const validateResp = await fetch(`${baseUrl}/api/validate`, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                cookie: cookieHeader,
            },
            body: JSON.stringify({
                idea: "AI workflow assistant for small accounting firms handling email overload",
            }),
        });

        const validateJson = await validateResp.json();
        if (!validateResp.ok) {
            throw new Error(`Validate POST failed (${validateResp.status}): ${JSON.stringify(validateJson)}`);
        }

        const jobId = validateJson.job_id || validateJson.validationId;
        if (!jobId) {
            throw new Error(`Validate POST did not return a job id: ${JSON.stringify(validateJson)}`);
        }

        const statusTrail: string[] = [];
        let finalStatusPayload: any = null;
        const startedAt = Date.now();

        while (Date.now() - startedAt < 180_000) {
            const statusResp = await fetch(`${baseUrl}/api/validate/${jobId}/status`, {
                headers: { cookie: cookieHeader },
            });
            const statusJson = await statusResp.json();
            if (!statusResp.ok) {
                throw new Error(`Status GET failed (${statusResp.status}): ${JSON.stringify(statusJson)}`);
            }

            const currentStatus = String(statusJson.validation?.status || "unknown");
            if (statusTrail[statusTrail.length - 1] !== currentStatus) {
                statusTrail.push(currentStatus);
            }

            finalStatusPayload = statusJson;
            if (["done", "error", "failed"].includes(currentStatus)) {
                break;
            }

            await sleep(3000);
        }

        const { data: validationRow, error: validationError } = await admin
            .from("idea_validations")
            .select("*")
            .eq("id", jobId)
            .single();

        if (validationError) {
            throw validationError;
        }

        console.log(JSON.stringify({
            ok: true,
            email,
            jobId,
            statusTrail,
            finalValidationStatus: finalStatusPayload?.validation?.status || null,
            finalQueueState: finalStatusPayload?.queue?.state || null,
            diagnostics: finalStatusPayload?.diagnostics || null,
            validationRowStatus: validationRow?.status || null,
            workerStdout: worker.getStdout(),
            workerStderr: worker.getStderr(),
        }, null, 2));
    } catch (error) {
        console.error(JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
            serverExitCode: server.child.exitCode,
            workerExitCode: worker.child.exitCode,
            serverStdout: server.getStdout(),
            serverStderr: server.getStderr(),
            workerStdout: worker.getStdout(),
            workerStderr: worker.getStderr(),
        }, null, 2));
        process.exitCode = 1;
    } finally {
        stopProcess(worker.child);
        stopProcess(server.child);
    }
}

main();
