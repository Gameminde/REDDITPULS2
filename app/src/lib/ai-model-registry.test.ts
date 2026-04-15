import test from "node:test";
import assert from "node:assert/strict";
import {
    getDefaultModel,
    getProviderModelEntry,
    getVerificationModel,
    resolveRegisteredModel,
} from "@/lib/ai-model-registry";

test("registry resolves legacy aliases to current runtime ids", () => {
    assert.equal(resolveRegisteredModel("gpt-5.3"), "gpt-5.4");
    assert.equal(resolveRegisteredModel("gemini-3.1-pro"), "gemini-3.1-pro-preview");
    assert.equal(resolveRegisteredModel("claude-sonnet-4"), "claude-sonnet-4-20250514");
    assert.equal(resolveRegisteredModel("claude-opus-4-5"), "claude-opus-4-5-20251101");
    assert.equal(resolveRegisteredModel("hunter-alpha"), "deepseek/deepseek-r1");
});

test("registry exposes current provider defaults", () => {
    assert.equal(getDefaultModel("openai"), "gpt-5.4");
    assert.equal(getDefaultModel("anthropic"), "claude-sonnet-4-6");
    assert.equal(getDefaultModel("gemini"), "gemini-3.1-pro-preview");
});

test("registry returns provider entries and verification models", () => {
    const geminiEntry = getProviderModelEntry("gemini", "gemini-3.1-pro");
    assert.ok(geminiEntry);
    assert.equal(geminiEntry?.runtime_model_id, "gemini-3.1-pro-preview");
    assert.equal(getVerificationModel("openrouter", "hunter-alpha"), "deepseek/deepseek-r1");
});
