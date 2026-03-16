"use client";

import React, { useEffect, useRef } from "react";
import { motion, useMotionValue, useTransform, animate, useInView, AnimatePresence } from "framer-motion";

/* ═══════════════════════════════════════════
   ANIMATION VARIANTS
   ═══════════════════════════════════════════ */
export const staggerContainer = {
    hidden: { opacity: 0 },
    visible: {
        opacity: 1,
        transition: { staggerChildren: 0.06, delayChildren: 0.1 },
    },
};

export const staggerItem = {
    hidden: { opacity: 0, y: 20, scale: 0.97 },
    visible: {
        opacity: 1, y: 0, scale: 1,
        transition: { type: "spring" as const, stiffness: 260, damping: 24 },
    },
};

export const fadeInUp = {
    hidden: { opacity: 0, y: 16 },
    visible: {
        opacity: 1, y: 0,
        transition: { duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] },
    },
};

/* ═══════════════════════════════════════════
   STAGGER CONTAINER
   ═══════════════════════════════════════════ */
export function StaggerContainer({
    children, className, delay = 0, style,
}: { children: React.ReactNode; className?: string; delay?: number; style?: React.CSSProperties }) {
    return (
        <motion.div
            variants={{
                hidden: { opacity: 0 },
                visible: { opacity: 1, transition: { staggerChildren: 0.06, delayChildren: delay } },
            }}
            initial="hidden"
            animate="visible"
            className={className}
            style={style}
        >
            {children}
        </motion.div>
    );
}

/* ═══════════════════════════════════════════
   STAGGER ITEM
   ═══════════════════════════════════════════ */
export function StaggerItem({ children, className, style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
    return <motion.div variants={staggerItem} className={className} style={style}>{children}</motion.div>;
}

/* ═══════════════════════════════════════════
   VIEWPORT REVEAL
   ═══════════════════════════════════════════ */
export function ViewportReveal({
    children, className, delay = 0,
}: { children: React.ReactNode; className?: string; delay?: number }) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.6, delay, ease: [0.25, 0.46, 0.45, 0.94] }}
            className={className}
        >
            {children}
        </motion.div>
    );
}

/* ═══════════════════════════════════════════
   ANIMATED COUNTER
   ═══════════════════════════════════════════ */
export function AnimatedCounter({
    value, duration = 1.5, className, prefix = "", suffix = "",
}: { value: number; duration?: number; className?: string; prefix?: string; suffix?: string }) {
    const ref = useRef<HTMLSpanElement>(null);
    const motionVal = useMotionValue(0);
    const rounded = useTransform(motionVal, (v) => Math.round(v));
    const isInView = useInView(ref, { once: true });

    useEffect(() => {
        if (isInView) {
            animate(motionVal, value, { duration, ease: [0.25, 0.46, 0.45, 0.94] });
        }
    }, [isInView, value, duration, motionVal]);

    useEffect(() => {
        const unsub = rounded.on("change", (v) => {
            if (ref.current) ref.current.textContent = `${prefix}${v.toLocaleString()}${suffix}`;
        });
        return unsub;
    }, [rounded, prefix, suffix]);

    return (
        <motion.span ref={ref} className={className}
            initial={{ opacity: 0, y: 8 }}
            animate={isInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.4 }}
        >
            {prefix}0{suffix}
        </motion.span>
    );
}

/* ═══════════════════════════════════════════
   GLASS CARD
   ═══════════════════════════════════════════ */
export function GlassCard({
    children, className = "", hover = true, glow, ...props
}: {
    children: React.ReactNode; className?: string; hover?: boolean;
    glow?: "orange" | "emerald" | "red";
} & React.HTMLAttributes<HTMLDivElement>) {
    const glowClass = glow === "orange" ? "glow-orange-sm" : glow === "emerald" ? "glow-emerald-sm" : glow === "red" ? "glow-red-sm" : "";

    return (
        <motion.div
            className={`glass-card ${hover ? "card-hover-lift" : ""} ${glowClass} ${className}`}
            whileHover={hover ? { scale: 1.01 } : undefined}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            {...(props as Record<string, unknown>)}
        >
            {children}
        </motion.div>
    );
}

/* ═══════════════════════════════════════════
   GLOW BADGE
   ═══════════════════════════════════════════ */
export function GlowBadge({
    children, color = "orange", className = "",
}: { children: React.ReactNode; color?: "orange" | "emerald" | "red" | "amber"; className?: string }) {
    const colors: Record<string, string> = {
        orange: "background: rgba(249,115,22,0.1); color: #f97316; border-color: rgba(249,115,22,0.2); box-shadow: 0 0 12px rgba(249,115,22,0.2)",
        emerald: "background: rgba(16,185,129,0.1); color: #10b981; border-color: rgba(16,185,129,0.2); box-shadow: 0 0 12px rgba(16,185,129,0.2)",
        red: "background: rgba(239,68,68,0.1); color: #ef4444; border-color: rgba(239,68,68,0.2); box-shadow: 0 0 12px rgba(239,68,68,0.2)",
        amber: "background: rgba(245,158,11,0.1); color: #f59e0b; border-color: rgba(245,158,11,0.2); box-shadow: 0 0 12px rgba(245,158,11,0.2)",
    };

    const colorStyles = {
        orange: { background: "rgba(249,115,22,0.1)", color: "#f97316", borderColor: "rgba(249,115,22,0.2)", boxShadow: "0 0 12px rgba(249,115,22,0.2)" },
        emerald: { background: "rgba(16,185,129,0.1)", color: "#10b981", borderColor: "rgba(16,185,129,0.2)", boxShadow: "0 0 12px rgba(16,185,129,0.2)" },
        red: { background: "rgba(239,68,68,0.1)", color: "#ef4444", borderColor: "rgba(239,68,68,0.2)", boxShadow: "0 0 12px rgba(239,68,68,0.2)" },
        amber: { background: "rgba(245,158,11,0.1)", color: "#f59e0b", borderColor: "rgba(245,158,11,0.2)", boxShadow: "0 0 12px rgba(245,158,11,0.2)" },
    };

    return (
        <motion.span
            style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em",
                padding: "2px 8px", borderRadius: 6, border: "1px solid",
                ...colorStyles[color],
            }}
            className={className}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: "spring", stiffness: 400, damping: 25 }}
        >
            {children}
        </motion.span>
    );
}

/* ═══════════════════════════════════════════
   ANIMATED SPARKLINE (SVG)
   ═══════════════════════════════════════════ */
export function AnimatedSparkline({
    data, color = "#f97316", width = 80, height = 24, className,
}: { data: number[]; color?: string; width?: number; height?: number; className?: string }) {
    const max = Math.max(...data);
    const min = Math.min(...data);
    const range = max - min || 1;
    const step = width / (data.length - 1);

    const points = data
        .map((v, i) => `${i * step},${height - ((v - min) / range) * (height - 2) - 1}`)
        .join(" ");

    const lineLength = data.reduce((len, _, i) => {
        if (i === 0) return 0;
        const x1 = (i - 1) * step;
        const y1 = height - ((data[i - 1] - min) / range) * (height - 2) - 1;
        const x2 = i * step;
        const y2 = height - ((data[i] - min) / range) * (height - 2) - 1;
        return len + Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
    }, 0);

    return (
        <svg width={width} height={height} className={className}>
            <polyline
                fill="none" stroke={color} strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round"
                points={points} className="draw-on-line"
                style={{ "--line-length": lineLength } as React.CSSProperties}
            />
        </svg>
    );
}

/* ═══════════════════════════════════════════
   FLOATING DOTS (hero background)
   ═══════════════════════════════════════════ */
export function FloatingDots({ count = 20, className }: { count?: number; className?: string }) {
    const dots = Array.from({ length: count }, (_, i) => ({
        id: i,
        x: Math.random() * 100,
        y: Math.random() * 100,
        size: Math.random() * 3 + 1,
        delay: Math.random() * 5,
        duration: Math.random() * 4 + 3,
    }));

    return (
        <div className={`absolute inset-0 overflow-hidden pointer-events-none ${className || ""}`}>
            {dots.map((dot) => (
                <motion.div
                    key={dot.id}
                    className="absolute rounded-full"
                    style={{
                        left: `${dot.x}%`, top: `${dot.y}%`,
                        width: dot.size, height: dot.size,
                        background: "rgba(249,115,22,0.2)",
                    }}
                    animate={{ y: [-10, 10, -10], opacity: [0.2, 0.6, 0.2] }}
                    transition={{ duration: dot.duration, delay: dot.delay, repeat: Infinity, ease: "easeInOut" }}
                />
            ))}
        </div>
    );
}
