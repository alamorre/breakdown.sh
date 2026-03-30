/** Google product SVG icons for data source nodes */

interface IconProps {
  className?: string;
}

export function GoogleDocsIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 64 88" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Document body */}
      <path
        d="M4 8C4 3.58 7.58 0 12 0H40L60 20V80C60 84.42 56.42 88 52 88H12C7.58 88 4 84.42 4 80V8Z"
        fill="#4285F4"
      />
      {/* Folded corner */}
      <path d="M40 0L60 20H48C43.58 20 40 16.42 40 12V0Z" fill="#A1C2FA" />
      {/* Text lines */}
      <rect x="16" y="36" width="28" height="3" rx="1.5" fill="white" fillOpacity="0.9" />
      <rect x="16" y="46" width="28" height="3" rx="1.5" fill="white" fillOpacity="0.9" />
      <rect x="16" y="56" width="28" height="3" rx="1.5" fill="white" fillOpacity="0.9" />
      <rect x="16" y="66" width="18" height="3" rx="1.5" fill="white" fillOpacity="0.9" />
    </svg>
  );
}

export function GoogleSheetsIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 64 88" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Document body */}
      <path
        d="M4 8C4 3.58 7.58 0 12 0H40L60 20V80C60 84.42 56.42 88 52 88H12C7.58 88 4 84.42 4 80V8Z"
        fill="#34A853"
      />
      {/* Folded corner */}
      <path d="M40 0L60 20H48C43.58 20 40 16.42 40 12V0Z" fill="#82C4A0" />
      {/* Grid */}
      <rect x="14" y="34" width="32" height="36" rx="2" fill="white" fillOpacity="0.9" />
      {/* Horizontal grid lines */}
      <line x1="14" y1="46" x2="46" y2="46" stroke="#34A853" strokeWidth="1.5" />
      <line x1="14" y1="58" x2="46" y2="58" stroke="#34A853" strokeWidth="1.5" />
      {/* Vertical grid line */}
      <line x1="28" y1="34" x2="28" y2="70" stroke="#34A853" strokeWidth="1.5" />
    </svg>
  );
}
