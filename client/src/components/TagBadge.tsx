import { X } from "lucide-react";

interface TagBadgeProps {
  tag: { id: number; name: string; colour: string };
  onRemove?: () => void;
}

export function TagBadge({ tag, onRemove }: TagBadgeProps) {
  const displayName = tag.name.length > 20 ? tag.name.slice(0, 20) + "..." : tag.name;
  const needsTooltip = tag.name.length > 20;

  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-border/50 bg-secondary/50 px-2 py-0.5 text-xs font-medium"
      title={needsTooltip ? tag.name : undefined}
    >
      <span
        className="h-2 w-2 rounded-full shrink-0"
        style={{ backgroundColor: tag.colour }}
      />
      <span className="truncate">{displayName}</span>
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove tag ${tag.name}`}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRemove();
          }}
          className="ml-0.5 rounded-full p-0.5 hover:bg-muted transition-colors"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}
