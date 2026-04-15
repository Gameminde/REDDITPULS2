import test from "node:test";
import assert from "node:assert/strict";

import { classifyOpenAi429, detectProvider } from "@/lib/ai-key-verification";

test("provider detection still resolves modern OpenAI and Gemini key prefixes", () => {
    assert.equal(detectProvider("sk-proj-example-1234567890abcdefghijklmnop"), "openai");
    assert.equal(detectProvider("AIzaSyExampleKey123456789"), "gemini");
});

test("openai 429 classification distinguishes billing from generic quota exhaustion", () => {
    assert.equal(
        classifyOpenAi429(JSON.stringify({ error: { code: "billing_not_active", message: "Billing inactive" } })),
        "billing_inactive",
    );
    assert.equal(
        classifyOpenAi429(JSON.stringify({ error: { code: "insufficient_quota", message: "Quota exceeded" } })),
        "quota_exceeded",
    );
});
