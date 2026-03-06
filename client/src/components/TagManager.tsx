import { useState } from "react";
import { useTags, useCreateTag, useUpdateTag, useDeleteTag } from "@/hooks/use-tags";
import { useAuth } from "@/hooks/use-auth";
import { TAG_LIMITS, type UserTier } from "@shared/models/auth";
import { PRESET_COLOURS } from "@shared/routes";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tags, Pencil, Trash2, Loader2, Plus } from "lucide-react";

interface TagManagerProps {
  trigger?: React.ReactNode;
}

export function TagManager({ trigger }: TagManagerProps) {
  const [open, setOpen] = useState(false);
  const { user } = useAuth();
  const { data: userTags = [] } = useTags();
  const { mutate: createTag, isPending: isCreating } = useCreateTag();
  const { mutate: updateTag } = useUpdateTag();
  const { mutate: deleteTag } = useDeleteTag();

  const [newName, setNewName] = useState("");
  const [newColour, setNewColour] = useState<string>(PRESET_COLOURS[0]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editColour, setEditColour] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const tier = ((user as any)?.tier || "free") as UserTier;
  const limit = TAG_LIMITS[tier] ?? TAG_LIMITS.free;
  const atLimit = userTags.length >= limit;
  const isFree = tier === "free";

  const handleCreate = () => {
    if (!newName.trim()) return;
    createTag({ name: newName.trim(), colour: newColour }, {
      onSuccess: () => {
        setNewName("");
        setNewColour(PRESET_COLOURS[0]);
      },
    });
  };

  const handleUpdate = (id: number) => {
    updateTag({ id, name: editName.trim() || undefined, colour: editColour || undefined }, {
      onSuccess: () => setEditingId(null),
    });
  };

  const handleDelete = (id: number) => {
    deleteTag(id, {
      onSuccess: () => setConfirmDeleteId(null),
    });
  };

  const startEdit = (tag: { id: number; name: string; colour: string }) => {
    setEditingId(tag.id);
    setEditName(tag.name);
    setEditColour(tag.colour);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm">
            <Tags className="h-4 w-4 mr-1" />
            Manage tags
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Manage Tags</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 max-h-[60vh] overflow-y-auto">
          {/* Tag list */}
          {userTags.length === 0 && !isFree && (
            <p className="text-sm text-muted-foreground text-center py-4">No tags yet. Create your first tag below.</p>
          )}

          {userTags.map((tag) => (
            <div key={tag.id} className="flex items-center gap-2">
              {editingId === tag.id ? (
                <>
                  <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: editColour }} />
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="h-8 text-sm flex-1"
                    maxLength={32}
                  />
                  <div className="flex gap-1">
                    {PRESET_COLOURS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setEditColour(c)}
                        className={`h-4 w-4 rounded-full border-2 transition-all ${editColour === c ? "border-foreground scale-125" : "border-transparent"}`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => handleUpdate(tag.id)} className="h-7 px-2">Save</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingId(null)} className="h-7 px-2">Cancel</Button>
                </>
              ) : confirmDeleteId === tag.id ? (
                <div className="flex items-center gap-2 w-full">
                  <span className="text-sm text-muted-foreground flex-1">Remove "{tag.name}" from all monitors?</span>
                  <Button size="sm" variant="destructive" onClick={() => handleDelete(tag.id)} className="h-7 px-2">Delete</Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmDeleteId(null)} className="h-7 px-2">Cancel</Button>
                </div>
              ) : (
                <>
                  <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: tag.colour }} />
                  <span className="text-sm flex-1 truncate">{tag.name}</span>
                  <Button size="sm" variant="ghost" onClick={() => startEdit(tag)} className="h-7 w-7 p-0">
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmDeleteId(tag.id)} className="h-7 w-7 p-0 text-destructive hover:text-destructive">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </>
              )}
            </div>
          ))}

          {/* Create tag form */}
          {isFree ? (
            <div className="text-center py-4 border rounded-lg bg-muted/30">
              <p className="text-sm text-muted-foreground">Upgrade to Pro to organise your monitors with tags.</p>
            </div>
          ) : (
            <div className="border-t pt-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Create tag</span>
                {limit !== Infinity && (
                  <span className="text-xs text-muted-foreground">{userTags.length} / {limit} tags used</span>
                )}
              </div>
              <div className="flex gap-2 items-center">
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Tag name"
                  className="h-8 text-sm flex-1"
                  maxLength={32}
                  disabled={atLimit}
                />
                <Button
                  size="sm"
                  onClick={handleCreate}
                  disabled={isCreating || !newName.trim() || atLimit}
                  className="h-8"
                >
                  {isCreating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                </Button>
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {PRESET_COLOURS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setNewColour(c)}
                    className={`h-5 w-5 rounded-full border-2 transition-all ${newColour === c ? "border-foreground scale-110" : "border-transparent"}`}
                    style={{ backgroundColor: c }}
                    disabled={atLimit}
                  />
                ))}
              </div>
              {atLimit && (
                <p className="text-xs text-muted-foreground">Tag limit reached. Upgrade for more tags.</p>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
