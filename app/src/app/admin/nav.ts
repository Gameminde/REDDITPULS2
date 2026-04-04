import {
    Activity,
    BarChart3,
    Bot,
    FileClock,
    LayoutDashboard,
    Logs,
    Settings,
    Shield,
    Users,
    Waypoints,
} from "lucide-react";

export const ADMIN_NAV = [
    { title: "Overview", href: "/admin", icon: LayoutDashboard },
    { title: "Analytics", href: "/admin/analytics", icon: BarChart3 },
    { title: "Validations", href: "/admin/validations", icon: Shield },
    { title: "Jobs", href: "/admin/jobs", icon: Activity },
    { title: "Users", href: "/admin/users", icon: Users },
    { title: "AI", href: "/admin/ai", icon: Bot },
    { title: "Market", href: "/admin/market", icon: Waypoints },
    { title: "Logs", href: "/admin/logs", icon: Logs },
    { title: "Settings", href: "/admin/settings", icon: FileClock },
];
