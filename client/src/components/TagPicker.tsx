import { useState } from "react";
import { useTags } from "@/hooks/use-tags";
import { useAuth } from "@/hooks/use-auth";
import { TagBadge } from "@/components/TagBadge";
import { TagManager } from "@/components/TagManager";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ChevronsUpDown, Tags } from "lucide-react";
import { TAG_LIMITS, type UserTier } from "@shared/models/auth";

interface TagPickerProps {
  selectedTagIds: number[];
  onChange: (ids: number[]) => void;
  maxTags?: number;
  disabled?: boolean;
}

export function TagPicker({ selectedTagIds, onChange, maxTags, disabled }: TagPickerProps) {
  const [open, setOpen] = useState(false);
  const { data: allTags, isLoading: isTagsLoading } = useTags();
  const { user } = useAuth();

  const tags = allTags ?? [];
  const selectedTags = tags.filter(t => selectedTagIds.includes(t.id));
  const userTier = (user?.tier || "free") as UserTier;
  const tagLimit = TAG_LIMITS[userTier] ?? TAG_LIMITS.free;

  const toggleTag = (tagId: number) => {
    if (selectedTagIds.includes(tagId)) {
      onChange(selectedTagIds.filter(id => id !== tagId));
    } else {
      if (maxTags && selectedTagIds.length >= maxTags) return;
      onChange([...selectedTagIds, tagId]);
    }
  };

  if (!isTagsLoading && tags.length === 0) {
    if (tagLimit > 0) {
      return (
        <TagManager
          trigger={
            <Button variant="outline" size="sm" className="h-8 text-xs" disabled={disabled}>
              <Tags className="h-3.5 w-3.5 mr-1" />
              Create tags
            </Button>
          }
        />
      );
    }
    return null;
  }

  return (
    <div className="space-y-2">
      {selectedTags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selectedTags.map((tag) => (
            <TagBadge
              key={tag.id}
              tag={tag}
              onRemove={() => onChange(selectedTagIds.filter(id => id !== tag.id))}
            />
          ))}
        </div>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            disabled={disabled}
          >
            <Tags className="h-3.5 w-3.5 mr-1" />
            {selectedTags.length === 0 ? "Add tags" : "Edit tags"}
            <ChevronsUpDown className="h-3 w-3 ml-1 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-2" align="start">
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {tags.map((tag) => {
              const isSelected = selectedTagIds.includes(tag.id);
              const isDisabled = !isSelected && maxTags !== undefined && selectedTagIds.length >= maxTags;
              return (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => !isDisabled && toggleTag(tag.id)}
                  className={`flex items-center gap-2 w-full rounded-sm px-2 py-1.5 text-sm hover:bg-accent transition-colors ${isDisabled ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  <Checkbox checked={isSelected} className="pointer-events-none" />
                  <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: tag.colour }} />
                  <span className="truncate">{tag.name}</span>
                </button>
              );
            })}
          </div>
          <div className="border-t mt-2 pt-2">
            <TagManager
              trigger={
                <button type="button" className="text-xs text-muted-foreground hover:text-foreground w-full text-left px-2 py-1">
                  Manage tags...
                </button>
              }
            />
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
