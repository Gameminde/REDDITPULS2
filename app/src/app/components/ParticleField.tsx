"use client";

import React, { useMemo } from "react";

export function ParticleField() {
    const particles = useMemo(() => {
        return Array.from({ length: 80 }).map((_, i) => ({
            id: i,
            x: Math.random() * 100,
            y: Math.random() * 100,
            size: 2 + Math.random() * 3, // 2-5px
            opacity: 0.15 + Math.random() * 0.3, // 0.15-0.45
            delay: Math.random() * 5,
            duration: 15 + Math.random() * 5,
            xMove: (Math.random() > 0.5 ? 1 : -1) * (3 + Math.random() * 4), // ±3-7px
            yMove: (Math.random() > 0.5 ? 1 : -1) * (3 + Math.random() * 4)
        }));
    }, []);

    return (
        <>
            <style dangerouslySetInnerHTML={{__html: `
                @keyframes particleDrift {
                    0%, 100% { transform: translate(0, 0); }
                    33% { transform: translate(var(--xMove), var(--yMove)); }
                    66% { transform: translate(calc(var(--xMove) * -0.5), calc(var(--yMove) * 1.5)); }
                }
                .particle-element {
                    animation: particleDrift var(--duration) ease-in-out infinite;
                }
            `}} />
            <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden bg-[#0A0A0A]">
                {particles.map((p) => (
                    <div
                        key={p.id}
                        className="absolute particle-element"
                        style={{
                            left: `${p.x}%`,
                            top: `${p.y}%`,
                            width: `${p.size}px`,
                            height: `${p.size}px`,
                            backgroundColor: "hsl(40 60% 40%)", // amber/gold
                            opacity: p.opacity,
                            // @ts-ignore
                            "--duration": `${p.duration}s`,
                            "--xMove": `${p.xMove}px`,
                            "--yMove": `${p.yMove}px`,
                            animationDelay: `${p.delay}s`
                        }}
                    />
                ))}
            </div>
        </>
    );
}
