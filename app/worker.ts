import fs from "node:fs";
import path from "node:path";

function loadLocalEnv() {
    const candidates = [
        path.resolve(process.cwd(), ".env.local"),
        path.resolve(process.cwd(), "..", ".env"),
    ];

    for (const file of candidates) {
        if (!fs.existsSync(file)) continue;
        try {
            process.loadEnvFile(file);
        } catch (error) {
            console.warn(`[Worker] Failed to load env file ${file}:`, error);
        }
    }
}

async function main() {
    loadLocalEnv();
    const { startValidationWorker, stopQueue } = await import("./src/lib/queue");
    const { workerId } = await startValidationWorker();
    console.log(`[Worker] Validation queue worker started (${workerId})`);

    const shutdown = async (signal: string) => {
        console.log(`[Worker] Received ${signal}. Shutting down queue worker...`);
        await stopQueue();
        process.exit(0);
    };

    process.on("SIGINT", () => {
        void shutdown("SIGINT");
    });

    process.on("SIGTERM", () => {
        void shutdown("SIGTERM");
    });
}

main().catch((error) => {
    console.error("[Worker] Failed to start validation queue worker:", error);
    process.exit(1);
});
