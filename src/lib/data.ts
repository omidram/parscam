export type CameraStatus = "online" | "offline" | "recording";

export type Camera = {
  id: number;
  name: string;
  location: string;
  status: CameraStatus;
  signal: number;
};

export type AlertSeverity = "critical" | "high" | "medium" | "info";

export type Alert = {
  id: number;
  title: string;
  location: string;
  severity: AlertSeverity;
  minutesAgo: number;
};

export type Kpi = {
  id: string;
  label: string;
  value: string;
  hint: string;
  trend?: string;
  tone: "success" | "info" | "warning" | "danger";
};

export const brand = {
  nameFa: "پارس کم",
  nameEn: "Pars Cam",
  tagline: "سامانه بومی نظارت تصویری",
  claim: "محصول کاملاً ایرانی و بومی",
  company: "نسل فردا",
  phone: "۰۹۳۷۲۱۰۴۴۴۴",
  email: "info@iotcityhub.ir",
};

export const cameras: Camera[] = [
  {
    id: 1,
    name: "ورودی اصلی — دروازه ۱",
    location: "لابی ساختمان",
    status: "online",
    signal: 96,
  },
  {
    id: 2,
    name: "حیاط جنوبی — دوربین آنالوگ",
    location: "محوطه بیرونی",
    status: "recording",
    signal: 88,
  },
  {
    id: 3,
    name: "انبار بارگیری",
    location: "سکو ۲",
    status: "online",
    signal: 91,
  },
  {
    id: 4,
    name: "دوربین IP — نمونه ۲",
    location: "راهرو اداری",
    status: "online",
    signal: 84,
  },
];

export const alerts: Alert[] = [
  {
    id: 1,
    title: "دسترسی غیرمجاز",
    location: "ورودی اصلی — دروازه",
    severity: "critical",
    minutesAgo: 2,
  },
  {
    id: 2,
    title: "تشخیص حضور طولانی",
    location: "انبار بارگیری",
    severity: "high",
    minutesAgo: 10,
  },
  {
    id: 3,
    title: "تشخیص بسته مشکوک",
    location: "پیشخوان پذیرش",
    severity: "info",
    minutesAgo: 15,
  },
  {
    id: 4,
    title: "آلارم دستی",
    location: "دوربین آنالوگ ۱ — ورودی",
    severity: "medium",
    minutesAgo: 45,
  },
];

export const kpis: Kpi[] = [
  {
    id: "uptime",
    label: "دوربین‌های آنلاین",
    value: "۴۸ / ۵۰",
    hint: "آپتایم ۹۶٪ · همگام‌سازی ۱۴:۲۲",
    tone: "success",
  },
  {
    id: "incidents",
    label: "رویداد امروز",
    value: "۲۳",
    hint: "۵ مورد کمتر از دیروز",
    trend: "down",
    tone: "info",
  },
  {
    id: "alerts",
    label: "هشدارهای فعال",
    value: "۱۲",
    hint: "۱ مورد بیشتر از دیروز",
    trend: "up",
    tone: "warning",
  },
  {
    id: "critical",
    label: "هشدارهای بحرانی",
    value: "۴",
    hint: "۲ مورد بیشتر از دیروز",
    trend: "up",
    tone: "danger",
  },
];

export const weeklyIncidents = [
  { day: "شنبه", value: 4 },
  { day: "یکشنبه", value: 6 },
  { day: "دوشنبه", value: 3 },
  { day: "سه‌شنبه", value: 8 },
  { day: "چهارشنبه", value: 2 },
  { day: "پنجشنبه", value: 5 },
  { day: "جمعه", value: 3 },
];

export const recordings = [
  {
    id: 1,
    camera: "ورودی اصلی — دروازه ۱",
    date: "۱۴۰۴/۰۶/۳۰",
    duration: "۰۲:۱۴:۲۰",
    size: "۱٫۲ گیگابایت",
  },
  {
    id: 2,
    camera: "حیاط جنوبی",
    date: "۱۴۰۴/۰۶/۲۹",
    duration: "۰۰:۴۵:۱۲",
    size: "۴۲۰ مگابایت",
  },
  {
    id: 3,
    camera: "انبار بارگیری",
    date: "۱۴۰۴/۰۶/۲۸",
    duration: "۰۱:۰۸:۰۵",
    size: "۶۸۰ مگابایت",
  },
];

export const navItems = [
  { href: "/dashboard", label: "داشبورد", icon: "home" as const },
  { href: "/monitor", label: "نظارت زنده", icon: "monitor" as const },
  { href: "/alarms", label: "هشدارها", icon: "bell" as const },
  { href: "/recordings", label: "ضبط‌ها", icon: "archive" as const },
  { href: "/scanner", label: "جست‌وجوی دستگاه", icon: "scan" as const },
  { href: "/settings", label: "تنظیمات", icon: "settings" as const },
];
