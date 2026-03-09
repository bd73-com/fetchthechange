import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X, Plus } from "lucide-react";
import { useMonitorConditions, useAddCondition, useDeleteCondition } from "@/hooks/use-conditions";
import { useAuth } from "@/hooks/use-auth";
import { Link } from "wouter";

interface ConditionsPanelProps {
  monitorId: number;
}

const CONDITION_TYPES = [
  { value: "numeric_lt", label: "Value is less than", placeholder: "e.g. 150" },
  { value: "numeric_lte", label: "Value is \u2264", placeholder: "e.g. 150" },
  { value: "numeric_gt", label: "Value is greater than", placeholder: "e.g. 150" },
  { value: "numeric_gte", label: "Value is \u2265", placeholder: "e.g. 150" },
  { value: "numeric_change_pct", label: "Changed by more than %", placeholder: "e.g. 10 (percent)" },
  { value: "text_contains", label: "Contains text", placeholder: "e.g. In Stock" },
  { value: "text_not_contains", label: "Does not contain", placeholder: "e.g. Out of Stock" },
  { value: "text_equals", label: "Equals exactly", placeholder: "e.g. In Stock" },
  { value: "regex", label: "Matches regex", placeholder: "e.g. \\bIn Stock\\b" },
] as const;

export function ConditionsPanel({ monitorId }: ConditionsPanelProps) {
  const { user } = useAuth();
  const tier = (user as any)?.tier || "free";
  const isFreeTier = tier === "free";

  const { data: conditions = [], isLoading } = useMonitorConditions(monitorId);
  const addCondition = useAddCondition();
  const deleteCondition = useDeleteCondition();

  const [newType, setNewType] = useState("numeric_lt");
  const [newValue, setNewValue] = useState("");
  const [newGroup, setNewGroup] = useState(0);

  const handleAdd = () => {
    if (!newValue.trim()) return;
    addCondition.mutate(
      { monitorId, type: newType, value: newValue.trim(), groupIndex: newGroup },
      { onSuccess: () => { setNewValue(""); } },
    );
  };

  const selectedType = CONDITION_TYPES.find((t) => t.value === newType);

  if (isLoading) return null;

  // Sort conditions for display: groupIndex ASC, id ASC
  const sorted = [...conditions].sort((a, b) => a.groupIndex - b.groupIndex || a.id - b.id);

  // Group conditions for AND/OR display
  const groups = new Map<number, typeof sorted>();
  for (const c of sorted) {
    const g = groups.get(c.groupIndex) || [];
    g.push(c);
    groups.set(c.groupIndex, g);
  }
  const groupKeys = Array.from(groups.keys()).sort((a, b) => a - b);

  const canAdd = !isFreeTier || conditions.length < 1;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Alert Conditions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Only send notifications when the value meets these conditions.
        </p>
        <p className="text-xs text-muted-foreground">
          Free: 1 condition &middot; Pro/Power: unlimited
        </p>

        {/* Existing conditions */}
        {groupKeys.map((groupIdx, gi) => {
          const groupConditions = groups.get(groupIdx)!;
          return (
            <div key={groupIdx}>
              {gi > 0 && (
                <div className="flex items-center gap-2 my-2">
                  <Badge variant="outline" className="text-xs">OR</Badge>
                  <div className="flex-1 border-t" />
                </div>
              )}
              {groupConditions.map((c, ci) => {
                const typeInfo = CONDITION_TYPES.find((t) => t.value === c.type);
                return (
                  <div key={c.id}>
                    {ci > 0 && (
                      <div className="flex items-center gap-2 my-1 ml-4">
                        <Badge variant="secondary" className="text-xs">AND</Badge>
                      </div>
                    )}
                    <div className="flex items-center gap-2 p-3 border rounded-lg">
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium">{typeInfo?.label || c.type}</span>
                        <span className="text-sm text-muted-foreground ml-2">
                          {c.value}
                        </span>
                        {!isFreeTier && (
                          <Badge variant="outline" className="ml-2 text-xs">Group {c.groupIndex}</Badge>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Delete condition: ${typeInfo?.label || c.type} ${c.value}`}
                        onClick={() => deleteCondition.mutate({ monitorId, conditionId: c.id })}
                        disabled={deleteCondition.isPending}
                      >
                        <X className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}

        {/* Add new condition form */}
        {canAdd ? (
          <div className="space-y-3 pt-2 border-t">
            <div className="flex flex-col sm:flex-row gap-2">
              <Select value={newType} onValueChange={setNewType}>
                <SelectTrigger className="sm:w-[220px]" aria-label="Condition type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONDITION_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                placeholder={selectedType?.placeholder || "Value"}
                aria-label="Condition value"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                className="flex-1"
              />
              {!isFreeTier && (
                <Select value={String(newGroup)} onValueChange={(v) => setNewGroup(Number(v))}>
                  <SelectTrigger className="w-[100px]" aria-label="Condition group">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 10 }, (_, i) => (
                      <SelectItem key={i} value={String(i)}>Group {i}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <Button
              onClick={handleAdd}
              disabled={addCondition.isPending || !newValue.trim()}
              size="sm"
              variant="outline"
            >
              <Plus className="h-4 w-4 mr-1" />
              Add condition
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground pt-2 border-t">
            <Link href="/pricing" className="text-primary hover:underline">
              Upgrade to Pro or Power for unlimited conditions &rarr;
            </Link>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
