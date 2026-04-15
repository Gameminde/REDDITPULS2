import test from "node:test";
import assert from "node:assert/strict";

import {
    buildValidationHealthMessage,
    getAiStatusLabel,
    getAiStatusTone,
    summarizeAiIssue,
    type AiConfigHealth,
} from "@/lib/ai-config-health";

test("status labels and tones expose actionable provider health states", () => {
    assert.equal(getAiStatusLabel("valid"), "Ready");
    assert.equal(getAiStatusLabel("billing_inactive"), "Billing off");
    assert.equal(getAiStatusTone("invalid"), "error");
    assert.equal(getAiStatusTone("quota_exceeded"), "warning");
});

test("validation health message combines provider-specific blockers", () => {
    const message = buildValidationHealthMessage([
        {
            config_id: "1",
            provider: "openai",
            selected_model: "gpt-5.4",
            priority: 1,
            status: "billing_inactive",
            message: "OpenAI key is valid but billing is not active - enable billing or add credits",
        },
        {
            config_id: "2",
            provider: "gemini",
            selected_model: "gemini-2.5-flash",
            priority: 2,
            status: "quota_exceeded",
            message: "Gemini key is valid but quota or credits are exhausted - free-tier quota is exhausted",
        },
    ] satisfies AiConfigHealth[]);

    assert.match(message || "", /OpenAI: billing inactive/);
    assert.match(message || "", /Gemini: quota exhausted/);
});

test("issue summary falls back to the raw message for unknown transport errors", () => {
    assert.equal(
        summarizeAiIssue({ status: "error", message: "Gemini API timed out - the key could still be valid" }),
        "Gemini API timed out - the key could still be valid",
    );
});
