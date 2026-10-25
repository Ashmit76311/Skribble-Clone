interface AvatarProps {
  name?: string;
  seed?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const PALETTE = [
  "#5b52f9", // indigo
  "#0369a1", // sky-700
  "#047857", // emerald-700
  "#b45309", // amber-700
  "#b91c1c", // red-700
  "#6d28d9", // violet-700
  "#be185d", // pink-700
  "#0f766e", // teal-700
  "#c2410c", // orange-700
  "#1d4ed8", // blue-700
  "#4338ca", // indigo-700
  "#0e7490", // cyan-700
];

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function getInitials(name?: string): string {
  if (!name || !name.trim()) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.trim().slice(0, 2).toUpperCase();
}

export default function Avatar({ name = "", seed, size, className = "" }: AvatarProps) {
  const isEmpty = !name || !name.trim();
  const identifier = seed || name || "player";
  const hash = hashString(identifier);
  const bgColor = isEmpty ? "var(--bg-tertiary)" : PALETTE[hash % PALETTE.length];
  const textColor = isEmpty ? "var(--text-muted)" : "#ffffff";
  const initials = getInitials(name);

  const sizeClass = size === "sm" ? "avatar-sm" : size === "lg" ? "avatar-lg" : "";

  return (
    <div
      className={`avatar ${sizeClass} ${isEmpty ? "avatar-empty" : ""} ${className}`.trim()}
      style={{ backgroundColor: bgColor, color: textColor }}
      title={name || "Unnamed"}
      aria-label={`Avatar for ${name || "unnamed"}`}
    >
      <span>{initials}</span>
    </div>
  );
}
