"use client";

import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Zap, Compass, TrendingUp, Search } from "lucide-react";

export default function DashboardPage() {
  const router = useRouter();

  const actions = [
    { icon: Zap, title: "Validate", desc: "Run AI-powered idea validation", to: "/dashboard/validate" },
    { icon: Compass, title: "Explore", desc: "Browse community-validated ideas", to: "/dashboard/explore" },
    { icon: TrendingUp, title: "Trends", desc: "Track market momentum", to: "/dashboard/trends" },
    { icon: Search, title: "Scans", desc: "Deep-scan keywords", to: "/dashboard/scans" },
  ];

  return (
    <div className="max-w-4xl mx-auto pt-12">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-12">
        <h1 className="font-display text-5xl font-extrabold tracking-tight-custom mb-3">
          <span className="text-foreground">Command </span>
          <span className="text-primary">Center</span>
        </h1>
        <p className="text-muted-foreground text-sm font-mono">Select a module to begin</p>
      </motion.div>

      <div className="grid grid-cols-2 gap-3">
        {actions.map((a, i) => (
          <motion.div
            key={a.title}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08 }}
            whileHover={{ y: -3, scale: 1.01 }}
            onClick={() => router.push(a.to)}
            className="bento-cell rounded-[14px] p-6 cursor-pointer flex items-start gap-4"
          >
            <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: "hsl(var(--orange-dim))", border: "1px solid hsl(16 100% 50% / 0.2)" }}
            >
              <a.icon className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h3 className="font-display text-lg font-bold">{a.title}</h3>
              <p className="text-xs text-muted-foreground font-mono mt-1">{a.desc}</p>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
