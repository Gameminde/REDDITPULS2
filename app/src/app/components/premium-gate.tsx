"use client";

import React from "react";
import { motion } from "framer-motion";
import { Lock, ArrowRight, Sparkles } from "lucide-react";

import { PRICING } from "@/lib/pricing-plans";

export function PremiumGate({
    feature,
    children,
    isPremium = false,
}: {
    feature: string;
    children?: React.ReactNode;
    isPremium?: boolean;
}) {
    if (isPremium) return <>{children}</>;

    return (
        <div className="premium-gate">
            <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 200, damping: 20 }}
                style={{
                    maxWidth: 420,
                    textAlign: "center",
                }}
            >
                <motion.div
                    style={{
                        width: 64,
                        height: 64,
                        borderRadius: 16,
                        background: "rgba(249,115,22,0.1)",
                        border: "1px solid rgba(249,115,22,0.2)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        margin: "0 auto 24px",
                    }}
                    animate={{
                        boxShadow: [
                            "0 0 20px rgba(249,115,22,0.1)",
                            "0 0 40px rgba(249,115,22,0.25)",
                            "0 0 20px rgba(249,115,22,0.1)",
                        ],
                    }}
                    transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                >
                    <Lock style={{ width: 24, height: 24, color: "#f97316" }} />
                </motion.div>

                <h2
                    style={{
                        fontSize: 22,
                        fontWeight: 700,
                        color: "#f1f5f9",
                        fontFamily: "var(--font-display)",
                        marginBottom: 8,
                    }}
                >
                    {feature}
                </h2>

                <p
                    style={{
                        fontSize: 14,
                        color: "#64748b",
                        marginBottom: 32,
                        lineHeight: 1.6,
                    }}
                >
                    This is a paid feature. Start a {PRICING.trialDays}-day free trial, then choose Starter at ${PRICING.starter.priceMonthly}/mo or Pro at ${PRICING.pro.priceMonthly}/mo.
                </p>

                <motion.div
                    className="animated-gradient-border"
                    style={{ borderRadius: 12, display: "inline-block" }}
                >
                    <a
                        href="/dashboard/pricing"
                        className="btn-primary"
                        style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 8,
                            textDecoration: "none",
                            padding: "14px 32px",
                        }}
                    >
                        <Sparkles style={{ width: 16, height: 16 }} />
                        Start {PRICING.trialDays}-day free trial
                        <ArrowRight style={{ width: 16, height: 16 }} />
                    </a>
                </motion.div>

                <p style={{ fontSize: 11, color: "#475569", marginTop: 16 }}>
                    Then ${PRICING.starter.priceMonthly}/mo Starter or ${PRICING.pro.priceMonthly}/mo Pro · Secure via Stripe
                </p>
            </motion.div>
        </div>
    );
}

