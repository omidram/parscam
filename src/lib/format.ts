const persianDigits = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];

export function toPersianDigits(value: string | number): string {
  return String(value).replace(/\d/g, (d) => persianDigits[Number(d)]);
}

export function formatPersianNumber(value: number): string {
  return toPersianDigits(value.toLocaleString("en-US"));
}

export function formatJalaliDate(date: Date = new Date()): string {
  return new Intl.DateTimeFormat("fa-IR", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

export function formatJalaliDateTime(date: Date = new Date()): string {
  const day = new Intl.DateTimeFormat("fa-IR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
  const time = toPersianDigits(date.toTimeString().slice(0, 8));
  return `${day} | ${time}`;
}

export function formatRelativeFa(minutesAgo: number): string {
  if (minutesAgo < 1) return "همین الان";
  if (minutesAgo < 60) return `${toPersianDigits(minutesAgo)} دقیقه پیش`;
  const hours = Math.floor(minutesAgo / 60);
  if (hours < 24) return `${toPersianDigits(hours)} ساعت پیش`;
  const days = Math.floor(hours / 24);
  return `${toPersianDigits(days)} روز پیش`;
}
